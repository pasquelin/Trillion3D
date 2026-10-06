import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Links the company's tracked skills (`skills/`) into the local, untracked `.claude/` folder, as symbolic links, so an edit in the repository applies at once.
 * A skill is a real folder, rebuilt on every run, whose files (at any depth) are links: a worktree
 * made by the desktop app copies `.claude/` files but drops links to folders, and would lose every
 * skill. Nothing else in `.claude/` moves, but a skill whose source left `skills/` loses its link.
 * The workflow never needs this: it only serves a contributor who runs the company with Claude.
 */
export function linkSkills(root: string): string[] {
  const source = join(root, 'skills')
  if (!existsSync(source)) return []
  const linked: string[] = []
  const link = (from: string, to: string) => {
    mkdirSync(dirname(to), { recursive: true })
    rmSync(to, { recursive: true, force: true })
    symlinkSync(relative(dirname(to), from), to)
    linked.push(relative(root, to))
  }
  pruneRemoved(root, source)
  for (const name of readdirSync(source)) {
    const from = join(source, name)
    if (!existsSync(join(from, 'SKILL.md'))) continue
    const skill = join(root, '.claude', 'skills', name)
    rmSync(skill, { recursive: true, force: true })
    for (const entry of readdirSync(from, { recursive: true, withFileTypes: true })) {
      if (entry.isDirectory()) continue
      const file = join(entry.parentPath, entry.name)
      link(file, join(skill, relative(from, file)))
    }
  }
  return linked
}

/** Removes the `.claude/` links whose target in `skills/` no longer exists. */
function pruneRemoved(root: string, source: string): void {
  const gone = (link: string) => {
    if (!lstatSync(link).isSymbolicLink()) return false
    const target = resolve(dirname(link), readlinkSync(link))
    return !relative(source, target).startsWith('..') && !existsSync(target)
  }
  const skills = join(root, '.claude', 'skills')
  if (existsSync(skills))
    for (const name of readdirSync(skills)) {
      const skill = join(skills, name)
      const entry = lstatSync(skill).isSymbolicLink() ? skill : join(skill, 'SKILL.md')
      if (lstatSync(entry, { throwIfNoEntry: false }) && gone(entry))
        rmSync(skill, { recursive: true, force: true })
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const path of linkSkills(process.cwd())) console.log(`linked ${path}`)
}
