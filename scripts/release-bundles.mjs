#!/usr/bin/env node
// The release publishes the bundles built from the merged sources: on a pull request to main, the
// CI runs this on the pull request's head branch (cut from main, develop merged in), builds the
// bundles and, when they differ from what the head carries, commits them on that branch and
// dispatches the validation again on the new head. It never pushes to main or develop: both
// refuse a direct push, so a release cut from develop itself stops here with the reason.
//
//   node scripts/release-bundles.mjs <head branch>            build, commit, push, re-validate
//   node scripts/release-bundles.mjs <head branch> --dry-run  build and print the decision only
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { BUNDLES, buildDocs } from './docs/bundles.mjs';

export const REBUILD_MESSAGE = 'docs(release): rebuild the published bundles';
const RELEASE_AUTHOR = {
  name: 'github-actions[bot]',
  email: '41898282+github-actions[bot]@users.noreply.github.com',
};
const PROTECTED = new Set(['develop', 'main']);
const PATHS = BUNDLES.map((bundle) => `docs/${bundle}`);

/**
 * What the workflow does with the bundles it just built. A head that is already its own rebuild
 * and still differs from a fresh build is a build that does not reproduce: stop rather than
 * push rebuild upon rebuild.
 */
export function releaseDecision({ changed, headIsRebuild }) {
  if (!changed) return { action: 'skip', reason: 'the head already carries the bundles' };
  if (headIsRebuild)
    return { action: 'fail', reason: 'the head is a rebuild and still differs: not reproducible' };
  return { action: 'commit', reason: 'the bundles differ from the head' };
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (import.meta.filename === process.argv[1]) {
  const root = resolve(import.meta.dirname, '..');
  const [branch, flag] = process.argv.slice(2);
  const dryRun = flag === '--dry-run';
  if (!branch || PROTECTED.has(branch))
    fail('Usage: release-bundles.mjs <head branch>; the release branch is cut from main.');
  try {
    if (!dryRun) git(root, 'merge-base', '--is-ancestor', 'origin/main', 'HEAD');
  } catch {
    fail('The release branch does not contain origin/main: merge it first.');
  }
  await buildDocs(root);
  const decision = releaseDecision({
    changed: git(root, 'status', '--porcelain', '--ignored', '--', ...PATHS) !== '',
    headIsRebuild: git(root, 'log', '-1', '--format=%s') === REBUILD_MESSAGE,
  });
  console.log(`${decision.action}: ${decision.reason}.`);
  if (decision.action === 'fail') process.exit(1);
  if (decision.action === 'skip' || dryRun) process.exit(0);
  git(root, 'add', '--force', '--', ...PATHS);
  git(
    root,
    '-c',
    `user.name=${RELEASE_AUTHOR.name}`,
    '-c',
    `user.email=${RELEASE_AUTHOR.email}`,
    'commit',
    '--message',
    REBUILD_MESSAGE,
  );
  git(root, 'push', 'origin', `HEAD:refs/heads/${branch}`);
  execFileSync('gh', ['workflow', 'run', 'quality.yml', '--ref', branch], {
    cwd: root,
    stdio: 'inherit',
  });
  console.log(`Pushed the rebuild on ${branch} and dispatched its validation.`);
}
