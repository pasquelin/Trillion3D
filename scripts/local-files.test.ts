import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { linkLocalFiles, localPaths } from './local-files.ts';

const BLOCK = [
  'node_modules/',
  '# Local files begin',
  '.claude/',
  'AGENTS.md',
  '/docs/roles/coder.md',
  '# Local files end',
  'dist/',
].join('\n');

function repository(gitignore: string): string {
  const root = mkdtempSync(join(tmpdir(), 'local-files-'));
  writeFileSync(join(root, '.gitignore'), gitignore);
  return root;
}

test('the local paths are the block of .gitignore, leading and trailing slashes dropped', () => {
  assert.deepEqual(localPaths(repository(BLOCK)), ['.claude', 'AGENTS.md', 'docs/roles/coder.md']);
});

test('a repository without the block, or without .gitignore, declares no local path', () => {
  assert.deepEqual(localPaths(repository('node_modules/\ndist/')), []);
  assert.deepEqual(localPaths(mkdtempSync(join(tmpdir(), 'local-files-'))), []);
});

test('a wildcard is left out rather than guessed at', () => {
  const root = repository('# Local files begin\n*.local.md\nAGENTS.md\n# Local files end');
  assert.deepEqual(localPaths(root), ['AGENTS.md']);
});

test('the worktree gains a link to each local file the primary worktree has', () => {
  const main = repository(BLOCK);
  const tree = repository(BLOCK);
  writeFileSync(join(main, 'AGENTS.md'), 'the rules');
  mkdirSync(join(main, 'docs/roles'), { recursive: true });
  writeFileSync(join(main, 'docs/roles/coder.md'), 'the role');
  assert.deepEqual(linkLocalFiles(tree, main), ['AGENTS.md', 'docs/roles/coder.md']);
  assert.equal(readFileSync(join(tree, 'AGENTS.md'), 'utf8'), 'the rules');
  assert.equal(readFileSync(join(tree, 'docs/roles/coder.md'), 'utf8'), 'the role');
  assert.equal(readlinkSync(join(tree, 'AGENTS.md')), join(main, 'AGENTS.md'));
});

test('a path the primary worktree does not have creates nothing', () => {
  const main = repository(BLOCK);
  const tree = repository(BLOCK);
  assert.deepEqual(linkLocalFiles(tree, main), []);
});

test('a path the worktree already has is left untouched', () => {
  const main = repository(BLOCK);
  const tree = repository(BLOCK);
  writeFileSync(join(main, 'AGENTS.md'), 'the rules');
  writeFileSync(join(tree, 'AGENTS.md'), 'its own copy');
  assert.deepEqual(linkLocalFiles(tree, main), []);
  assert.equal(readFileSync(join(tree, 'AGENTS.md'), 'utf8'), 'its own copy');
});

test('a local path of the primary worktree that leads nowhere is refused and said', () => {
  const main = repository(BLOCK);
  const tree = repository(BLOCK);
  symlinkSync(join(main, 'AGENTS.md'), join(main, 'AGENTS.md'));
  mkdirSync(join(main, 'docs/roles'), { recursive: true });
  symlinkSync(join(main, 'gone.md'), join(main, 'docs/roles/coder.md'));
  const refused: string[] = [];
  assert.deepEqual(
    linkLocalFiles(tree, main, (path) => refused.push(path)),
    [],
  );
  assert.deepEqual(refused, ['AGENTS.md', 'docs/roles/coder.md']);
  assert.equal(existsSync(join(tree, 'AGENTS.md')), false);
});

test('the primary worktree links nothing to itself', () => {
  const main = repository(BLOCK);
  writeFileSync(join(main, 'AGENTS.md'), 'the rules');
  assert.deepEqual(linkLocalFiles(main, main), []);
});

test('every local path of this repository is ignored whatever its kind', () => {
  // A worktree carries these as symbolic links, and git sees a link to a directory as a file: a
  // pattern ending in a slash would match the directory alone and let `git add -A` track the link.
  const root = new URL('..', import.meta.url).pathname;
  for (const path of localPaths(root))
    assert.doesNotThrow(
      () => execFileSync('git', ['check-ignore', '-q', path], { cwd: root, stdio: 'ignore' }),
      `${path} is declared local but git would track it`,
    );
});
