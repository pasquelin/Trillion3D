// #364: a sprite casts no shadow. Its root carries `SPRITE_ROOT`, so the CPU light cut, the GPU
// light cut and its oracle open no descent on it, and the sun's scene box leaves it out: no
// caster row, no draw, no stretched depth range. Every other surface is selected as before.
// #456: a mesh set `castShadow = false` is left out of both light cuts the same way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dagFixture, wideCamera } from '../../page/selection/dag.fixture.ts';
import { collectClusterPages, selectVisiblePages } from '../../page/selection/selection.ts';
import { createEngineCamera, readCameraWorld } from '../../camera/world.ts';
import { kernelUniforms, packed, VIEWPORT } from '../../gpu/dag/selectionHelpers.fixture.ts';
import { DAG_SELECTION_SHADER, evaluateDagSelectionKernel } from '../../gpu/dag/selection.ts';
import { createShadowSceneBox } from '../../webgpu/shadow/sceneBox.ts';
import {
  createLightPages,
  markLightPages,
} from '../../../../sdk-core/src/scene/light-shadow/pageOverlap.ts';

/** The test DAG, worn as a sprite when `sizeAttenuation` is given. */
function surfaceFixture(sizeAttenuation?: boolean) {
  const fixture = dagFixture();
  if (sizeAttenuation !== undefined)
    Object.assign(fixture.mesh.material, { sprite: true, rotation: 0, sizeAttenuation });
  return fixture;
}

/** A light over every page of its face, seen from the wide camera: it covers the whole DAG. */
function everyPage() {
  const light = createLightPages();
  markLightPages(light, 0, 0, 0, 0);
  return light;
}

function lightCut(fixture: ReturnType<typeof dagFixture>) {
  const light = everyPage(),
    cam = readCameraWorld(createEngineCamera(), wideCamera());
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const cpu = selectVisiblePages(roots, cam, { pixelError: 0, viewport: VIEWPORT, light }).shown;
  const gpu = packed(fixture);
  const uniforms = kernelUniforms(gpu.dag, gpu.roots, wideCamera(), 0);
  const kernel = evaluateDagSelectionKernel(gpu.dag, { ...uniforms, light }).pageIds;
  fixture.geometry.dispose();
  return { cpu: cpu.length, gpu: kernel.length };
}

test('the CPU and GPU light cuts select no sprite, attenuated or not, and every other surface', () => {
  const plain = lightCut(surfaceFixture());
  assert.ok(plain.cpu > 0 && plain.gpu > 0, 'a surface that is no sprite still casts');
  for (const sizeAttenuation of [true, false])
    assert.deepEqual(lightCut(surfaceFixture(sizeAttenuation)), { cpu: 0, gpu: 0 });
});

test('the CPU and GPU light cuts select no mesh set to cast no shadow', () => {
  const fixture = dagFixture();
  assert.equal(fixture.mesh.castShadow, true, 'a mesh casts unless it says otherwise');
  fixture.mesh.castShadow = false;
  assert.deepEqual(lightCut(fixture), { cpu: 0, gpu: 0 });
});

test('the GPU light cut deposits no root for a sprite in its first queue', () => {
  assert.ok(
    DAG_SELECTION_SHADER.includes(
      'let root=select(rootOf(w),0xffffffffu,isLightCut()&&(markOf(w)&5u)!=0u);',
    ),
  );
});

test('the shadow scene box leaves every sprite root out', () => {
  const sceneBox = createShadowSceneBox();
  const { min, max } = sceneBox({
    selectionRoots: [
      { worldBox: Float64Array.of(-1, -1, -1, 1, 1, 1) },
      { worldBox: Float64Array.of(50, 50, 50, 60, 60, 60), mark: 1 },
      { worldBox: Float64Array.of(-60, -60, -60, -50, -50, -50), mark: 3 },
    ],
    rows: { tableEpoch: 0 },
  });
  assert.deepEqual([...min, ...max], [-1, -1, -1, 1, 1, 1]);
});

test('the shadow scene box follows a pose the engine moved, with no table change', () => {
  const sceneBox = createShadowSceneBox(),
    worldBox = Float64Array.of(-1, -1, -1, 1, 1, 1),
    layout = { selectionRoots: [{ worldBox }], rows: { tableEpoch: 0 } };
  sceneBox(layout, 0);
  // A placement or engine pose moves the root's box and bumps the scene revision alone.
  worldBox.set([9, -1, -1, 11, 1, 1]);
  const { min, max } = sceneBox(layout, 1);
  assert.deepEqual([...min, ...max], [9, -1, -1, 11, 1, 1]);
});
