import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Links the company's tracked skills and agents (`skills/`, `skills/agents/`) into the local,
 * untracked `.claude/` folder, as symbolic links, so an edit in the repository applies at once.
 * A skill is a real folder, rebuilt on every run, whose files (at any depth) are links: a worktree
 * made by the desktop app copies `.claude/` files but drops links to folders, and would lose every
 * skill. An agent link or file already there under the same name is replaced; nothing else in
 * `.claude/` moves.
 * The workflow never needs this: it only serves a contributor who runs the company with Claude.
 */
export function linkSkills(root: string): string[] {
  const source = join(root, 'skills');
  if (!existsSync(source)) return [];
  const linked: string[] = [];
  const link = (from: string, to: string) => {
    mkdirSync(dirname(to), { recursive: true });
    rmSync(to, { recursive: true, force: true });
    symlinkSync(relative(dirname(to), from), to);
    linked.push(relative(root, to));
  };
  for (const name of readdirSync(source)) {
    const from = join(source, name);
    if (name === 'agents' || !existsSync(join(from, 'SKILL.md'))) continue;
    const skill = join(root, '.claude', 'skills', name);
    rmSync(skill, { recursive: true, force: true });
    for (const entry of readdirSync(from, { recursive: true, withFileTypes: true })) {
      if (entry.isDirectory()) continue;
      const file = join(entry.parentPath, entry.name);
      link(file, join(skill, relative(from, file)));
    }
  }
  const agents = join(source, 'agents');
  if (existsSync(agents))
    for (const file of readdirSync(agents).filter((f) => f.endsWith('.md')))
      link(join(agents, file), join(root, '.claude', 'agents', file));
  return linked;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const path of linkSkills(process.cwd())) console.log(`linked ${path}`);
}
