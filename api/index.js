import { createApp, validateRuntimeConfig } from '../server/server.js';
import { createCache } from '../server/cache.js';

let appPromise;

async function app() {
  if (!appPromise) {
    appPromise = (async () => {
      validateRuntimeConfig();
      return createApp({ cache: await createCache() });
    })();
    /* A rejected promise stays rejected. Without this, one transient failure
       here — a cache that was not reachable at the moment this instance woke
       up — would fail every later request on the instance with the same error,
       long after the cause had cleared. */
    appPromise.catch(() => { appPromise = undefined; });
  }
  return appPromise;
}

export default async function handler(req, res) {
  const server = await app();
  server.emit('request', req, res);
}
