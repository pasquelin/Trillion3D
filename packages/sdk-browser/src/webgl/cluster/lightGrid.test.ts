import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext } from '../core/testContext.fixture.ts';
import { WebglClusterRenderer } from './renderer.ts';
import { readDegraded } from './validation.ts';
import { createHostDrawCamera } from '../../camera/world.ts';
import * as G from '../../host/graph/graph.fixture.ts';
import type { Light } from '../../../../sdk-core/src/world/light/light.ts';
import { lastUniform, sent, triangle, viewFrom } from './lightGrid.fixture.ts';

// #835: the WebGL2 light grid is listed again only when a lamp's reach changes, and no draw of a
// frame — its reflection capture's included — does any light work of its own.

/** 40 lamps in a row, a mirror between two triangles, drawn by one renderer. */
function mirrorFrame() {
  const context = createTestContext({ answers: { getExtension: () => ({}) } }),
    renderer = new WebglClusterRenderer(
      context.gl,
      readDegraded(() => {}),
    );
  const lights = Array.from({ length: 40 }, (_, i) => {
    const lamp = new G.Light('point', { position: [i * 0.5 - 10, 1, 0], distance: 2 });
    lamp.updateMatrixWorld(true);
    return lamp as unknown as Light;
  });
  const meshes = [triangle(0, 0), triangle(-6), triangle(6)];
  const camera = createHostDrawCamera();
  const frame = (x: number) => {
    camera.view.set(viewFrom(x));
    renderer.draw([], { lights }, camera, true, true, meshes);
  };
  return { context, renderer, lights, frame };
}

test('a frame that moves only the camera lists no lamp and sends no list row', () => {
  const { context, renderer, lights, frame } = mirrorFrame();
  // The grid is sent each time it is listed, and only then.
  frame(0);
  assert.equal(sent(context, 'RED_INTEGER').length, 1, 'the first frame lists and sends the grid');
  const toGrid = () =>
    (lastUniform(context, 'uniformMatrix4fv', 'viewToGrid') as [boolean, Float32Array])[1];
  const [scale, offset] = [toGrid()[0], toGrid()[12]];
  const before = context.of('texSubImage2D').length;
  frame(3);
  assert.deepEqual(sent(context, 'RED_INTEGER', before), [], 'a moved camera sends no list row');
  assert.equal(sent(context, 'RGBA', before).length, 1, 'the view-space records are sent');
  const shift = toGrid()[12] - offset;
  assert.ok(Math.abs(shift - 3 * scale) < 1e-4, 'the grid follows the view by its matrix alone');

  lights[0].distance = 3;
  const moved = context.of('texSubImage2D').length;
  frame(3);
  assert.equal(sent(context, 'RED_INTEGER', moved).length, 1, 'a new range lists it again');
  renderer.dispose();
});

test('a reflection capture and the frame after it do no per-draw light work', () => {
  const { context, renderer, frame } = mirrorFrame();
  frame(0);
  assert.equal(renderer.backdropPasses, 1, 'the mirror captures the scene');
  assert.equal(context.of('drawElements').length, 6, 'three draws in the capture, three after');
  const lightUniforms = context
    .of('uniform2i')
    .concat(context.of('uniform3i'), context.of('uniformMatrix4fv'))
    .filter((args) => {
      const name = (args[0] as { uniform: string } | null)?.uniform;
      return name === 'lightSpan' || name === 'lightGrid' || name === 'gridCells';
    });
  assert.equal(lightUniforms.length, 2, 'one grid for the frame: no light uniform per draw');
  assert.equal(sent(context, 'RED_INTEGER').length, 1, 'the lists sent once, before any draw');
  renderer.dispose();
});
