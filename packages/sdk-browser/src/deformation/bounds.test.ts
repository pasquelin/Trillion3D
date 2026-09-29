// A deformed cluster is never culled (#357): the reach a placement's palette gives bounds every
// vertex its joints move, and the cut, its bounds grown by that reach, keeps a cluster the
// deformation carried into the view from outside it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { paletteReach, PALETTE_FLOATS } from '../../../sdk-core/src/world/animation/skeleton.ts';
import * as G from '../host/graph/graph.fixture.ts';
import { collectClusterPages, selectVisiblePages } from '../page/selection/selection.ts';
import { dagFixture } from '../page/selection/dag.fixture.ts';
import { cameraMoteur } from '../camera/camera.fixture.ts';
import { createHeldResidency } from '../page/cut/held.ts';

/** A seeded generator, so a failure names the case it met. */
function random(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
}

test('every vertex a palette carries lies within its rest box grown by the palette reach', () => {
  const next = random(357);
  for (let trial = 0; trial < 200; trial++) {
    // Two joints, twelve vertices each leaning on both, as the compiler measures their balls.
    const vertices = Array.from({ length: 12 }, () => [next() * 3, next() * 3, next() * 3]);
    const weights = vertices.map(() => Math.abs(next()));
    const palette = new Float32Array(2 * PALETTE_FLOATS);
    for (let j = 0; j < 2; j++) {
      const [a, b, c] = [next() * Math.PI, next() * Math.PI, next()];
      const [ca, sa, cb, sb] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)];
      // A turn about z then x, a stretch of up to a half, a slide of up to four units.
      const rows = [
        [ca * (1 + c / 2), -sa, 0, next() * 4],
        [sa * cb, ca * cb, -sb, next() * 4],
        [sa * sb, ca * sb, cb, next() * 4],
      ];
      palette.set(rows.flat(), j * PALETTE_FLOATS);
    }
    const low = [0, 1, 2].map((c) => Math.min(...vertices.map((v) => v[c]))),
      high = [0, 1, 2].map((c) => Math.max(...vertices.map((v) => v[c])));
    const centre = low.map((l, c) => (l + high[c]) / 2),
      radius = Math.hypot(...high.map((h, c) => h - centre[c]));
    const reach = paletteReach(palette, 0, 2, [...centre, radius, ...centre, radius]);
    vertices.forEach((v, i) => {
      const moved = [0, 1, 2].map((row) => {
        const at = (j: number) => j * PALETTE_FLOATS + row * 4;
        const carried = (j: number) =>
          palette[at(j)] * v[0] +
          palette[at(j) + 1] * v[1] +
          palette[at(j) + 2] * v[2] +
          palette[at(j) + 3];
        return weights[i] * carried(0) + (1 - weights[i]) * carried(1);
      });
      for (let c = 0; c < 3; c++)
        assert.ok(
          moved[c] >= low[c] - reach - 1e-4 && moved[c] <= high[c] + reach + 1e-4,
          `trial ${trial}`,
        );
    });
  }
});

test('the cut keeps a cluster its deformation carries into the view, and culls it at rest', () => {
  const cam = G.perspectiveCamera(55, 16 / 9, 0.1, 1000);
  cam.position.set(0, 0, 5);
  cam.lookAt(100, 0, 5);
  cam.updateMatrixWorld();
  const shown = (reach: number) => {
    const fixture = dagFixture();
    const { roots } = collectClusterPages(
      fixture.source,
      fixture.metadata,
      fixture.indices,
      fixture.associations,
    );
    roots[0].reach = reach;
    const ask = {
      pixelError: 0,
      viewport: [1280, 720] as [number, number],
      held: createHeldResidency(),
    };
    const count = selectVisiblePages(roots, cameraMoteur(cam), ask).shown.length;
    fixture.geometry.dispose();
    return count;
  };
  // At rest the strip stands five units beside the eye and at most two ahead: out of view.
  assert.equal(shown(0), 0);
  // Carried up to five units, it may stand ahead of the eye: the cut keeps it.
  assert.ok(shown(5) > 0);
});
