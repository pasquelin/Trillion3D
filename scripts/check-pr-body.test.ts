import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { bodyProblem, proofLines, proofProblem } from './check-pr-body.ts';

const template = readFileSync(
  new URL('../.github/PULL_REQUEST_TEMPLATE.md', import.meta.url),
  'utf8',
);
const linked = template.replace('Closes #', 'Closes #65');
const verify = (body: string) =>
  body.replace('## Not proven', '- Item: delivered in a.ts:1, proved by a test\n\n## Not proven');
const review = (body: string) =>
  body
    .replace('- Simplification pass:', '- Simplification pass: nothing to change')
    .replace('- Correctness review:', '- Correctness review: one fix');
const problem = (body: string, draft = false) => bodyProblem(body, draft) ?? '';
const issue = [
  '## To do',
  '- [ ] a step',
  '',
  '## Proof',
  '<!-- how it is proved -->',
  '- [ ] The count per shard adds up to the full count, shown in the PR.',
  '- `validate` needs every job.',
  '',
  '## Refused',
].join('\n');

test('check-pr-body: the script reads stdin, PR_DRAFT and ISSUE_BODY, and exits 1 on a refusal', () => {
  const run = (body: string, env: Record<string, string>) =>
    spawnSync(process.execPath, [new URL('check-pr-body.ts', import.meta.url).pathname], {
      input: body,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, ...env },
    });
  assert.equal(run(review(linked), { PR_DRAFT: 'true' }).status, 0);
  const refused = run(review(linked), { PR_DRAFT: 'false', ISSUE_BODY: '' });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /"Lead verification" is missing or empty/);
  const unproved = run(review(verify(linked)), { PR_DRAFT: 'false', ISSUE_BODY: issue });
  assert.equal(unproved.status, 1);
  assert.match(unproved.stderr, /Proof line "the count per shard/);
  // In the CI, a lost token fails the check instead of skipping the issue's Proof lines.
  const tokenless = run(review(verify(linked)), { PR_DRAFT: 'false', CI: 'true' });
  assert.equal(tokenless.status, 1);
  assert.match(tokenless.stderr, /GITHUB_TOKEN and GITHUB_REPOSITORY are required/);
});

test('check-pr-body: the untouched template is refused, a filled one accepted', () => {
  assert.match(problem(template), /must start with "Closes #<issue>"/);
  assert.match(problem(linked), /"Lead verification" is missing or empty/);
  const verified = verify(linked);
  assert.match(problem(verified), /no "Simplification pass:" line/);
  const filled = review(verified);
  assert.equal(problem(filled), '');
  assert.match(problem(filled.replace(': one fix', ':')), /no "Correctness review:" line/);
  const dropped = filled.replace(/(## Lead verification\n+)/, '$1- Item two: not delivered\n');
  assert.match(problem(dropped), /not delivered" without the boss's yes/);
  assert.equal(
    problem(dropped.replace('not delivered', "not delivered, the boss's yes on #65")),
    '',
  );
  // The old tool-named lines no longer stand for the review.
  const tooled = verified.replace(
    '- Simplification pass:\n- Correctness review:',
    '- `/simplify`: nothing to change\n- `/code-review`: one fix',
  );
  assert.notEqual(tooled, verified);
  assert.match(problem(tooled), /no "Simplification pass:" line/);
});

test('check-pr-body: a pull request closes its issue, "Part of" is refused anywhere', () => {
  const filled = review(verify(linked));
  assert.match(problem(filled.replace('Closes #65', 'Part of #65')), /must start with "Closes/);
  const both = filled.replace('## What changed', 'Part of #65\n\n## What changed');
  assert.match(problem(both), /says "Part of": one pull request closes one issue/);
  assert.match(problem(filled.replace('Closes #65', 'Closes #65 (part of #483)')), /Part of/);
  // The closer's grammar: code and HTML comments never count.
  assert.equal(
    problem(filled.replace('## What changed', 'Write `Part of #6`.\n\n## What changed')),
    '',
  );
  assert.equal(
    problem(filled.replace('## What changed', '<!-- Part of #6 -->\n## What changed')),
    '',
  );
});

test('check-pr-body: a draft passes without Lead verification, a ready pull request needs it', () => {
  const reviewed = review(linked);
  assert.equal(problem(reviewed, true), '');
  assert.match(problem(reviewed), /"Lead verification" is missing or empty/);
  assert.equal(problem(verify(reviewed)), '');
  assert.match(problem(template, true), /must start with "Closes #<issue>"/);
  assert.match(problem(linked, true), /no "Simplification pass:" line/);
});

test("check-pr-body: the issue's Proof lines, as plain text, without comments or check boxes", () => {
  assert.deepEqual(proofLines(issue), [
    'the count per shard adds up to the full count, shown in the pr.',
    'validate needs every job.',
  ]);
  assert.deepEqual(proofLines('## To do\n- x'), []);
});

test('check-pr-body: every Proof line is proved in Lead verification, or waived by the boss', () => {
  const answer = (item: string, rest = 'delivered in a.ts:1, proved by a test') =>
    `- ${item}: ${rest}\n`;
  const body = (lines: string, notProven = '') =>
    review(linked).replace(
      '## Not proven / left out',
      `${lines}\n## Not proven / left out\n${notProven}`,
    );
  const shards = 'The count per shard adds up to the full count';
  const validate = '`validate` needs every job';
  assert.equal(proofProblem(body(answer(shards) + answer(validate)), issue), undefined);
  // One line missing, or answered without its test, or not delivered, is refused.
  assert.match(proofProblem(body(answer(shards)), issue) ?? '', /"validate needs every job\."/);
  const noTest = answer(shards) + answer(validate, 'delivered in a.ts:1');
  assert.match(proofProblem(body(noTest), issue) ?? '', /validate needs every job/);
  const notDelivered = answer(shards) + answer(validate, 'not delivered, proved by nothing');
  assert.match(proofProblem(body(notDelivered), issue) ?? '', /validate needs every job/);
  // A quote shorter than 20 characters of a longer line does not answer it.
  const vague = answer('The count') + answer(validate);
  assert.match(proofProblem(body(vague), issue) ?? '', /the count per shard/);
  // Under "Not proven", only the boss's yes waives a line.
  const waived = `- ${shards}: after merge, the boss's yes on #1054\n`;
  assert.equal(proofProblem(body(answer(validate), waived), issue), undefined);
  const unwaived = `- ${shards}: after merge\n`;
  assert.match(proofProblem(body(answer(validate), unwaived), issue) ?? '', /the count per shard/);
  // An issue with no Proof section asks nothing.
  assert.equal(proofProblem(body(''), '## To do\n- x'), undefined);
  // bodyProblem asks the Proof lines of a ready pull request only, never of a draft or a thumbnail.
  const verified = review(verify(linked));
  assert.match(bodyProblem(verified, false, [issue]) ?? '', /the count per shard/);
  assert.equal(bodyProblem(verified, true, [issue]), undefined);
  const thumbnail = verified.replace('## What changed', '## What changed\n\nThumbnail only.');
  assert.equal(bodyProblem(thumbnail, false, [issue]), undefined);
});

test('pr-body.yml gives the check the token that reads the closed issue', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/pr-body.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /^ {2}issues: read$/m);
  assert.match(
    workflow,
    /GITHUB_TOKEN: \$\{\{ github\.token \}\}\n.*node scripts\/check-pr-body\.ts/,
  );
});
