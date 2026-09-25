// The WebGL2 cluster binder's map uniforms, without a GL context: its four collaborators are
// injected, so what it sends them is readable directly. What is proved here is the UV transform it
// uploads — the engine record's own nine elements, under the unit's uniform name, for a bound map
// and for that map alone — since the binder no longer recomposes a host matrix per bind.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { bindClusterMaterial } from './materialBinding.ts';
import { importHostTexture } from '../../host/textureImport.ts';
import { pageDiagnostics } from '../../host/pageDiagnostics.ts';
import { CLUSTER_FRAGMENT } from './shaders.ts';
import {
  HOST_BLENDING_ADDITIVE,
  HOST_BLENDING_MULTIPLY,
  HOST_BLENDING_NONE,
  HOST_BLENDING_NORMAL,
  HOST_BLENDING_SUBTRACTIVE,
} from '../../host/surfaceConstants.ts';

type Binding = Parameters<typeof bindClusterMaterial>[0];

/** Records every matrix the binder uploads; the other three collaborators only have to answer. */
function recorder() {
  const uploaded: { name: string; value: ArrayLike<number> }[] = [];
  const nothing = () => {};
  const binding = {
    uniforms: {
      f1: nothing,
      f2: nothing,
      f3: nothing,
      f4: nothing,
      i1: nothing,
      i2: nothing,
      i4: nothing,
    },
    matrices: {
      set: (name: string, value: ArrayLike<number>) => void uploaded.push({ name, value }),
    },
    textures: { bind: nothing },
    state: { apply: nothing },
  } as unknown as Binding;
  return { binding, uploaded };
}

const texture = () => {
  const map = G.dataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1, G.HOST_FORMAT_RGBA);
  map.needsUpdate = true;
  return map;
};

test('A bound map uploads the imported record transform, under its own uniform', () => {
  const map = texture();
  const material = G.standardSurface({ map });
  const { binding, uploaded } = recorder();
  bindClusterMaterial(binding, material, true);
  assert.equal(uploaded.length, 1, 'the five maps the material does not declare upload nothing');
  assert.equal(uploaded[0].name, 'baseUv');
  assert.equal(uploaded[0].value, importHostTexture(map).transform, 'the record own elements');
  assert.deepEqual(Array.from(uploaded[0].value), [...map.matrix.elements]);
});

test('A host recomposition of the UV transform reaches the next bind', () => {
  const map = texture();
  const material = G.standardSurface({ normalMap: map });
  map.offset.set(0.25, 0.5);
  map.updateMatrix();
  const { binding, uploaded } = recorder();
  bindClusterMaterial(binding, material, true);
  assert.equal(uploaded[0].name, 'normalUv');
  assert.deepEqual(Array.from(uploaded[0].value), [...map.matrix.elements]);
  assert.equal(uploaded[0].value[6], 0.25, 'the offset the host composed is what the shader reads');
});

/** The value `bindClusterMaterial` gives the flag `name` for `material`; `linear` binds the
 *  effect chain's program. */
const flagOf = (material: G.GraphSurface, name: string, linear = false) => {
  const flags = new Map<string, number>();
  const { binding } = recorder();
  binding.linear = linear;
  (binding.uniforms as unknown as Record<string, unknown>).i1 = (
    _: number,
    flag: string,
    value: number,
  ) => void flags.set(flag, value);
  bindClusterMaterial(binding, material, true);
  return flags.get(name);
};

test('A Depth material, and it alone, shows the frame depth ramp', () => {
  assert.equal(flagOf(new G.GraphSurface('depth'), 'depthShaded'), 1);
  assert.equal(flagOf(G.standardSurface(), 'depthShaded'), 0);
  assert.equal(flagOf(G.basicSurface(), 'depthShaded'), 0);
});

test("A diagnostic view's surfaces, and they alone, stay out of the fog", () => {
  // The two surfaces a diagnostic view paints on the WebGL2 path: they show a number.
  const triangles = pageDiagnostics.triangleMaterial(0) as unknown as G.GraphSurface;
  const cluster = pageDiagnostics.clusterMaterial('7', 0) as unknown as G.GraphSurface;
  assert.equal(flagOf(triangles, 'fogFree'), 1);
  assert.equal(flagOf(cluster, 'fogFree'), 1);
  // An unlit material a scene declares is seen through the fog, as a lit one is.
  assert.equal(flagOf(G.basicSurface(), 'fogFree'), 0);
  assert.equal(flagOf(G.standardSurface(), 'fogFree'), 0);
});

test('A normal or depth material, and they alone, are never tone mapped (#365)', () => {
  // The fragment's display curve hangs on this one uniform: what the binder sends is the rule.
  assert.equal(CLUSTER_FRAGMENT.split('rgb=toneMap(rgb)').length, 2);
  assert.match(CLUSTER_FRAGMENT, /if\(toneMapped\)rgb=toneMap\(rgb\);/);
  for (const family of ['normal', 'depth'] as const)
    assert.equal(flagOf(new G.GraphSurface(family), 'toneMapped'), 0, family);
  for (const family of ['lambert', 'phong', 'toon', 'matcap', 'basic'] as const)
    assert.equal(flagOf(new G.GraphSurface(family), 'toneMapped'), 1, family);
  assert.equal(flagOf(G.standardSurface(), 'toneMapped'), 1, 'standard');
});

test('Into the effect chain, a surface covers its pixel as the display path shows it (#349)', () => {
  const transparent = (blending: number) =>
    Object.assign(G.standardSurface({ opacity: 0.5 }), { transparent: true, blending });
  assert.equal(flagOf(G.standardSurface(), 'covering', true), 1, 'opaque');
  // A none-blended surface replaces what is behind it: the display path shows it whole.
  assert.equal(flagOf(transparent(HOST_BLENDING_NONE), 'covering', true), 1, 'none');
  assert.equal(flagOf(transparent(HOST_BLENDING_NORMAL), 'covering', true), 0, 'normal');
  assert.equal(flagOf(transparent(HOST_BLENDING_ADDITIVE), 'covering', true), 0, 'additive');
  // Multiply and subtractive filter the background the linear target does not hold: refused.
  for (const [blending, mode] of [
    [HOST_BLENDING_MULTIPLY, 'multiply'],
    [HOST_BLENDING_SUBTRACTIVE, 'subtractive'],
  ] as const) {
    assert.throws(
      () => flagOf(transparent(blending), 'covering', true),
      new Error(`the WebGL2 effect chain cannot draw ${mode} blending`),
    );
    assert.equal(flagOf(transparent(blending), 'covering'), undefined, 'drawn without a chain');
  }
  // A mode no path draws is refused here as by the display path, never drawn uncovered.
  assert.throws(() => flagOf(transparent(99), 'covering', true), /a surface declares a blending/);
});
