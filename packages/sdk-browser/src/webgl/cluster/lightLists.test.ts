import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext } from '../core/testContext.fixture.ts';
import { createHostDrawCamera } from '../../camera/world.ts';
import * as G from '../../host/graph/graph.fixture.ts';
import { Scene } from '../../world/core/scene.ts';
import type { WholeMesh } from '../../cluster/batchMesh.ts';
import { isLightNode } from '../../host/graph/kinds.ts';
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { createSceneDraw, keptClusterScene } from './sceneDraw.ts';
import { WebglClusterLights } from './lights.ts';
import type { Light } from '../../../../sdk-core/src/world/light/light.ts';
import {
  sphereTouchesBox,
  type Box,
} from '../../../../../bench/oracles/browser/gpuLightTileColumnOracle.ts';
import { CELL_MARGIN } from './lightGrid.ts';
import { evaluated, lightFrames, pointLamp, sent, triangle } from './lightGrid.fixture.ts';

// #835: WebGL2 draws every lamp of a scene, from a light texture grown with the count, and each
// fragment evaluates only the lamps whose range reaches its cell of the light grid — the lamps
// the CPU oracle of the tiles' light test (`sphereTouchesBox`) keeps for the cell's box.

const LAMPS = 300;
/** Lamp `i`: along x, above the meshes, its range one of four. */
const lamp = (i: number) => ({ x: i * 0.25 - 10, y: 1.5, z: 0.3, range: 1 + (i % 4) * 0.35 });
/** Mesh `m`'s centre on x: a unit triangle from `x - 0.5` to `x + 0.5`, height 1, at z 0. */
const meshX = (m: number) => -12 + m * 7;

function scene() {
  const scene = new Scene();
  for (let i = 0; i < LAMPS; i++) {
    const { x, y, z, range } = lamp(i);
    scene.add(new G.Light('point', { position: [x, y, z], distance: range }));
  }
  const sun = new G.Light('directional', { position: [0, 1, 0] });
  scene.add(sun, sun.target);
  scene.updateMatrixWorld(true);
  return scene;
}

/** One frame of `lights` over `meshes`, seen from the world's origin and axes. */
function drawLights(lights: readonly Light[], meshes: WholeMesh[]) {
  const { context, renderer, frame } = lightFrames(lights, meshes);
  frame();
  return { context, renderer };
}

test('300 lamps draw on WebGL2, each fragment walks the lamps the oracle says reach its cell', () => {
  const meshes = Array.from({ length: 12 }, (_, m) => triangle(meshX(m)));
  const lights = scene().children.filter(isLightNode);
  const { context, renderer } = drawLights(lights, meshes);
  assert.equal(
    context.of('drawElements').length,
    meshes.length,
    'every mesh in the final pass: matte meshes capture nothing (#1341)',
  );
  const records = sent(context, 'RGBA').at(-1)![8] as Float32Array;
  for (let i = 0; i < LAMPS; i++)
    assert.equal(records[i * 16 + 3], Math.fround(lamp(i).range), `lamp ${i} has its slot`);
  assert.equal(records[LAMPS * 16 + 7], 0, 'the sun takes the slot after the lamps');

  let sunOnly = 0;
  for (let px = -12; px <= 66; px += 0.37)
    for (const [py, pz] of [
      [0, 0],
      [1.5, 0.3],
      [0.8, -1.2],
    ]) {
      const { slots, inOrder, inGrid, box, side } = evaluated(context, [px, py, pz]);
      const reaches = (i: number) =>
        Math.hypot(px - lamp(i).x, py - lamp(i).y, pz - lamp(i).z) <= lamp(i).range;
      // The oracle on the cell's box, its reach widened by the grid's margin, give or take the
      // single precision the box is read back in.
      const inCell = (i: number, give: number) =>
        inGrid &&
        sphereTouchesBox(
          box as Box,
          [lamp(i).x, lamp(i).y, lamp(i).z],
          lamp(i).range + side * (CELL_MARGIN + give),
        );
      const all = Array.from({ length: LAMPS }, (_, i) => i);
      const at = `the cell of (${px}, ${py}, ${pz})`;
      assert.ok(inOrder, 'the cell lists its lamps in slot order');
      assert.equal(slots.at(-1), LAMPS, 'the sun, last, reaches every fragment');
      assert.ok(
        all.filter((i) => inCell(i, -1e-3)).every((i) => slots.includes(i)),
        at,
      );
      assert.ok(
        slots.slice(0, -1).every((i) => inCell(i, 1e-3)),
        at,
      );
      assert.ok(
        all.filter(reaches).every((i) => slots.includes(i)),
        'every lamp that reaches',
      );
      if (slots.length === 1) sunOnly++;
    }
  assert.ok(sunOnly > 0, 'a fragment far from every lamp evaluates the sun alone');
  renderer.dispose();
});

test('a floor under 300 lamps: a fragment walks the few lamps near it, not the 300 its draw holds', () => {
  const lights = Array.from({ length: LAMPS }, (_, i) =>
    pointLamp([i % 20, 0.5, Math.floor(i / 20)], 0.75),
  );
  const floor = triangle(10),
    placed = floor as unknown as Object3D;
  placed.scale.set(40, 1, 40);
  placed.updateMatrixWorld(true);
  const { context, renderer } = drawLights(lights, [floor]);
  let most = 0;
  for (let x = -0.5; x <= 19.5; x += 0.25)
    for (let z = -0.5; z <= 14.5; z += 0.25)
      most = Math.max(most, evaluated(context, [x, 0, z]).slots.length);
  assert.ok(most > 0 && most <= 9, `at most 9 lamps walked at a point, ${most} found`);
  renderer.dispose();
});

/** One frame of a scene draw, to a small default target. */
function drawFrame(draw: ReturnType<typeof createSceneDraw>) {
  draw.render({} as never);
  const output = { toneMapped: true, framebuffer: null, width: 8, height: 4 };
  draw.host.drawHostGeometry(createHostDrawCamera(), output);
}

test('a WebGL2 frame walks the scene 0 times for its lights, and still reads their changes', () => {
  const lit = scene(),
    context = createTestContext({ answers: { getExtension: () => ({}) } });
  lit.add(triangle(meshX(0)) as unknown as Object3D);
  const draw = createSceneDraw(context.gl, lit);
  const frame = () => drawFrame(draw);
  frame();
  const walk = Object3D.prototype.traverse;
  let visits = 0;
  Object3D.prototype.traverse = function (visitor) {
    visits++;
    return walk.call(this, visitor);
  };
  const first = lit.children.find(isLightNode)!;
  first.distance = 2.5;
  try {
    frame();
  } finally {
    Object3D.prototype.traverse = walk;
  }
  assert.equal(visits, 0, 'no scene walk for the lights during the frame');
  const records = sent(context, 'RGBA').at(-1)![8] as Float32Array;
  assert.equal(records[3], 2.5, 'the new range of the lamp is read from the kept list');
  draw.dispose();
});

test('an invisible root scene gives 0 lights to the frame and to the light upload', () => {
  const lit = scene(),
    context = createTestContext({ answers: { getExtension: () => ({}) } });
  lit.add(triangle(meshX(0)) as unknown as Object3D);
  lit.visible = false;
  assert.equal(keptClusterScene(lit).lights.length, 0, 'the kept read gives no light');
  const draw = createSceneDraw(context.gl, lit);
  const upload = WebglClusterLights.prototype.upload;
  const uploaded: number[] = [];
  WebglClusterLights.prototype.upload = function (read, ...rest) {
    uploaded.push(read.lights.length);
    return upload.call(this, read, ...rest);
  };
  try {
    drawFrame(draw);
  } finally {
    WebglClusterLights.prototype.upload = upload;
  }
  assert.deepEqual(uploaded, [0], 'the frame uploads no light of a hidden root');
  draw.dispose();
});
