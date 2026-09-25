// #364: a sprite that keeps its size on screen grows with its view depth, so no fixed world bound
// holds its quad: its root is never culled by a camera cut (`neverCulled`), and the shadow scene
// box leaves it out.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { dagFixture } from '../../page/selection/dag.fixture.ts';
import { dagCulling } from '../../page/selection/helpers.fixture.ts';
import { cpuUrls, kernelUrls, packed } from '../../gpu/dag/selectionHelpers.fixture.ts';
import { DAG_SELECTION_SHADER } from '../../gpu/dag/selection.ts';
import { primitiveFrameWords, primitiveWordAt } from '../../gpu/dag/worlds.ts';
import { createShadowSceneBox } from '../../webgpu/shadow/sceneBox.ts';
import { neverCulled } from './spriteWgsl.ts';

/** The test DAG worn as a sprite; `hierarchical` gives it its culling hierarchy. */
function spriteFixture(sizeAttenuation: boolean, hierarchical = false) {
  const fixture = dagFixture();
  Object.assign(fixture.mesh.material, { sprite: true, rotation: 0, sizeAttenuation });
  if (hierarchical) fixture.metadata.primitives[0].culling = dagCulling();
  return fixture;
}

/** A camera 100 m behind the sprite, looking away from it: its world box is out of view. */
function lookingAway() {
  const cam = G.perspectiveCamera(55, 16 / 9, 0.1, 1000);
  cam.position.set(0, 0, -100);
  cam.lookAt(0, 0, -1000);
  cam.updateMatrixWorld();
  return cam;
}

test('the mark is a sprite that keeps its size on screen, and nothing else', () => {
  assert.equal(neverCulled({ sprite: { rotation: 0, sizeAttenuation: false } }), true);
  assert.equal(neverCulled({ sprite: { rotation: 0, sizeAttenuation: true } }), false);
  assert.equal(neverCulled({}), false);
  assert.equal(neverCulled(undefined), false);
});

for (const hierarchical of [false, true])
  test(`the CPU and GPU cuts keep a constant-size sprite whose box is out of view (${hierarchical ? 'hierarchical' : 'flat'})`, () => {
    const constant = spriteFixture(false, hierarchical),
      attenuated = spriteFixture(true, hierarchical);
    const cam = lookingAway();
    assert.equal(packed(constant).roots[0].unculled, true, 'the root carries the mark');
    assert.equal(packed(attenuated).roots[0].unculled, undefined);
    assert.ok(cpuUrls(constant, 0, cam).length > 0, 'the CPU cut selects it');
    assert.ok(kernelUrls(constant, 0, cam).urls.length > 0, 'the GPU cut selects it');
    // A sprite that shrinks with distance, and every other surface, is culled as before.
    assert.deepEqual(cpuUrls(attenuated, 0, cam), []);
    assert.deepEqual(kernelUrls(attenuated, 0, cam).urls, []);
    constant.geometry.dispose();
    attenuated.geometry.dispose();
  });

test('the GPU cut reads the mark behind the record shift and opens its planes to the camera only', () => {
  const fixture = spriteFixture(false);
  const { dag } = packed(fixture);
  assert.deepEqual(Array.from(dag.unculled), [1]);
  const frames = new Uint32Array(primitiveFrameWords(dag).buffer);
  assert.equal(frames[primitiveWordAt(0) + 3], 1);
  assert.ok(DAG_SELECTION_SHADER.includes('let open=!isLightCut()&&unculledOf(w);'));
  assert.ok(
    DAG_SELECTION_SHADER.includes(
      'frames[base+i]=select(m*views[vi].planes[i],vec4f(0.0,0.0,0.0,1.0),open);',
    ),
  );
  assert.ok(
    DAG_SELECTION_SHADER.includes(
      'fn unculledOf(w:u32)->bool{return bitcast<u32>(frames[w*FRAME+6u].w)!=0u;}',
    ),
  );
  fixture.geometry.dispose();
});

test('the shadow scene box leaves a never-culled root out', () => {
  const sceneBox = createShadowSceneBox();
  const { min, max } = sceneBox({
    selectionRoots: [
      { worldBox: Float64Array.of(-1, -1, -1, 1, 1, 1) },
      { worldBox: Float64Array.of(50, 50, 50, 60, 60, 60), unculled: true },
    ],
    rows: { tableEpoch: 0 },
  });
  assert.deepEqual([...min, ...max], [-1, -1, -1, 1, 1, 1]);
});
