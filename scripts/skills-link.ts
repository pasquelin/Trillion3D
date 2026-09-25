import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Links the company's tracked skills and agents (`skills/`, `skills/agents/`) into the local,
 * untracked `.claude/` folder, as symbolic links, so an edit in the repository applies at once.
 * A skill is a real folder whose files are links: a worktree made by the desktop app copies
 * `.claude/` files but drops links to folders, and would lose every skill.
 * A link or file already there under the same name is replaced; nothing else in `.claude/` moves.
 * The workflow never needs this: it only serves a contributor who runs the company with Claude.
 */
export function linkSkills(root: string): string[] {
  const source = join(root, 'skills');
  if (!existsSync(source)) return [];
  const linked: string[] = [];
  const link = (from: string, to: string) => {
    mkdirSync(resolve(to, '..'), { recursive: true });
    if (existsSync(to) || isLink(to)) rmSync(to, { recursive: true, force: true });
    symlinkSync(relative(resolve(to, '..'), from), to);
    linked.push(relative(root, to));
  };
  for (const name of readdirSync(source)) {
    if (name === 'agents' || !existsSync(join(source, name, 'SKILL.md'))) continue;
    const skill = join(root, '.claude', 'skills', name);
    if (isLink(skill)) rmSync(skill);
    for (const file of readdirSync(join(source, name)))
      link(join(source, name, file), join(skill, file));
  }
  const agents = join(source, 'agents');
  if (existsSync(agents))
    for (const file of readdirSync(agents).filter((f) => f.endsWith('.md')))
      link(join(agents, file), join(root, '.claude', 'agents', file));
  return linked;
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const path of linkSkills(process.cwd())) console.log(`linked ${path}`);
}
