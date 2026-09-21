import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseDecision } from './release-bundles.mjs';

// The workflow's decision, without git: build once, then commit, leave, or stop.
test('bundles identical to the head are left alone', () => {
  assert.equal(releaseDecision({ changed: false, headIsRebuild: false }).action, 'skip');
  assert.equal(releaseDecision({ changed: false, headIsRebuild: true }).action, 'skip');
});

test('bundles that differ are committed on the head branch', () => {
  assert.equal(releaseDecision({ changed: true, headIsRebuild: false }).action, 'commit');
});

test('a rebuild that still differs stops the release instead of looping', () => {
  const decision = releaseDecision({ changed: true, headIsRebuild: true });
  assert.equal(decision.action, 'fail');
  assert.match(decision.reason, /not reproducible/);
});
