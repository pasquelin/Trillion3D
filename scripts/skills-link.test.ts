import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { linkSkills } from './skills-link.ts'

/** A repository with one skill, `skills/t3d-recette/SKILL.md`, and a `.claude/skills/` folder. */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'skills-link-'))
  after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'skills', 't3d-recette'), { recursive: true })
  writeFileSync(join(root, 'skills', 't3d-recette', 'SKILL.md'), 'recette')
  mkdirSync(join(root, '.claude', 'skills'), { recursive: true })
  return root
}

test('skills-link: skill files become aliases in .claude, replacing a stale copy', () => {
  const root = fixture()
  mkdirSync(join(root, 'skills', 't3d-recette', 'references'))
  writeFileSync(join(root, 'skills', 't3d-recette', 'references', 'notes.md'), 'notes')
  mkdirSync(join(root, '.claude', 'skills', 't3d-recette'))
  writeFileSync(join(root, '.claude', 'skills', 't3d-recette', 'SKILL.md'), 'stale')
  const linked = linkSkills(root)
  assert.deepEqual(linked.sort(), [
    '.claude/skills/t3d-recette/SKILL.md',
    '.claude/skills/t3d-recette/references/notes.md',
  ])
  assert.ok(!lstatSync(join(root, '.claude', 'skills', 't3d-recette')).isSymbolicLink())
  assert.ok(
    !lstatSync(join(root, '.claude', 'skills', 't3d-recette', 'references')).isSymbolicLink(),
  )
  assert.equal(
    readlinkSync(join(root, '.claude', 'skills', 't3d-recette', 'SKILL.md')),
    '../../../skills/t3d-recette/SKILL.md',
  )
  assert.equal(
    readFileSync(join(root, '.claude', 'skills', 't3d-recette', 'SKILL.md'), 'utf8'),
    'recette',
  )
  assert.equal(
    readFileSync(join(root, '.claude', 'skills', 't3d-recette', 'references', 'notes.md'), 'utf8'),
    'notes',
  )
})

test('skills-link: a skill linked as a whole folder by an older run becomes a real folder', () => {
  const root = fixture()
  symlinkSync('../../skills/t3d-recette', join(root, '.claude', 'skills', 't3d-recette'))
  linkSkills(root)
  assert.ok(!lstatSync(join(root, '.claude', 'skills', 't3d-recette')).isSymbolicLink())
  assert.equal(readFileSync(join(root, 'skills', 't3d-recette', 'SKILL.md'), 'utf8'), 'recette')
  assert.equal(
    readFileSync(join(root, '.claude', 'skills', 't3d-recette', 'SKILL.md'), 'utf8'),
    'recette',
  )
})

test('skills-link: a skill removed from skills/ loses its link, a local one stays', () => {
  const root = fixture()
  mkdirSync(join(root, '.claude', 'skills', 't3d-gone'))
  symlinkSync(
    '../../../skills/t3d-gone/SKILL.md',
    join(root, '.claude', 'skills', 't3d-gone', 'SKILL.md'),
  )
  mkdirSync(join(root, '.claude', 'skills', 'mine'))
  writeFileSync(join(root, '.claude', 'skills', 'mine', 'SKILL.md'), 'mine')
  linkSkills(root)
  assert.ok(!lstatSync(join(root, '.claude', 'skills', 't3d-gone'), { throwIfNoEntry: false }))
  assert.equal(readFileSync(join(root, '.claude', 'skills', 'mine', 'SKILL.md'), 'utf8'), 'mine')
})
