// #1314 To-do 3: `selectVisiblePages` consumes the impostor plan's `switched`, so a switched
// root's clusters are dropped in the same breath as the card `planImpostors` yields for it. The
// option is indexed by the root's rank in the plan's `roots` array and is inert when absent, which
// keeps WebGL2 and any pre-impostor cache byte-for-byte unchanged. Fails on develop: the `switched`
// option, its suppression and this file are new.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planImpostors, type ImpostorSection } from '../../../../sdk-core/src/index.ts';
import { collectClusterPages, selectVisiblePages } from '../selection/selection.ts';
import { dagFixture, frontCamera } from '../selection/dag.fixture.ts';
import { createEngineCamera, readCameraWorld } from '../../camera/world.ts';
import { pixelScaleOf } from '../../streaming/priority.ts';

/** The engine camera of a host camera, as frame entry reads it (`readCameraWorld`). */
const engineOf = (cam: ReturnType<typeof frontCamera>) =>
  readCameraWorld(createEngineCamera(), cam);

const VIEWPORT: [number, number] = [1280, 720];
const FOCAL = 1117;
/** The compiled mesh number of the fixture's one root. Deliberately not 0: it differs from the
 *  root's rank, so a cut keying `switched` by mesh instead of rank would not suppress it. */
const MESH = 3;
/** A baked atlas for the fixture's one mesh: at the engine's runtime focal its switch depth falls
 *  between the near (5 m) and far (200 m) cameras below. */
const section: ImpostorSection = {
  version: 1,
  frames: 12,
  focalPixels: FOCAL,
  textureLimit: 8192,
  baked: 1,
  refused: 0,
  meshes: [
    {
      mesh: MESH,
      sourceMesh: MESH,
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
  for (const root of roots) root.mesh = MESH;
  return { fixture, roots };
}

/** The focal length in pixels the engine's one `pixelScaleOf` reads off the camera's projection. */
function focalPixels(cam: ReturnType<typeof frontCamera>) {
  const scale = pixelScaleOf(engineOf(cam).projection, VIEWPORT, [0, 0]);
  return Math.max(scale[0], scale[1]);
}

/** A plan as a backend builds it: the engine camera's world-to-view and the pixel focal. */
function planFor(
  cam: ReturnType<typeof frontCamera>,
  roots: ReturnType<typeof impostorRoots>['roots'],
) {
  return planImpostors(roots, section, engineOf(cam).view, focalPixels(cam));
}

test('a switched root is suppressed by the cut, by its rank in the plan', () => {
  const { fixture, roots } = impostorRoots();
  const near = frontCamera(5),
    far = frontCamera(200, 5000);
  // The far camera switches the root; the near one draws it whole, so the switch is the view's.
  const plan = planFor(far, roots);
  assert.deepEqual([...plan.switched], [1], 'the far root switches');
  assert.equal(plan.cards.length, 1);
  assert.equal(plan.cards[0]?.mesh, MESH, 'the card reports the mesh, the skip reads the rank');
  assert.deepEqual([...planFor(near, roots).switched], [0], 'the near root does not');
  // Without the option the root's clusters are cut as before; with the plan's `switched` they are
  // gone — the skip and the card are one decision.
  const whole = selectVisiblePages(roots, engineOf(far), {
    pixelError: 0,
    viewport: VIEWPORT,
  });
  assert.ok(whole.shown.length > 0, 'the root draws whole without the plan');
  const carded = selectVisiblePages(roots, engineOf(far), {
    pixelError: 0,
    viewport: VIEWPORT,
    switched: plan.switched,
  });
  assert.deepEqual(carded.shown, [], 'the switched root shows no cluster');
  assert.deepEqual(carded.wanted, [], 'the switched root wants no cluster');
  fixture.geometry.dispose();
});
