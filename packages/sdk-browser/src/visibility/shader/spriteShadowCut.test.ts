// #364: a sprite casts no shadow. Its root carries `SPRITE_ROOT`, so the CPU light cut, the GPU
// light cut and its oracle open no descent on it, and the sun's scene box leaves it out: no
// caster row, no draw, no stretched depth range. Every other surface is selected as before.
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

test('the GPU light cut deposits no root for a sprite in its first queue', () => {
  assert.ok(
    DAG_SELECTION_SHADER.includes(
      'let root=select(rootOf(w),0xffffffffu,isLightCut()&&spriteOf(w)!=0u);',
    ),
  );
});

test('the shadow scene box leaves every sprite root out', () => {
  const sceneBox = createShadowSceneBox();
  const { min, max } = sceneBox({
    selectionRoots: [
      { worldBox: Float64Array.of(-1, -1, -1, 1, 1, 1) },
      { worldBox: Float64Array.of(50, 50, 50, 60, 60, 60), sprite: 1 },
      { worldBox: Float64Array.of(-60, -60, -60, -50, -50, -50), sprite: 3 },
    ],
    rows: { tableEpoch: 0 },
  });
  assert.deepEqual([...min, ...max], [-1, -1, -1, 1, 1, 1]);
});
