import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { linkSkills } from './skills-link.ts';

/** A repository with one skill, `skills/t3d-cto/SKILL.md`, and a `.claude/skills/` folder. */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'skills-link-'));
  after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'skills', 't3d-cto'), { recursive: true });
  writeFileSync(join(root, 'skills', 't3d-cto', 'SKILL.md'), 'cto');
  mkdirSync(join(root, '.claude', 'skills'), { recursive: true });
  return root;
}

test('skills-link: skill files and agents become aliases in .claude, replacing a stale copy', () => {
  const root = fixture();
  mkdirSync(join(root, 'skills', 't3d-cto', 'references'));
  writeFileSync(join(root, 'skills', 't3d-cto', 'references', 'notes.md'), 'notes');
  mkdirSync(join(root, 'skills', 'agents'));
  writeFileSync(join(root, 'skills', 'agents', 'coder.md'), 'coder');
  mkdirSync(join(root, '.claude', 'skills', 't3d-cto'));
  writeFileSync(join(root, '.claude', 'skills', 't3d-cto', 'SKILL.md'), 'stale');
  const linked = linkSkills(root);
  assert.deepEqual(linked.sort(), [
    '.claude/agents/coder.md',
    '.claude/skills/t3d-cto/SKILL.md',
    '.claude/skills/t3d-cto/references/notes.md',
  ]);
  assert.ok(!lstatSync(join(root, '.claude', 'skills', 't3d-cto')).isSymbolicLink());
  assert.ok(!lstatSync(join(root, '.claude', 'skills', 't3d-cto', 'references')).isSymbolicLink());
  assert.equal(
    readlinkSync(join(root, '.claude', 'skills', 't3d-cto', 'SKILL.md')),
    '../../../skills/t3d-cto/SKILL.md',
  );
  assert.equal(readFileSync(join(root, '.claude', 'skills', 't3d-cto', 'SKILL.md'), 'utf8'), 'cto');
  assert.equal(
    readFileSync(join(root, '.claude', 'skills', 't3d-cto', 'references', 'notes.md'), 'utf8'),
    'notes',
  );
  assert.equal(readFileSync(join(root, '.claude', 'agents', 'coder.md'), 'utf8'), 'coder');
});

test('skills-link: a skill linked as a whole folder by an older run becomes a real folder', () => {
  const root = fixture();
  symlinkSync('../../skills/t3d-cto', join(root, '.claude', 'skills', 't3d-cto'));
  linkSkills(root);
  assert.ok(!lstatSync(join(root, '.claude', 'skills', 't3d-cto')).isSymbolicLink());
  assert.equal(readFileSync(join(root, 'skills', 't3d-cto', 'SKILL.md'), 'utf8'), 'cto');
  assert.equal(readFileSync(join(root, '.claude', 'skills', 't3d-cto', 'SKILL.md'), 'utf8'), 'cto');
});
