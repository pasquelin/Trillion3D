import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
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
const git = (cwd, ...args) => spawnSync('git', args, { cwd, env, encoding: 'utf8' });
const ok = (cwd, ...args) => {
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

const commit = (cwd, message) => {
  writeFileSync(join(cwd, `${Date.now()}-${Math.random()}.txt`), message);
  ok(cwd, 'add', '-A');
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

const checkBody = (body) =>
  spawnSync(new URL('scripts/check-pr-body.sh', repo).pathname, [], {
    input: body,
    encoding: 'utf8',
  });
const template = () =>
  execFileSync('cat', [new URL('.github/PULL_REQUEST_TEMPLATE.md', repo).pathname], {
    encoding: 'utf8',
  });

test('check-pr-body: the untouched template is refused, a filled one accepted', () => {
  assert.match(checkBody(template()).stderr, /must start with "Closes #<issue>"/);
  const linked = template().replace('Closes #', 'Closes #65');
  assert.match(checkBody(linked).stderr, /"Local review before push" is empty/);
  const filled = linked.replace(
    '## Not proven',
    'simplify: nothing; review: one fix.\n\n## Not proven',
  );
  assert.equal(checkBody(filled).status, 0);
});
