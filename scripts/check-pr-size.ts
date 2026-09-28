// Refuses a pull request that adds more than 1,500 hand-written lines (AGENTS.md rule 5: one issue,
// one small pull request). Paths marked `linguist-generated` or `linguist-vendored` in
// .gitattributes are left out, as the base marks them (a pull request cannot exempt its own
// files), and binary files count no line. The whole repository is counted, from any folder.
// Usage: node scripts/check-pr-size.ts [base]  (default $TRILLION3D_BASE_REF, the variable
// check:changed reads, else a freshly fetched origin/develop; the CI passes the base of its merge
// commit).
import { spawnSync } from 'node:child_process';

const limit = 1500;
const base = process.argv[2] || process.env.TRILLION3D_BASE_REF || 'origin/develop';
const pathspec = [
  ':/',
  ':(top,exclude,attr:linguist-generated)',
  ':(top,exclude,attr:linguist-vendored)',
];
const diff = spawnSync(
  'git',
  [`--attr-source=${base}`, 'diff', '--numstat', `${base}...HEAD`, '--', ...pathspec],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: Number.POSITIVE_INFINITY },
);
// A failing diff stops the gate instead of counting zero lines.
if (diff.error) throw diff.error;
if (diff.status !== 0) process.exit(diff.status ?? 1);
// A binary file shows "-" and counts no line.
const added = diff.stdout
  .split('\n')
  .reduce((sum, line) => sum + (Number.parseInt(line, 10) || 0), 0);
console.log(`Hand-written lines added: ${added} (limit ${limit}).`);
if (added > limit) {
  console.error(
    'Above the limit of AGENTS.md rule 5: narrow the issue to what one pull request closes.',
  );
  process.exitCode = 1;
}
