/* TTL cache for recommendation results.
   Redis (REDIS_URL) when available — minimal RESP client, zero dependencies —
   otherwise an in-memory Map with the same async interface. Cache failures
   degrade to misses; they never take the API down. */

import net from 'node:net';
import tls from 'node:tls';

export class MemoryCache {
  constructor({ now = Date.now, maxEntries = 1000 } = {}) {
    this.now = now;
    this.maxEntries = Math.max(1, Number(maxEntries) || 1000);
    this.store = new Map();
  }
  async get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expires <= this.now()) { this.store.delete(key); return null; }
    return entry.value;
  }
  async set(key, value, ttlMs) {
    const now = this.now();
    for (const [storedKey, entry] of this.store) {
      if (entry.expires <= now) this.store.delete(storedKey);
    }
    this.store.delete(key);
    this.store.set(key, { value, expires: this.now() + ttlMs });
    while (this.store.size > this.maxEntries) {
      this.store.delete(this.store.keys().next().value);
    }
  }
}

export class RedisCache {
  constructor(url, { commandTimeoutMs = 1000, maxResponseBytes = 1024 * 1024 } = {}) {
    const u = new URL(url);
    if (!['redis:', 'rediss:'].includes(u.protocol)) throw new Error('REDIS_URL must use redis:// or rediss://');
    this.host = u.hostname || '127.0.0.1';
    this.tls = u.protocol === 'rediss:';
    this.port = Number(u.port || (this.tls ? 6380 : 6379));
    this.username = decodeURIComponent(u.username || '');
    this.password = decodeURIComponent(u.password || '');
    this.db = u.pathname && u.pathname !== '/' ? u.pathname.slice(1) : '';
    this.commandTimeoutMs = Math.max(1, Number(commandTimeoutMs) || 1000);
    this.maxResponseBytes = Math.max(1, Number(maxResponseBytes) || 1024 * 1024);
    this.sock = null;
    this.dead = false;
    this.pending = [];
    this.buf = Buffer.alloc(0);
  }

  #fail() {
    if (this.dead) return;
    this.dead = true;
    this.sock?.destroy();
    while (this.pending.length) {
      const pending = this.pending.shift();
      clearTimeout(pending.timer);
      pending.resolve(null);
    }
  }

  connect(timeoutMs = 1000) {
    return new Promise((resolve, reject) => {
      const connect = this.tls ? tls.connect : net.createConnection;
      const options = this.tls
        ? { host: this.host, port: this.port, servername: this.host }
        : { host: this.host, port: this.port };
      const sock = connect(options);
      const timer = setTimeout(() => { this.#fail(); sock.destroy(); reject(new Error('redis connect timeout')); }, timeoutMs);
      sock.once(this.tls ? 'secureConnect' : 'connect', async () => {
        clearTimeout(timer);
        this.sock = sock;
        try {
          if (this.password) {
            const args = this.username ? ['AUTH', this.username, this.password] : ['AUTH', this.password];
            if (await this.#cmd(...args) === null) throw new Error('redis auth failed');
          }
          if (this.db) {
            if (!/^\d+$/.test(this.db)) throw new Error('redis database index must be numeric');
            if (await this.#cmd('SELECT', this.db) === null) throw new Error('redis database select failed');
          }
          resolve();
        } catch (err) {
          this.#fail();
          reject(err);
        }
      });
      sock.once('error', (err) => { clearTimeout(timer); this.#fail(); reject(err); });
      sock.on('data', (chunk) => this.#feed(chunk));
      sock.on('close', () => {
        this.#fail();
      });
    });
  }

  #feed(chunk) {
    if (this.buf.length + chunk.length > this.maxResponseBytes) {
      this.#fail();
      return;
    }
    this.buf = Buffer.concat([this.buf, chunk]);
    let parsed;
    while (this.pending.length && (parsed = this.#parse()) !== undefined) {
      const pending = this.pending.shift();
      clearTimeout(pending.timer);
      pending.resolve(parsed);
    }
  }

  /* parse a single RESP reply off the front of the buffer;
     returns undefined when the reply is still incomplete */
  #parse() {
    const nl = this.buf.indexOf('\r\n');
    if (nl === -1) return undefined;
    const head = this.buf.subarray(0, nl).toString();
    const type = head[0];
    const rest = head.slice(1);
    if (type === '+' || type === ':') { this.buf = this.buf.subarray(nl + 2); return rest; }
    if (type === '-') { this.buf = this.buf.subarray(nl + 2); return null; }
    if (type === '$') {
      const len = Number(rest);
      if (len === -1) { this.buf = this.buf.subarray(nl + 2); return null; }
      const end = nl + 2 + len + 2;
      if (this.buf.length < end) return undefined;
      const value = this.buf.subarray(nl + 2, nl + 2 + len).toString();
      this.buf = this.buf.subarray(end);
      return value;
    }
    // unexpected type — drop the line and treat as a miss
    this.buf = this.buf.subarray(nl + 2);
    return null;
  }

  #cmd(...args) {
    if (this.dead || !this.sock) return Promise.resolve(null);
    const payload = [`*${args.length}`, ...args.flatMap((a) => [`$${Buffer.byteLength(a)}`, a])].join('\r\n') + '\r\n';
    return new Promise((resolve) => {
      const pending = {
        resolve,
        timer: setTimeout(() => this.#fail(), this.commandTimeoutMs),
      };
      this.pending.push(pending);
      this.sock.write(payload, (err) => { if (err) this.#fail(); });
    });
  }

  async get(key) { return this.#cmd('GET', key); }
  async set(key, value, ttlMs) { await this.#cmd('SET', key, value, 'PX', String(ttlMs)); }
}

function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '::1' || hostname.startsWith('127.');
}

export async function createCache(log = console, env = process.env) {
  const url = env.REDIS_URL;
  if (url) {
    const parsed = new URL(url);
    if (env.NODE_ENV === 'production' && parsed.protocol !== 'rediss:' && !isLoopback(parsed.hostname)) {
      throw new Error('REDIS_URL must use rediss:// outside loopback in production');
    }
    try {
      const redis = new RedisCache(url, {
        commandTimeoutMs: env.REDIS_COMMAND_TIMEOUT_MS,
        maxResponseBytes: env.REDIS_MAX_RESPONSE_BYTES,
      });
      await redis.connect();
      log.log(`cache: redis at ${redis.tls ? 'rediss' : 'redis'}://${redis.host}:${redis.port}`);
      return redis;
    } catch (err) {
      log.warn(`cache: redis unavailable (${err.message}) — falling back to in-memory TTL cache`);
    }
  }
  return new MemoryCache({ maxEntries: env.MEMORY_CACHE_MAX_ENTRIES });
}
