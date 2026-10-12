import { fail } from './courses-domain.js';

/* Supabase Storage REST for one private bucket, always with the server key: browsers never hold Storage credentials
   and every byte passes the application's access checks first. Shared by the course and festival repositories.
   Provider failures surface as our own 502 wording; Storage's text names buckets and policies. */
export function createObjectStorage({ env, fetchImpl = fetch, bucket }) {
  // env is read per call, as the course repository always did, so a store built without credentials fails on use.
  const headers = (type, extra = {}) => ({ apikey: env.serverKey, Authorization: `Bearer ${env.serverKey}`, ...(type ? { 'Content-Type': type } : {}), ...extra });
  const object = async (path, { method = 'GET', mime, body } = {}) => {
    const url = `${env.url}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
    // x-upsert false: an id names one upload for good, so a retry can never replace bytes someone already checked.
    const response = await fetchImpl(url, { method, body, headers: headers(mime, { 'x-upsert': 'false' }), signal: AbortSignal.timeout(20000) });
    if (!response.ok) fail('attachment storage unavailable', 502);
    return response;
  };
  return {
    async put(path, mime, bytes) { await object(path, { method: 'POST', mime, body: bytes }); },
    // The course repository sends the stored type on reads too; a GET has no body, so the festival may leave it out.
    async get(path, mime) { return Buffer.from(await (await object(path, { mime })).arrayBuffer()); },
    async remove(paths) {
      const response = await fetchImpl(`${env.url}/storage/v1/object/${bucket}`, { method: 'DELETE', headers: headers('application/json'), body: JSON.stringify({ prefixes: paths }), signal: AbortSignal.timeout(20000) });
      // Missing objects are not a failure: Storage answers 200 with an empty list for them, and a 404 likewise leaves
      // nothing to remove.
      if (!response.ok && response.status !== 404) fail('attachment cleanup unavailable', 502);
    },
  };
}
