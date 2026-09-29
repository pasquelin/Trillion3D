import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext } from '../core/testContext.fixture.ts';
import { WebglClusterRenderer } from './renderer.ts';
import { readDegraded } from './validation.ts';
import { LIGHT_ROW_TEXELS } from './lightTexture.ts';
import { WebglClusterLightLists } from './lightLists.ts';
import { createHostDrawCamera } from '../../camera/world.ts';
import * as G from '../../host/graph/graph.fixture.ts';
import type { WholeMesh } from '../../cluster/batchMesh.ts';

// #835: the light textures send only the rows they do not hold yet. A frame that writes what the
// last one did — its reflection capture included — sends none; a draw listed late sends its rows.

/** A unit triangle at `x`, its surface a mirror when `roughness` is 0. */
function triangle(x: number, roughness = 1) {
  const geometry = new G.Geometry().setIndex(new G.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  const at = new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0]);
  geometry.setAttribute('position', new G.BufferAttribute(at, 3));
  geometry.setAttribute('normal', new G.BufferAttribute(new Float32Array(9), 3));
  const surface = new G.GraphSurface('standard', { roughness, metalness: 1 });
  const made = new G.Mesh(geometry, surface);
  made.position.set(x, 0, 0);
  made.updateMatrixWorld(true);
  return made as unknown as WholeMesh;
}

/** The light texture rows sent since `from`: each call's first row and row count. */
const sentRows = (context: ReturnType<typeof createTestContext>, from = 0) =>
  context
    .of('texSubImage2D')
    .slice(from)
    .filter((args) => args[4] === LIGHT_ROW_TEXELS)
    .map((args) => [args[3], args[5]]);

test('a repeated WebGL2 frame with a reflection capture sends no light texture row', () => {
  const context = createTestContext({ answers: { getExtension: () => ({}) } }),
    renderer = new WebglClusterRenderer(
      context.gl,
      readDegraded(() => {}),
    );
  const lights = Array.from({ length: 40 }, (_, i) => {
    const lamp = new G.Light('point', { position: [i * 0.5 - 10, 1, 0], distance: 2 });
    lamp.updateMatrixWorld(true);
    return lamp;
  });
  const meshes = [triangle(0, 0), triangle(-6), triangle(6)];
  const frame = () => renderer.draw([], { lights }, createHostDrawCamera(), true, true, meshes);
  frame();
  assert.equal(renderer.backdropPasses, 1, 'the mirror captures the scene');
  assert.deepEqual(
    sentRows(context),
    [
      [0, 1],
      [0, 1],
    ],
    'the first frame sends records and lists',
  );
  const before = context.of('texSubImage2D').length;
  frame();
  assert.equal(renderer.backdropPasses, 1);
  assert.deepEqual(sentRows(context, before), [], 'the capture and the frame send no light row');
  const spans = context.of('uniform2i').filter((args) => {
    return (args[0] as { uniform: string }).uniform === 'lightSpan';
  });
  assert.equal(spans.length, 2 * 6, 'each draw, in the capture and after it, reads its list');

  lights[0].distance = 3;
  const moved = context.of('texSubImage2D').length;
  frame();
  assert.deepEqual(sentRows(context, moved), [[0, 1]], 'a new range sends the one row it is in');
  renderer.dispose();
});

test('a draw the frame did not list sends its own rows, never the lists before it', () => {
  const context = createTestContext(),
    lists = new WebglClusterLightLists(context.gl);
  // Lamps of no range reach every draw: two draws fill the first row and part of the second.
  const lamps = 600;
  lists.reserve(lamps);
  lists.build(lamps, [[triangle(0), triangle(2)]]);
  const before = context.of('texSubImage2D').length;
  lists.use(triangle(4), null);
  assert.deepEqual(sentRows(context, before), [[1, 1]], 'the second row alone: the late list');
  const [, start, count] = context.of('uniform2i').at(-1)!;
  assert.deepEqual([start, count], [2 * lamps, lamps]);
  lists.dispose();
});
