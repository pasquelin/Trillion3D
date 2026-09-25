import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bodyProblem } from '../../scripts/check-pr-body.ts';

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

const template = readFileSync(new URL('.github/PULL_REQUEST_TEMPLATE.md', repo), 'utf8');
const linked = template.replace('Closes #', 'Closes #65');
const verify = (body: string) =>
  body.replace('## Not proven', '- Item: delivered in a.ts:1, proved by a test\n\n## Not proven');
const review = (body: string) =>
  body
    .replace('- Simplification pass:', '- Simplification pass: nothing to change')
    .replace('- Correctness review:', '- Correctness review: one fix');
const ready = (body: string) => bodyProblem(body, false) ?? '';

test('check-pr-body: the script reads stdin and PR_DRAFT, and exits 1 on a refusal', () => {
  const run = (body: string, draft: string) =>
    spawnSync(process.execPath, [new URL('scripts/check-pr-body.ts', repo).pathname], {
      input: body,
      encoding: 'utf8',
      env: { ...process.env, PR_DRAFT: draft },
    });
  assert.equal(run(review(linked), 'true').status, 0);
  const refused = run(review(linked), 'false');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /"Lead verification" is missing or empty/);
});

test('check-pr-body: the untouched template is refused, a filled one accepted', () => {
  assert.match(ready(template), /must start with "Closes #<issue>"/);
  assert.match(ready(linked), /"Lead verification" is missing or empty/);
  const verified = verify(linked);
  assert.match(ready(verified), /no "Simplification pass:" line/);
  const filled = review(verified);
  assert.equal(bodyProblem(filled, false), undefined);
  assert.match(ready(filled.replace(': one fix', ':')), /no "Correctness review:" line/);
  // The old tool-named lines no longer stand for the review.
  const tooled = verified.replace(
    '- Simplification pass:\n- Correctness review:',
    '- `/simplify`: nothing to change\n- `/code-review`: one fix',
  );
  assert.match(ready(tooled), /no "Simplification pass:" line/);
});

test('check-pr-body: "Part of" is refused, alone or beside "Closes"', () => {
  const filled = review(verify(linked));
  const both = filled.replace('## What changed', 'Part of #65\n\n## What changed');
  assert.match(ready(both), /says "Part of #<issue>".*back to the CTO/);
  assert.match(ready(filled.replace('Closes #65', 'Part of #65')), /says "Part of #<issue>"/);
  assert.match(ready(filled.replace('Closes #65', 'Closes #65 (part of #483)')), /"Part of/);
});

test('check-pr-body: a draft passes without Lead verification, a ready pull request needs it', () => {
  const reviewed = review(linked);
  assert.equal(bodyProblem(reviewed, true), undefined);
  assert.match(ready(reviewed), /"Lead verification" is missing or empty/);
  assert.equal(bodyProblem(verify(reviewed), false), undefined);
  assert.match(bodyProblem(template, true) ?? '', /must start with "Closes #<issue>"/);
  assert.match(bodyProblem(linked, true) ?? '', /no "Simplification pass:" line/);
});

const checkSize = (cwd: string) =>
  spawnSync(process.execPath, [new URL('scripts/check-pr-size.ts', repo).pathname, 'base'], {
    cwd,
    encoding: 'utf8',
  });

test("check-pr-size: more than 600 hand-written lines fail, with the base's attributes", () => {
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
    'pnpm-lock.yaml': 'x\n'.repeat(601),
    'a.ts': 'x\n'.repeat(599),
    'src/b.ts': 'x\n',
    'image.bin': 'x\0\n'.repeat(700),
  };
  assert.equal(commit(work, 'lock, code, binary, deletion', files).status, 0);
  // From a subfolder: the whole tree still counts.
  const accepted = checkSize(join(work, 'src'));
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /added: 600 \(limit 600\)/);
  // The base's attributes decide: marking its own code generated does not exempt it.
  const selfExempt = { '.gitattributes': `${attributes}*.ts linguist-generated\n` };
  assert.equal(commit(work, 'self exemption', selfExempt).status, 0);
  const refused = checkSize(work);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /added: 601 \(limit 600\)/);
  assert.match(refused.stderr, /AGENTS\.md rule 11: the issue goes back to the CTO/);
  assert.doesNotMatch(refused.stderr, /Part of/);
});
