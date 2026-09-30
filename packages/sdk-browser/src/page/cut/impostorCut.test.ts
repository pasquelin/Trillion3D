// #1314 To-do 3: `selectVisiblePages` consumes the impostor plan's `switched`, so a switched
// root's clusters are dropped in the same breath as the card `planImpostors` yields for it. Both
// backends read the one plan (sdk-core `planImpostors`), so they suppress identically. Fails on
// develop: the `switched` option, its suppression and this file are new.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planImpostors, type ImpostorSection } from '../../../../sdk-core/src/index.ts';
import { collectClusterPages, selectVisiblePages } from '../selection/selection.ts';
import { dagFixture, frontCamera } from '../selection/dag.fixture.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';
import { pixelScaleOf } from '../../streaming/priority.ts';

const VIEWPORT: [number, number] = [1280, 720];
const FOCAL = 1117;
/** A baked atlas for the fixture's one mesh: `z_s = max(2·1·1117/64, 1·1117·√(0.5π/100)) ≈ 140 m`,
 *  so the near camera cuts the root whole and the far one switches it to its card. */
const section: ImpostorSection = {
  version: 1,
  frames: 12,
  focalPixels: FOCAL,
  textureLimit: 8192,
  baked: 1,
  refused: 0,
  meshes: [
    {
      mesh: 0,
      sourceMesh: 0,
      name: 'fixture',
      placements: 1,
      masked: false,
      rootTriangles: 100,
      radius: 1,
      status: 'baked',
      coverage: 0.5,
      hemi: false,
      frames: 12,
      frameSide: 64,
      atlasSide: 768,
      objectRadius: 1,
      switchDepth: { texel: 0, triangles: 0 },
      maps: {
        colourCoverage: { kind: 'coverage', levels: [] },
        normalDepth: { kind: 'data', levels: [] },
        orm: { kind: 'data', levels: [] },
      },
    },
  ],
};

/** The fixture's one root, keyed to the baked mesh; its world is the identity, so the camera's own
 *  distance sets the view depth the switch reads. */
function impostorRoots() {
  const fixture = dagFixture();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  for (const root of roots) root.mesh = 0;
  return { fixture, roots };
}

/** The focal length in pixels the engine's one `pixelScaleOf` reads off the camera's projection. */
function focalPixels(cam: ReturnType<typeof frontCamera>) {
  const scale = pixelScaleOf(cameraMoteur(cam).projection, VIEWPORT, [0, 0]);
  return Math.max(scale[0], scale[1]);
}

/** A plan as a backend builds it: the engine camera's world-to-view and the pixel focal. */
function planFor(cam: ReturnType<typeof frontCamera>, roots: ReturnType<typeof impostorRoots>) {
  return planImpostors(roots.roots, section, cameraMoteur(cam).view, focalPixels(cam));
}

test('a switched root is suppressed by the cut and yields its card, the two backends alike', () => {
  const { fixture, roots } = impostorRoots();
  const near = frontCamera(5),
    far = frontCamera(200, 5000);
  // The one plan: each backend hands it its own world-to-view and its own focal, and both read
  // the same shared oracle, so their suppression and their cards are identical.
  const wgpu = planFor(far, { fixture, roots }),
    webgl2 = planFor(far, { fixture, roots });
  assert.deepEqual([...webgl2.switched], [...wgpu.switched], 'one plan for both backends');
  assert.deepEqual(
    webgl2.cards.map((card) => [card.root, card.mesh, card.radius]),
    wgpu.cards.map((card) => [card.root, card.mesh, card.radius]),
    'one card for both backends',
  );
  // The far camera switches the root; the near one draws it whole, so the switch is the view's.
  assert.deepEqual([...wgpu.switched], [1], 'the far root switches');
  assert.equal(wgpu.cards.length, 1);
  assert.deepEqual([...planFor(near, { fixture, roots }).switched], [0], 'the near root does not');
  // Without the option the root's clusters are cut as before; with the plan's `switched` they are
  // gone — the skip and the card are one decision.
  const whole = selectVisiblePages(roots, cameraMoteur(far), {
    pixelError: 0,
    viewport: VIEWPORT,
  });
  assert.ok(whole.shown.length > 0, 'the root draws whole without the plan');
  const carded = selectVisiblePages(roots, cameraMoteur(far), {
    pixelError: 0,
    viewport: VIEWPORT,
    switched: wgpu.switched,
  });
  assert.deepEqual(carded.shown, [], 'the switched root shows no cluster');
  assert.deepEqual(carded.wanted, [], 'the switched root wants no cluster');
  fixture.geometry.dispose();
});
