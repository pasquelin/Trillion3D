/**
 * One frame of the engine's scene draw (`sceneDraw.ts`) on the recording WebGL2 double, for the
 * tests that read what a frame binds and uploads: a textured triangle to draw, and the context
 * after one frame of a scene.
 */
import * as G from '../../host/graph/graph.fixture.ts';
import { createSceneDraw } from './sceneDraw.ts';
import { createTestContext } from '../core/testContext.fixture.ts';
import { createHostDrawCamera, type HostCamera } from '../../camera/world.ts';

/** A triangle with the position, normal and UV a lit textured surface reads. */
export function texturedTriangle() {
  const geometry = new G.Geometry().setIndex([0, 1, 2]);
  for (const name of ['position', 'normal', 'uv'])
    geometry.setAttribute(name, G.floatAttribute(new Float32Array(9), name === 'uv' ? 2 : 3));
  return geometry;
}

/** The recording context after `scene` was drawn once. The mip reducer saves the viewport and
 *  the colour mask it restores: both are answered. */
export function drawSceneOnce(scene: G.GraphScene) {
  const answer = (name: string) =>
    name === 'COLOR_WRITEMASK' ? [true, true, true, true] : new Int32Array([0, 0, 8, 4]);
  const context = createTestContext({ answers: { getParameter: answer } });
  const draw = createSceneDraw(context.gl, scene);
  draw.render({} as HostCamera);
  const output = { toneMapped: false, framebuffer: null, width: 8, height: 4 };
  draw.drawHostGeometry(createHostDrawCamera(), output);
  draw.dispose();
  return context;
}
