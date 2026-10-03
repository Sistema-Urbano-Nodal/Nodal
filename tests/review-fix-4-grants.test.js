import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';

/* database-6: 20260810175241_service_role_data_api_grants.sql revoked organizations, organization_memberships and
   stripe_events from service_role only, so anon and authenticated kept Supabase's default ALL (TRUNCATE included),
   EXECUTE on set_updated_at() and USAGE/UPDATE on member_interactions_id_seq. Supabase grants those roles everything
   by default, so an object stays open to a role until a migration revokes it (and no later one grants it back).
   Checked against a disposable PostgreSQL with Supabase's default privileges: the revokes apply, apply again
   unchanged, and set_updated_at() triggers still fire for writers without EXECUTE. */
const dir=new URL('../supabase/migrations/',import.meta.url);
const statements=readdirSync(dir).filter(name=>name.endsWith('.sql')).sort()
 .flatMap(name=>readFileSync(new URL(name,dir),'utf8').replace(/--[^\n]*/g,'').split(';').map(part=>part.replace(/\s+/g,' ').trim()).filter(Boolean));
const list=text=>text.split(',').map(item=>item.trim().toLowerCase());
function stateFor(kind,object,role){
 let state='default';
 for(const statement of statements){
  const revoke=statement.match(new RegExp(`^revoke (?:all(?: privileges)?|[a-z, ]+) on (?:${kind} )?(.+?) from (.+)$`,'i'));
  const grant=statement.match(new RegExp(`^grant (.+?) on (?:${kind} )?(.+?) to (.+)$`,'i'));
  if(revoke&&list(revoke[1]).includes(object)&&list(revoke[2]).some(r=>r===role||r==='public'))state=/^revoke all/i.test(statement)?'revoked':'partial';
  else if(grant&&list(grant[2]).includes(object)&&list(grant[3]).includes(role))state='granted';
 }
 return state;
}

test('the browser roles hold nothing on the server-only organisation and Stripe tables, their trigger function or the interactions sequence',()=>{
 for(const role of ['anon','authenticated']){
  for(const table of ['public.organizations','public.organization_memberships','public.stripe_events'])assert.equal(stateFor('table',table,role),'revoked',`${table} ${role}`);
  assert.equal(stateFor('function','public.set_updated_at()',role),'revoked',`set_updated_at() ${role}`);
  assert.equal(stateFor('sequence','public.member_interactions_id_seq',role),'revoked',`member_interactions_id_seq ${role}`);
 }
 // The server keeps exactly what it uses.
 assert.equal(stateFor('sequence','public.member_interactions_id_seq','service_role'),'granted');
 for(const table of ['public.organizations','public.organization_memberships','public.stripe_events'])assert.equal(stateFor('table',table,'service_role'),'revoked');
});

test('the closing migration only revokes, so it is safe to apply by hand and to apply twice',()=>{
 const name=readdirSync(dir).find(file=>file.endsWith('_close_client_grants_on_server_tables.sql'));
 assert.match(name??'',/^\d{14}_close_client_grants_on_server_tables\.sql$/);
 assert.ok(name>'20260810175241_service_role_data_api_grants.sql');
 const sql=readFileSync(new URL(name,dir),'utf8').replace(/--[^\n]*/g,'');
 const body=sql.split(';').map(part=>part.trim()).filter(Boolean);
 assert.ok(body.length>0&&body.every(statement=>/^revoke all on /i.test(statement)),'revokes only');
 assert.doesNotMatch(sql,/\b(?:grant|create|drop|alter|insert|update|delete|truncate)\b/i);
 assert.doesNotMatch(sql,/service_role/i,'service_role grants are left as they are');
});
