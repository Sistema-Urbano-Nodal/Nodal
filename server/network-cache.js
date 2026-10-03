/* Process-local, bounded snapshots. Revisions always come from the authoritative
   database. Without revision support, a network response cannot be validated
   after asynchronous work and therefore fails closed. Directory reads never
   depend on graph availability; graph consumers request it lazily.

   The revision alone decides whether the data is current: database triggers bump
   it on every write to the five tables the directory and graph are read from, so
   an unchanged revision means unchanged rows. The globe polls every 15 seconds,
   and rereading the whole directory and graph on each poll only to answer 304
   cost Supabase egress for nothing. Two clocks remain:
   - refreshMs: after this long the same rows (and their already loaded graph) are
     handed out as a new snapshot object, so per-snapshot work derived from them
     (the places payload, which geocodes a few unplaced cities each time it is
     built) is recomputed without reading any table again.
   - ttlMs: a backstop. Rows older than this are read again even when the revision
     has not moved. */
export function createNetworkSnapshots(repository, { ttlMs = 10 * 60_000, refreshMs = 15_000, now = Date.now } = {}) {
  let cached = null;
  const pending = new Map();
  // Keyed by the directory rows, which renewed snapshots share, so a renewal never reloads the graph.
  const graphs = new WeakMap();
  const unstable = () => Object.assign(new Error('Network changed during read; retry shortly'), { status: 503 });
  async function revision() {
    const value = repository.getNetworkRevision ? await repository.getNetworkRevision() : null;
    if (value === null || value === undefined) {
      cached = null;
      throw Object.assign(new Error('Authoritative network revision unavailable'), { status: 503 });
    }
    return value;
  }
  async function loadDirectory(key) {
    const rows = await repository.listDirectoryUsers();
    const loadedAt = now();
    return { rows, revision: key, loadedAt, expires: loadedAt + Math.min(refreshMs, ttlMs) };
  }
  // The cached snapshot when it is still valid for this revision, renewed (same rows, new identity) when due.
  function current(key) {
    const at = now();
    if (!cached || cached.revision !== key || at - cached.loadedAt >= ttlMs) return null;
    if (cached.expires <= at) cached = { ...cached, expires: at + refreshMs };
    return cached;
  }
  async function readDirectory() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const key = await revision();
      const valid = current(key);
      if (valid) return valid;
      cached = null;
      let work = pending.get(key);
      if (!work) {
        work = loadDirectory(key);
        pending.set(key, work);
        work.finally(() => { if (pending.get(key) === work) pending.delete(key); }).catch(() => {});
      }
      const snapshot = await work;
      if (await revision() !== key) continue;
      cached = snapshot;
      return snapshot;
    }
    throw unstable();
  }
  async function loadGraph(snapshot) {
    const key = snapshot.rows;
    let work = graphs.get(key);
    if (!work) {
      work = Promise.resolve().then(() => repository.loadGraphStore({ directoryRows: snapshot.rows }));
      graphs.set(key, work);
      work.catch(() => { if (graphs.get(key) === work) graphs.delete(key); });
    }
    snapshot.graph = await work;
  }
  async function read({ graph = false } = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await readDirectory();
      if (!graph) return snapshot;
      await loadGraph(snapshot);
      // A lazily loaded graph may span database writes after directory reading.
      if (await revision() === snapshot.revision) return snapshot;
      cached = null;
    }
    throw unstable();
  }
  return {
    read,
    /* Graph consumers also cover geocoding/cache awaits after acquisition. */
    async run(build) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const snapshot = await readDirectory();
        await loadGraph(snapshot);
        const value = await build(snapshot);
        // One final authoritative check covers both graph construction and
        // response work; an intermediate check would add a serial round trip
        // without strengthening the revision boundary before sending.
        if (await revision() === snapshot.revision) return value;
        cached = null;
      }
      throw unstable();
    },
  };
}
