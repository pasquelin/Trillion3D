// The linear output the effect chain asks of a WebGL2 draw (#349): no display curve and no sRGB
// transfer — the chain applies both after its passes —, and an opaque surface's alpha is its
// coverage, 1, whatever its texture's alpha; a transparent one keeps its own, blended.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneDraw } from './sceneDraw.ts';
import { createTestContext } from '../core/testContext.fixture.ts';
import { createHostDrawCamera, type HostCamera } from '../../camera/world.ts';
import { GraphScene } from '../../host/graph/scene.ts';
import { GraphMesh } from '../../host/graph/mesh.ts';
import { GraphGeometry } from '../../host/graph/geometry.ts';
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts';
import { GraphSurface } from '../../host/graph/surface.ts';
import { CLUSTER_FRAGMENT } from './shaders.ts';

function mesh(surface: GraphSurface) {
  const geometry = new GraphGeometry().setIndex(new BufferAttribute(new Uint32Array(3), 1));
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(9), 3));
  const made = new GraphMesh(geometry, surface);
  made.frustumCulled = false;
  return made;
}

/** The values one boolean uniform was set to, in order. */
function uniform(calls: unknown[][], name: string) {
  return calls.filter(([at]) => (at as { uniform?: string })?.uniform === name).map(([, v]) => v);
}

function draw(linear: boolean) {
  const scene = new GraphScene();
  scene.add(mesh(new GraphSurface('standard')));
  scene.add(mesh(new GraphSurface('standard', { transparent: true, opacity: 0.5 })));
  const context = createTestContext();
  const sceneDraw = createSceneDraw(context.gl, scene);
  sceneDraw.render({} as HostCamera);
  const output = { toneMapped: true, framebuffer: null, width: 8, height: 4, linear };
  sceneDraw.drawHostGeometry(createHostDrawCamera(), output);
  return context.of('uniform1i');
}

test('a linear output is neither tone-mapped nor encoded; the display one is both', () => {
  const linear = draw(true),
    display = draw(false);
  assert.deepEqual(uniform(linear, 'srgbDestination'), [0]);
  assert.ok(uniform(linear, 'toneMapped').every((value) => value === 0));
  assert.deepEqual(uniform(display, 'srgbDestination'), [1]);
  assert.ok(uniform(display, 'toneMapped').includes(1));
});

test('an opaque surface covers its pixel, a transparent one blends its alpha', () => {
  assert.deepEqual(uniform(draw(true), 'covering'), [1, 0]);
  assert.match(CLUSTER_FRAGMENT, /outColor=vec4\(rgb,covering&&!srgbDestination\?1\.0:alpha\);/);
});
