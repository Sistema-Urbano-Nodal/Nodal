/* Loaded before every test file: package.json runs `node --import ./tests/setup/clear-limits.js --test tests/*.test.js`.
   server/server.js and server/db.js read these limits once, when they are imported, and the tests count up to their
   defaults (800 requests from one address, 10 wrong passwords, 30 rejected refreshes, 20 catalog writes...). The Vercel
   build runs the suite with the project's environment, where DEPLOYMENT.md and .env.example invite raising them, so a
   value set there would fail the deploy while CI stays green. Deleting them gives every test the defaults; a test that
   needs another value sets it and then imports the server (tests/review-fix-1-network.test.js does).
   tests/overview-tests-ci-limits.test.js checks that every envInt() name in server/ is listed here. */
export const LIMIT_VARIABLES = [
  // server/server.js, read when it is imported.
  'AUTH_RATE_LIMIT',
  'AUTH_IP_RATE_LIMIT',
  'AUTH_ACCOUNT_RATE_LIMIT',
  'SIGNUP_EMAIL_HOURLY_LIMIT',
  'SESSION_REFRESH_FAILURE_LIMIT',
  'INTERACTION_RATE_LIMIT',
  'MEMBER_SEARCH_RATE_LIMIT',
  'CATALOG_READ_RATE_LIMIT',
  'CATALOG_WRITE_RATE_LIMIT',
  'READ_RATE_LIMIT',
  'WRITE_RATE_LIMIT',
  'COSTLY_RATE_LIMIT',
  'NETWORK_GEOCODE_PER_REQUEST',
  'NETWORK_GEOCODE_BUDGET_MS',
  'CITY_SEARCH_LIMIT',
  'CITY_SEARCH_MIN_INTERVAL_MS',
  // server/server.js, read by each createApp().
  'NETWORK_RATE_LIMIT',
  // server/db.js, read when it is imported.
  'MAX_INTERACTION_EVENTS_PER_PAIR',
];

for (const name of LIMIT_VARIABLES) delete process.env[name];
