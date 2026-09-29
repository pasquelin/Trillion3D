// The linear output the effect chain asks of a WebGL2 draw (#349). Without a chain the cluster
// program is the one drawn before the chain existed, an opaque surface's alpha 1 (#840); a draw into
// the chain goes through a variant compiled at its first frame: no curve and no sRGB transfer —
// the chain applies both after its passes —, an opaque surface's alpha is its coverage, and the
// surfaces whose material skips the curve are marked so the chain's output skips it too.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { createSceneDraw } from './sceneDraw.ts';
import { createTestContext } from '../core/testContext.fixture.ts';
import { createHostDrawCamera, type HostCamera } from '../../camera/world.ts';
import { Scene } from '../../world/core/scene.ts';
import { GraphSurface } from '../../host/graph/surface.ts';
import { CLUSTER_FRAGMENT, CLUSTER_LINEAR_FRAGMENT, CLUSTER_VERTEX } from './shaders.ts';

/** Diffuse surfaces isolate output composition from the separately tested reflection capture. */
function draw(...linear: boolean[]) {
  const scene = new Scene();
  scene.add(G.triangleMesh(new GraphSurface('lambert')));
  scene.add(G.triangleMesh(new GraphSurface('lambert', { transparent: true, opacity: 0.5 })));
  scene.add(G.triangleMesh(new GraphSurface('lambert', { toneMapped: false })));
  const context = createTestContext();
  const sceneDraw = createSceneDraw(context.gl, scene);
  for (const each of linear) {
    sceneDraw.render({} as HostCamera);
    const output = { toneMapped: true, framebuffer: null, width: 8, height: 4, linear: each };
    sceneDraw.host.drawHostGeometry(createHostDrawCamera(), output);
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

test('without a chain, one program draws, an opaque surface at alpha 1', () => {
  const display = draw(false, false);
  assert.deepEqual(
    display.sources,
    [CLUSTER_VERTEX, CLUSTER_FRAGMENT],
    'one program, compiled once',
  );
  assert.ok(CLUSTER_FRAGMENT.endsWith('outColor=vec4(rgb,covering?1.0:alpha);}'));
  assert.doesNotMatch(CLUSTER_FRAGMENT, /untoned/);
  assert.deepEqual(display.values('covering'), [1, 0, 1, 0], 'opaque surfaces write alpha 1');
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
  assert.deepEqual(pinned.sort(), [
    'color',
    'instanceMatrix',
    'normal',
    'position',
    'skinIndex',
    'skinWeight',
    'uv',
    'uv1',
  ]);
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
