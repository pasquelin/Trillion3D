import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { linkSkills } from './skills-link.ts';

test('skills-link: skills and agents become aliases in .claude, replacing a stale copy', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-link-'));
  mkdirSync(join(root, 'skills', 't3d-cto'), { recursive: true });
  writeFileSync(join(root, 'skills', 't3d-cto', 'SKILL.md'), 'cto');
  mkdirSync(join(root, 'skills', 'agents'), { recursive: true });
  writeFileSync(join(root, 'skills', 'agents', 'coder.md'), 'coder');
  mkdirSync(join(root, '.claude', 'skills', 't3d-cto'), { recursive: true });
  writeFileSync(join(root, '.claude', 'skills', 't3d-cto', 'SKILL.md'), 'stale');
  const linked = linkSkills(root);
  assert.deepEqual(linked.sort(), ['.claude/agents/coder.md', '.claude/skills/t3d-cto']);
  assert.equal(readlinkSync(join(root, '.claude', 'skills', 't3d-cto')), '../../skills/t3d-cto');
  assert.equal(readFileSync(join(root, '.claude', 'skills', 't3d-cto', 'SKILL.md'), 'utf8'), 'cto');
  assert.equal(readFileSync(join(root, '.claude', 'agents', 'coder.md'), 'utf8'), 'coder');
});
