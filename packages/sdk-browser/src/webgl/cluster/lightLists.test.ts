import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext } from '../core/testContext.fixture.ts';
import { WebglClusterRenderer } from './renderer.ts';
import { readDegraded } from './validation.ts';
import { LIGHT_ROW_TEXELS } from './lightTexture.ts';
import { createHostDrawCamera } from '../../camera/world.ts';
import * as G from '../../host/graph/graph.fixture.ts';
import { Scene } from '../../world/core/scene.ts';
import type { WholeMesh } from '../../cluster/batchMesh.ts';
import { isLightNode } from '../../host/graph/kinds.ts';
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { createSceneDraw } from './sceneDraw.ts';
import {
  sphereTouchesBox,
  type Box,
} from '../../../../../bench/oracles/browser/gpuLightTileColumnOracle.ts';

// #835: WebGL2 draws every lamp of a scene, from a light texture grown with the count, and each
// draw evaluates only the lamps whose range reaches it — the lists the CPU oracle of the tiles'
// light test (`sphereTouchesBox`) keeps for the draw's world box.

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

function mesh(x: number) {
  const geometry = new G.Geometry().setIndex(new G.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  geometry.setAttribute(
    'position',
    new G.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0]), 3),
  );
  geometry.setAttribute('normal', new G.BufferAttribute(new Float32Array(9), 3));
  const made = new G.Mesh(geometry, new G.GraphSurface('standard'));
  made.position.set(x, 0, 0);
  made.updateMatrixWorld(true);
  return made as unknown as WholeMesh;
}

test('300 lamps draw on WebGL2, each draw lists the lamps the oracle says reach it', () => {
  const context = createTestContext({ answers: { getExtension: () => ({}) } }),
    renderer = new WebglClusterRenderer(
      context.gl,
      readDegraded(() => {}),
    );
  const meshes = Array.from({ length: 12 }, (_, m) => mesh(meshX(m)));
  const lights = scene().children.filter(isLightNode);
  renderer.draw([], { lights }, createHostDrawCamera(), true, true, meshes);
  assert.equal(context.of('drawElements').length, meshes.length, 'every mesh drawn, none refused');

  const sent = (format: string) =>
    context
      .of('texSubImage2D')
      .filter((args) => args[4] === LIGHT_ROW_TEXELS && args[6] === format)
      .at(-1)!;
  const records = sent('RGBA')[8] as Float32Array;
  for (let i = 0; i < LAMPS; i++)
    assert.equal(records[i * 16 + 3], Math.fround(lamp(i).range), `lamp ${i} has its slot`);
  assert.equal(records[LAMPS * 16 + 7], 0, 'the sun takes the slot after the lamps');

  const entries = sent('RED_INTEGER')[8] as Int32Array;
  const spans = context
    .of('uniform2i')
    .filter((args) => (args[0] as { uniform: string }).uniform === 'lightSpan');
  assert.equal(spans.length, meshes.length);
  let sunOnly = 0;
  spans.forEach(([, start, count], m) => {
    const x = meshX(m);
    const box: Box = { lo: [x - 0.5, 0, 0], hi: [x + 0.5, 1, 0] };
    const expected = Array.from({ length: LAMPS }, (_, i) => i).filter((i) => {
      const { x: lx, y, z, range } = lamp(i);
      return sphereTouchesBox(box, [lx, y, z], range);
    });
    expected.push(LAMPS);
    const listed = [...entries.subarray(start as number, (start as number) + (count as number))];
    assert.deepEqual(listed, expected, `mesh ${m}'s list`);
    if (expected.length === 1) sunOnly++;
  });
  assert.ok(sunOnly > 0, 'a mesh far from every lamp evaluates the sun alone');
  renderer.dispose();
});

test('a WebGL2 frame walks the scene 0 times for its lights, and still reads their changes', () => {
  const lit = scene(),
    context = createTestContext({ answers: { getExtension: () => ({}) } });
  lit.add(mesh(meshX(0)) as unknown as Object3D);
  const draw = createSceneDraw(context.gl, lit);
  const frame = () => {
    draw.render({} as never);
    draw.host.drawHostGeometry(createHostDrawCamera(), {
      toneMapped: true,
      framebuffer: null,
      width: 8,
      height: 4,
    });
  };
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
  const records = context
    .of('texSubImage2D')
    .filter((args) => args[4] === LIGHT_ROW_TEXELS && args[6] === 'RGBA')
    .at(-1)![8] as Float32Array;
  assert.equal(records[3], 2.5, 'the new range of the lamp is read from the kept list');
  draw.dispose();
});
