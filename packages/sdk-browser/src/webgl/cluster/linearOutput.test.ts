// The linear output the effect chain asks of a WebGL2 draw (#349). Without a chain the cluster
// program and the uniforms it is given are the ones drawn before the chain existed; a draw into
// the chain goes through a variant compiled at its first frame: no curve and no sRGB transfer —
// the chain applies both after its passes —, an opaque surface's alpha is its coverage, and the
// surfaces whose material skips the curve are marked so the chain's output skips it too.
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
import { CLUSTER_FRAGMENT, CLUSTER_LINEAR_FRAGMENT, CLUSTER_VERTEX } from './shaders.ts';

function mesh(surface: GraphSurface) {
  const geometry = new GraphGeometry().setIndex(new BufferAttribute(new Uint32Array(3), 1));
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(9), 3));
  const made = new GraphMesh(geometry, surface);
  made.frustumCulled = false;
  return made;
}

/** A standard surface, a transparent one and one the curve skips, drawn once per `linear`. */
function draw(...linear: boolean[]) {
  const scene = new GraphScene();
  scene.add(mesh(new GraphSurface('standard')));
  scene.add(mesh(new GraphSurface('standard', { transparent: true, opacity: 0.5 })));
  scene.add(mesh(new GraphSurface('standard', { toneMapped: false })));
  const context = createTestContext();
  const sceneDraw = createSceneDraw(context.gl, scene);
  for (const each of linear) {
    sceneDraw.render({} as HostCamera);
    const output = { toneMapped: true, framebuffer: null, width: 8, height: 4, linear: each };
    sceneDraw.drawHostGeometry(createHostDrawCamera(), output);
  }
  const uniforms = context.calls.filter(({ name }) => name.startsWith('uniform'));
  return {
    sources: context.of('shaderSource').map(([, source]) => source),
    /** The names every uniform call set, in order. */
    names: uniforms.map(({ args }) => (args[0] as { uniform?: string } | null)?.uniform),
    /** The values one uniform was set to, in order. */
    values: (name: string) =>
      uniforms
        .filter(({ args }) => (args[0] as { uniform?: string } | null)?.uniform === name)
        .map(({ args }) => args[1]),
    of: context.of,
  };
}

test('without a chain, the program and its uniforms are the ones before the chain', () => {
  const display = draw(false, false);
  assert.deepEqual(
    display.sources,
    [CLUSTER_VERTEX, CLUSTER_FRAGMENT],
    'one program, compiled once',
  );
  assert.ok(CLUSTER_FRAGMENT.endsWith('outColor=vec4(rgb,alpha);}'));
  assert.doesNotMatch(CLUSTER_FRAGMENT, /covering|untoned/);
  assert.ok(!display.names.includes('covering'), 'no uniform the chain alone reads');
  assert.deepEqual(display.values('srgbDestination'), [1, 1]);
  assert.deepEqual(display.of('bindAttribLocation'), []);
});

test('a draw into the chain compiles its variant once, on the display program attributes', () => {
  const chained = draw(true, false, true);
  assert.deepEqual(chained.sources, [
    CLUSTER_VERTEX,
    CLUSTER_FRAGMENT,
    CLUSTER_VERTEX,
    CLUSTER_LINEAR_FRAGMENT,
  ]);
  const pinned = chained.of('bindAttribLocation').map(([, , name]) => name);
  assert.deepEqual(pinned.sort(), ['color', 'instanceMatrix', 'normal', 'position', 'uv', 'uv1']);
});

test('the variant writes linear radiance, coverage, and the surfaces the curve skips', () => {
  const linear = draw(true);
  // The two opaque surfaces draw first, on one cached value, then the transparent one.
  assert.deepEqual(linear.values('covering'), [1, 0], 'opaque surfaces cover their pixel');
  assert.deepEqual(
    [...new Set(linear.values('toneMapped'))].sort(),
    [0, 1],
    'the curve is left to the chain, and the surface that skips it says so',
  );
  assert.doesNotMatch(CLUSTER_LINEAR_FRAGMENT, /rgb=toneMap\(rgb\)|rgb=linearToSrgb\(rgb\)/);
  assert.match(CLUSTER_LINEAR_FRAGMENT, /outColor=vec4\(rgb,covering\?1\.0:alpha\);/);
  assert.match(
    CLUSTER_LINEAR_FRAGMENT,
    /untoned=vec4\(toneMapped\?0\.0:1\.0,0\.0,0\.0,outColor\.a\)/,
  );
});
