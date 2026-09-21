import test from 'node:test';
import { assertAdvancedDiagramsMountFiniteGeometry } from './docs-gallery-diagram-fixture.ts';

test('all four advanced lessons mount their complementary diagram with finite geometry', () => {
  assertAdvancedDiagramsMountFiniteGeometry();
});
