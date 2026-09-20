#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

try {
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  if (resolve(top) === root)
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root });
} catch {
  // Source archives and installed dependencies have no repository hooks to configure.
}
