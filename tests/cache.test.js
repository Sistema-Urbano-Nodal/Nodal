import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { createCache, MemoryCache, RedisCache } from '../server/cache.js';

test('memory cache: set/get roundtrip within TTL', async () => {
  let t = 0;
  const cache = new MemoryCache({ now: () => t });
  await cache.set('k', 'v', 300_000);
  assert.equal(await cache.get('k'), 'v');
});

test('memory cache: entries expire after the TTL', async () => {
  let t = 0;
  const cache = new MemoryCache({ now: () => t });
  await cache.set('k', 'v', 300_000);
  t = 299_999;
  assert.equal(await cache.get('k'), 'v');
  t = 300_000;
  assert.equal(await cache.get('k'), null);
});

test('memory cache: set sweeps expired entries that will never be read again', async () => {
  let t = 0;
  const cache = new MemoryCache({ now: () => t, maxEntries: 10 });
  await cache.set('old-a', '1', 10);
  await cache.set('old-b', '2', 10);
  t = 10;
  await cache.set('current', '3', 10);

  assert.deepEqual([...cache.store.keys()], ['current']);
});

test('memory cache: entry count is bounded and evicts the oldest value', async () => {
  const cache = new MemoryCache({ maxEntries: 2 });
  await cache.set('a', '1', 60_000);
  await cache.set('b', '2', 60_000);
  await cache.set('c', '3', 60_000);

  assert.equal(cache.store.size, 2);
  assert.equal(await cache.get('a'), null);
  assert.equal(await cache.get('b'), '2');
  assert.equal(await cache.get('c'), '3');
});

test('redis cache preserves TLS, auth, and database settings from REDIS_URL', () => {
  const cache = new RedisCache('rediss://user:p%40ss@redis.example:6380/2');
  assert.equal(cache.tls, true);
  assert.equal(cache.host, 'redis.example');
  assert.equal(cache.port, 6380);
  assert.equal(cache.username, 'user');
  assert.equal(cache.password, 'p@ss');
  assert.equal(cache.db, '2');
});

test('production cache rejects plaintext Redis outside loopback', async () => {
  const log = { log() {}, warn() {} };
  await assert.rejects(
    createCache(log, {
      NODE_ENV: 'production',
      REDIS_URL: 'redis://default:password@redis.example:6379/0',
    }),
    /rediss:\/\//,
  );
});

async function silentRedisServer(t, onCommand = () => {}) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('data', () => onCommand(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });
  return server.address().port;
}

const within = (promise, ms = 250) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('operation did not settle')), ms)),
]);

test('redis cache: command timeout resolves a stalled request as a miss', async (t) => {
  const port = await silentRedisServer(t);
  const cache = new RedisCache(`redis://127.0.0.1:${port}`, { commandTimeoutMs: 25 });
  await cache.connect();

  assert.equal(await within(cache.get('key')), null);
  assert.equal(cache.dead, true);
});

test('redis cache: oversized incomplete responses are rejected', async (t) => {
  let replied = false;
  const port = await silentRedisServer(t, (socket) => {
    if (replied) return;
    replied = true;
    socket.write(`$1000\r\n${'x'.repeat(100)}`);
  });
  const cache = new RedisCache(`redis://127.0.0.1:${port}`, {
    commandTimeoutMs: 100,
    maxResponseBytes: 64,
  });
  await cache.connect();

  assert.equal(await within(cache.get('key')), null);
  assert.equal(cache.dead, true);
});
