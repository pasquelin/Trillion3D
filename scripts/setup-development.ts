#!/usr/bin/env node
import { resolve } from 'node:path'
import { linkLocalFiles } from './local-files.ts'
import { linkSkills } from './skills-link.ts'
import { REPOSITORY_ROOT } from './repository-files.ts'
import { git } from './git-paths.ts'

/** The primary worktree, which `git worktree list` always prints first. */
function primaryWorktree(): string | undefined {
  const list = git(REPOSITORY_ROOT, 'worktree', 'list', '--porcelain')
  const first = list.split('\n', 1)[0] ?? ''
  return first.startsWith('worktree ') ? first.slice('worktree '.length) : undefined
}

try {
  const top = git(REPOSITORY_ROOT, 'rev-parse', '--show-toplevel')
  if (resolve(top) === REPOSITORY_ROOT)
    git(REPOSITORY_ROOT, 'config', 'core.hooksPath', '.githooks')
  // A linked worktree starts without the files `.gitignore` keeps local — personal assistant
  // settings and graph artefacts. It gets a link to the ones the primary
  // worktree has, so a batch is written where its rules are readable.
  const primary = primaryWorktree()
  // Every clone runs the company the same way: its tracked skills and agents are aliased into the
  // local `.claude/` of the primary checkout, which linked worktrees then share.
  if (primary !== undefined && resolve(primary) === REPOSITORY_ROOT) {
    const skills = linkSkills(REPOSITORY_ROOT)
    if (skills.length) console.log(`Company skills linked: ${skills.length}`)
  }
  if (primary !== undefined) {
    const linked = linkLocalFiles(REPOSITORY_ROOT, primary)
    if (linked.length) console.log(`Local files linked from ${primary}: ${linked.join(', ')}`)
  }
} catch {
  // Source archives and installed dependencies have no repository hooks to configure, and a
  // platform that refuses symbolic links installs without them: neither may fail the install.
}
