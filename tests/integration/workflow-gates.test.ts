import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

const localHook = (work: string, name: string, body: string) =>
  writeFileSync(join(work, '.git/hooks', name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });

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
  cpSync(new URL('scripts/hooks/', repo), join(work, 'scripts/hooks'), { recursive: true });
  ok(work, 'config', 'core.hooksPath', '.githooks');
  ok(work, 'remote', 'add', 'origin', remote);
  localHook(work, 'post-commit', 'echo ran >> "$(git rev-parse --show-toplevel)/local.log"');
  return work;
}

const commit = (cwd: string, message: string) => {
  const name = `${Date.now()}-${Math.random()}.txt`;
  writeFileSync(join(cwd, name), message);
  ok(cwd, 'add', name);
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

test('a failing tool-installed hook still stops git, and pre-push hands it the refs on stdin', () => {
  const work = makeRepo();
  ok(work, 'switch', '-q', '-c', '12-thing');
  localHook(work, 'pre-commit', 'exit 3');
  assert.equal(commit(work, 'refused locally').status, 1);
  localHook(work, 'pre-commit', 'exit 0');
  commit(work, 'one');
  localHook(work, 'pre-push', 'cat > "$(git rev-parse --show-toplevel)/refs.log"; exit 4');
  assert.notEqual(git(work, 'push', '-q', 'origin', '12-thing').status, 0);
  const refs = readFileSync(join(work, 'refs.log'), 'utf8');
  assert.match(refs, /^refs\/heads\/12-thing [0-9a-f]{40} refs\/heads\/12-thing 0{40}\n$/);
});

test('the tracked hooks hold no shell logic: each is a one-line shim onto scripts/hooks', () => {
  const hooks = new URL('.githooks/', repo);
  for (const name of readdirSync(hooks)) {
    const lines = readFileSync(new URL(name, hooks), 'utf8').trimEnd().split('\n');
    assert.equal(lines[0], '#!/bin/sh', name);
    assert.equal(lines.length, 2, `${name} is more than a shim`);
    const script = /^exec node (scripts\/hooks\/[a-z-]+\.ts) .*"\$@"$/.exec(lines[1] ?? '');
    assert.ok(script?.[1], `${name} does not run a scripts/hooks script`);
    readFileSync(new URL(script[1], repo));
  }
});
