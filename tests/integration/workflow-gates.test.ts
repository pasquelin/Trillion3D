import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = new URL('../../', import.meta.url);
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'gate',
  GIT_AUTHOR_EMAIL: 'gate@test',
  GIT_COMMITTER_NAME: 'gate',
  GIT_COMMITTER_EMAIL: 'gate@test',
};
const git = (cwd: string, ...args: string[]) =>
  spawnSync('git', args, { cwd, env, encoding: 'utf8' });
const ok = (cwd: string, ...args: string[]) => {
  const r = git(cwd, ...args);
  assert.equal(r.status, 0, r.stderr);
  return r;
};

// A throwaway repository with the tracked hooks active, a bare remote, and a local
// (tool-installed) hook that logs its calls — the situation of every developer checkout.
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'workflow-gates-'));
  const remote = join(root, 'remote.git');
  const work = join(root, 'work');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  execFileSync('git', ['init', '-q', '-b', 'develop', work]);
  cpSync(new URL('.githooks/', repo), join(work, '.githooks'), {
    recursive: true,
    verbatimSymlinks: true,
  });
  ok(work, 'config', 'core.hooksPath', '.githooks');
  ok(work, 'remote', 'add', 'origin', remote);
  writeFileSync(
    join(work, '.git/hooks/post-commit'),
    '#!/bin/sh\necho ran >> "$(git rev-parse --show-toplevel)/local.log"\n',
    { mode: 0o755 },
  );
  return work;
}

const commit = (
  cwd: string,
  message: string,
  files: Record<string, string> = { [`${Date.now()}-${Math.random()}.txt`]: message },
) => {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(cwd, name), text);
  ok(cwd, 'add', ...Object.keys(files));
  return git(cwd, 'commit', '-q', '-m', message);
};

test('pre-commit: only a branch named <issue>-<short-name> takes commits, even before its first commit', () => {
  const work = makeRepo();
  assert.match(commit(work, 'first on develop').stderr, /branch named <issue>-<short-name>/);
  ok(work, 'switch', '-q', '-c', '1abc-not-an-issue');
  assert.equal(commit(work, 'digits then letters').status, 1);
  ok(work, 'switch', '-q', '-c', '12-thing');
  assert.equal(commit(work, 'accepted').status, 0);
  ok(work, 'checkout', '-q', '--detach');
  assert.equal(commit(work, 'detached is allowed').status, 0);
});

test('pre-push: develop and main refuse a push, other branches accept it', () => {
  const work = makeRepo();
  ok(work, 'switch', '-q', '-c', '12-thing');
  commit(work, 'one');
  assert.equal(git(work, 'push', '-q', '-u', 'origin', '12-thing').status, 0);
  assert.match(
    git(work, 'push', '-q', 'origin', '12-thing:develop').stderr,
    /no push to 'develop'/,
  );
  assert.match(git(work, 'push', '-q', 'origin', '12-thing:main').stderr, /no push to 'main'/);
});

test('the tool-installed hook of the same name still runs behind core.hooksPath', () => {
  const work = makeRepo();
  ok(work, 'switch', '-q', '-c', '12-thing');
  commit(work, 'one');
  assert.equal(execFileSync('cat', [join(work, 'local.log')], { encoding: 'utf8' }), 'ran\n');
});

const checkSize = (cwd: string) =>
  spawnSync(process.execPath, [new URL('scripts/check-pr-size.ts', repo).pathname, 'base'], {
    cwd,
    encoding: 'utf8',
  });

test("check-pr-size: more than 1,500 hand-written lines fail, with the base's attributes", () => {
  const work = makeRepo();
  ok(work, 'switch', '-q', '-c', '12-thing');
  const attributes = readFileSync(new URL('.gitattributes', repo), 'utf8');
  mkdirSync(join(work, 'src'));
  assert.equal(
    commit(work, 'base', { '.gitattributes': attributes, 'old.ts': 'x\n'.repeat(50) }).status,
    0,
  );
  ok(work, 'tag', 'base');
  ok(work, 'rm', '-q', 'old.ts');
  const files = {
    'pnpm-lock.yaml': 'x\n'.repeat(1501),
    'a.ts': 'x\n'.repeat(1499),
    'src/b.ts': 'x\n',
    'image.bin': 'x\0\n'.repeat(700),
  };
  assert.equal(commit(work, 'lock, code, binary, deletion', files).status, 0);
  // From a subfolder: the whole tree still counts.
  const accepted = checkSize(join(work, 'src'));
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /added: 1500 \(limit 1500\)/);
  // The base's attributes decide: marking its own code generated does not exempt it.
  const selfExempt = { '.gitattributes': `${attributes}*.ts linguist-generated\n` };
  assert.equal(commit(work, 'self exemption', selfExempt).status, 0);
  const refused = checkSize(work);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /added: 1501 \(limit 1500\)/);
  assert.match(refused.stderr, /AGENTS\.md rule 5: narrow the issue/);
});
