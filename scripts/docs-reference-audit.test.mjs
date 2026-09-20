import assert from 'node:assert/strict';
import test from 'node:test';
import audit from '../docs/data/gallery-reference-audit.json' with { type: 'json' };
import roadmap from '../docs/data/gallery-roadmap.json' with { type: 'json' };
import { rendererLessons } from '../docs/js/gallery/rendererLessons.js';

const states = (field) =>
  audit.entries.reduce((counts, entry) => {
    const state = entry[field].state;
    counts[state] = (counts[state] ?? 0) + 1;
    return counts;
  }, {});

test('reference audit has exactly one ordered row per roadmap topic', () => {
  assert.equal(audit.schema, 1);
  assert.equal(audit.entries.length, 607);
  assert.deepEqual(
    audit.entries.map(({ id }) => id),
    roadmap.entries.map(({ id }) => id),
  );
  assert.equal(audit.summary.topics, audit.entries.length);
  assert.deepEqual(audit.summary.visual, states('visualReview'));
  assert.deepEqual(audit.summary.capability, states('capabilityReview'));
});

test('visual review states never turn an unobserved reference into evidence', () => {
  for (const row of audit.entries) {
    assert.match(row.referenceUrl, /^https:\/\/threejs\.org\/examples\/(?:#|)[\w.-]+\.?(?:html)?$/);
    assert.ok(['reviewed', 'incomplete', 'pending'].includes(row.visualReview.state));
    if (row.visualReview.state === 'pending') {
      assert.equal(row.visualReview.observed, null);
      assert.equal(row.visualReview.interaction, null);
    } else assert.ok(row.visualReview.observed?.length > 20, row.id);
    if (row.visualReview.state === 'incomplete')
      assert.ok(row.visualReview.limitation?.length > 10, row.id);
  }
});

test('capability states distinguish delivered, blocked and unaudited topics', () => {
  const lessons = new Map(rendererLessons.map((lesson) => [lesson.id, lesson]));
  for (const [index, row] of audit.entries.entries()) {
    assert.ok(row.originalGoal.length > 20, roadmap.entries[index].id);
    assert.ok(['supported', 'feasible', 'blocked', 'pending'].includes(row.capabilityReview.state));
    assert.ok(row.capabilityReview.reason.length > 20, row.id);
    assert.equal(new Set(row.closestLessons).size, row.closestLessons.length, row.id);
    for (const lessonId of row.closestLessons) assert.ok(lessons.has(lessonId), lessonId);
    if (row.capabilityReview.state === 'supported')
      assert.ok(
        row.closestLessons.some(
          (lessonId) => lessons.get(lessonId).referenceCoverage?.[row.id] === 'full',
        ),
        row.id,
      );
    if (
      /not been verified|must be audited|source-format importer/i.test(row.capabilityReview.reason)
    )
      assert.equal(row.capabilityReview.state, 'pending', row.id);
  }
});
