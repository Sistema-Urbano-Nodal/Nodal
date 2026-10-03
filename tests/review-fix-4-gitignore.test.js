import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// config-deps-1: the AI-tooling block was protected only by an unversioned .git/info/exclude, so a fresh clone (another
// machine, a cloud or agent session) could `git add -A` NeuroTrace's token file. A local tool has also been seen
// stripping this block, so its absence fails the build.
test('the tracked .gitignore keeps AI and assistant state, which can hold tokens, out of the repository',()=>{
 const lines=new Set(readFileSync(new URL('../.gitignore',import.meta.url),'utf8').split(/\r?\n/).map(line=>line.trim()));
 for(const pattern of ['.neurotrace/','.superpowers/','.claude/','.cursor/','CLAUDE.local.md','supabase/snippets/'])assert.ok(lines.has(pattern),`${pattern} must be ignored`);
 // No later negation re-includes any of them.
 assert.ok(![...lines].some(line=>/^!(?:\.neurotrace|\.superpowers|\.claude|\.cursor|CLAUDE\.local|supabase\/snippets)/.test(line)));
});
