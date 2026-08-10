function required(value, name) {
  if (!String(value || '').trim()) throw new Error(`${name} is required`);
  return String(value).trim();
}

function errorCode(payload) {
  try { return JSON.parse(payload).code || ''; } catch { return ''; }
}

function assertAllowed(result, operation) {
  if (!result.ok) throw new Error(`${operation} failed (${result.status} ${result.code || result.payload})`);
}

function assertReachedDatabase(result, operation) {
  if ([400, 409, 422].includes(result.status) && !['42501', 'PGRST205', 'PGRST301'].includes(result.code)) return;
  throw new Error(`${operation} did not reach its expected database constraint (${result.status} ${result.code || result.payload})`);
}

async function run({ env = process.env, fetchImpl = fetch, output = process.stdout } = {}) {
  const projectUrl = required(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = required(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY');
  const request = async (path, { method = 'GET', body } = {}) => {
    const response = await fetchImpl(new URL(`/rest/v1/${path}`, projectUrl), {
      method,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.text();
    return { status: response.status, ok: response.ok, code: errorCode(payload), payload };
  };
  const readable = [
    'profiles', 'profile_preferences', 'onboarding_responses', 'member_follows',
    'member_interactions', 'stripe_customers', 'catalog_items', 'catalog_interests',
  ];
  for (const table of readable) {
    assertAllowed(await request(`${table}?select=*&limit=0`), `SELECT ${table}`);
  }

  const missingId = '00000000-0000-0000-0000-000000000000';
  const otherMissingId = '00000000-0000-0000-0000-000000000001';
  const invalidInserts = [
    ['profiles', { id: missingId }],
    ['profile_preferences', { user_id: missingId }],
    ['onboarding_responses', { user_id: missingId }],
    ['member_follows', { user_id: missingId, target_user_id: otherMissingId }],
    ['member_interactions', { from_user_id: missingId, to_user_id: otherMissingId, type: 'view' }],
    ['catalog_items', { kind: 'resource', created_by: missingId }],
    ['catalog_interests', { item_id: missingId, user_id: otherMissingId, status: 'new' }],
  ];
  for (const [table, row] of invalidInserts) {
    const result = await request(table, { method: 'POST', body: [row] });
    if (result.status === 201) throw new Error(`INSERT ${table} unexpectedly persisted the invalid smoke row`);
    assertReachedDatabase(result, `INSERT ${table}`);
  }

  const updates = [
    ['profiles', 'id', { preferred_name: 'grant-smoke' }],
    ['profile_preferences', 'user_id', { visibility: {} }],
    ['onboarding_responses', 'user_id', { raw_answers: {} }],
    ['catalog_items', 'id', { featured: false }],
    ['catalog_interests', 'id', { status: 'new' }],
  ];
  for (const [table, key, body] of updates) {
    assertAllowed(await request(`${table}?${key}=eq.${missingId}`, { method: 'PATCH', body }), `UPDATE ${table}`);
  }

  for (const table of ['catalog_items', 'catalog_interests']) {
    const denied = await request(`${table}?id=eq.${missingId}`, { method: 'DELETE' });
    if (denied.ok || denied.code !== '42501') throw new Error(`DELETE ${table} must be denied with PostgreSQL 42501`);
  }

  output.write('Supabase Data API least-privilege smoke passed.\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

export { run };
