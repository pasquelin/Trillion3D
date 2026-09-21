#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkLocalFiles } from './local-files.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The primary worktree, which `git worktree list` always prints first. */
function primaryWorktree(): string | undefined {
  const list = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const first = list.split('\n', 1)[0] ?? '';
  return first.startsWith('worktree ') ? first.slice('worktree '.length) : undefined;
}

try {
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  if (resolve(top) === root)
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root });
  // A linked worktree starts without the files `.gitignore` keeps local — the rules of AGENTS.md
  // and the roles of docs/roles/ among them (#157). It gets a link to the ones the primary
  // worktree has, so a batch is written where its rules are readable.
  const primary = primaryWorktree();
  if (primary !== undefined) {
    const linked = linkLocalFiles(root, primary);
    if (linked.length) console.log(`Local files linked from ${primary}: ${linked.join(', ')}`);
  }
} catch {
  // Source archives and installed dependencies have no repository hooks to configure, and a
  // platform that refuses symbolic links installs without them: neither may fail the install.
}
