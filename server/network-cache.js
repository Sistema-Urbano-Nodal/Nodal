/* Process-local, bounded snapshots. Revisions always come from the authoritative
   database. Without revision support, a network response cannot be validated
   after asynchronous work and therefore fails closed. Directory reads never
   depend on graph availability; graph consumers request it lazily. */
export function createNetworkSnapshots(repository, { ttlMs = 15_000, now = Date.now } = {}) {
  let cached = null;
  const pending = new Map();
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
    return { rows, revision: key, expires: now() + ttlMs };
  }
  async function readDirectory() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const key = await revision();
      if (cached?.revision !== key || cached.expires <= now()) cached = null;
      if (cached) return cached;
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
    let work = graphs.get(snapshot);
    if (!work) {
      work = Promise.resolve().then(() => repository.loadGraphStore({ directoryRows: snapshot.rows }));
      graphs.set(snapshot, work);
      work.catch(() => { if (graphs.get(snapshot) === work) graphs.delete(snapshot); });
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
        const snapshot = await read({ graph: true });
        const value = await build(snapshot);
        if (await revision() === snapshot.revision) return value;
        cached = null;
      }
      throw unstable();
    },
  };
}
