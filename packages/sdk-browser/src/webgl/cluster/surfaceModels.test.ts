// #772: the WebGL2 program draws the Lambert, toon and matcap families, and the Phong and normal
// ones beside them, through the WebGPU path's one surface model (`../../scene/surfaceModel.ts`).
// The shaders cannot run under node: their functions are read out of the shipped texts and run on
// known normals, lights and views (`runShaderText`), so a shader edit is what the tests see.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { clusterMaterialReason } from './compatibility.ts';
import { surfaceOf } from '../../page/surface.ts';
import { CLUSTER_FRAGMENT } from './shaders.ts';
import { runShaderText } from '../../visibility/shader/shaderText.fixture.ts';
import { DIRECT_LIGHTING_SHADER } from '../../lighting/deferred/shaders.ts';
import { PI } from '../../lighting/shaderConstants.ts';
import { MODEL_FLAG, SURFACE_MODEL, SURFACE_MODEL_SHADE_WGSL } from '../../scene/surfaceModel.ts';
import {
  crossVector3,
  dotVector3,
  transformDirectionVector3,
} from '../../../../sdk-core/src/math/primitives/vector.ts';
import {
  createCameraFrame,
  perspectiveProjection,
  updateCameraFrame,
} from '../../../../sdk-core/src/math/primitives/camera.ts';

type Vector = number[];
type Scope = NonNullable<Parameters<typeof runShaderText>[1]>;
/** The built-ins these functions call beyond the reader's own (`runShaderText`), on its values. */
const BUILTINS = {
  dot: (a: Vector, b: Vector) => dotVector3(a, b),
  cross: (a: Vector, b: Vector) => crossVector3([0, 0, 0], a, b),
  max: Math.max,
  mix: (a: number, b: number, t: number) => a * (1 - t) + b * t,
  smoothstep: (from: number, to: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
    return t * t * (3 - 2 * t);
  },
} as unknown as Scope;

/** The function `name` a shader text declares, from its signature to its closing brace; a WGSL
 *  unsigned literal reads as its number. */
function declared(source: string, name: string) {
  const start = source.search(new RegExp(`(?:fn|vec[23]) ${name}\\(`));
  assert.ok(start >= 0, `no function ${name}`);
  let end = source.indexOf('{', start),
    depth = 0;
  do depth += { '{': 1, '}': -1 }[source[end++]] ?? 0;
  while (depth);
  return source.slice(start, end).replace(/(\d)u\b/g, '$1');
}

const position = new G.BufferAttribute(new Float32Array(9), 3),
  normal = new G.BufferAttribute(new Float32Array(9), 3);

test('lambert, toon and matcap draw on WebGL2, as Phong and normal do, each by its normal', () => {
  for (const family of ['lambert', 'toon', 'matcap', 'phong', 'normal'] as const) {
    const surface = new G.GraphSurface(family);
    assert.equal(clusterMaterialReason(surface, { position, normal }), undefined, family);
    const reason = clusterMaterialReason(surface, { position });
    assert.equal(reason, `material ${family} has no normal attribute`);
  }
  // A matcap's image is read by its normal and needs no UV; one no path can read is named.
  const matcap = new G.GraphSurface('matcap', { matcap: G.dataTexture(new Uint8Array(4)) });
  assert.equal(clusterMaterialReason(matcap, { position, normal }), undefined);
  matcap.matcap = G.dataTexture(new Uint8Array(4), 1, 1, 1022);
  assert.match(clusterMaterialReason(matcap, { position, normal })!, /texel format 1022/);
});

test('a map the model never reads is refused by name on both paths, and asks for no UV', () => {
  // By the WebGL2 gate, and by the page record the WebGPU path draws from: never dropped.
  const map = G.dataTexture(new Uint8Array(4)),
    uv = new G.BufferAttribute(new Float32Array(6), 2);
  for (const [family, name] of [
    ['toon', 'gradientMap'],
    ['matcap', 'map'],
    ['matcap', 'normalMap'],
    ['normal', 'normalMap'],
  ] as const) {
    const surface = new G.GraphSurface(family, { [name]: map }),
      named = `material ${family} declares a ${name} its surface model never reads`;
    assert.equal(clusterMaterialReason(surface, { position, normal }), named);
    assert.throws(() => surfaceOf(surface), { message: named });
  }
  const lit = new G.GraphSurface('lambert', { normalMap: map });
  assert.equal(clusterMaterialReason(lit, { position, normal, uv }), undefined);
  // An occlusion map asks for a UV only where its model reads it: never on a matcap or a normal view.
  for (const [family, reason] of [
    ['matcap', undefined],
    ['normal', undefined],
    ['lambert', 'textured material has no UV attribute'],
    ['basic', 'textured material has no UV attribute'],
  ] as const) {
    const surface = new G.GraphSurface(family, { aoMap: map });
    assert.equal(clusterMaterialReason(surface, { position, normal }), reason, family);
  }
});

test('a diffuse and a toon surface take a lamp by the WebGPU formula on WebGL2', () => {
  // Each program's `modelLight`, under the value its `surfaceModel` holds for the model.
  const light = (source: string, model: number) =>
    runShaderText<number>(declared(source, 'modelLight'), { ...BUILTINS, surfaceModel: model });
  const [grey, ao] = [0.6, 0.9],
    lobe = (grey * ao * 2.5) / Math.PI;
  for (const [L, cosine, band] of [
    [[0, 0.6, 0.8], 0.8, 1],
    [[0.8, 0, 0.6], 0.6, 1],
    [[0, 0.8, -0.6], 0, 0.7],
  ] as [number[], number, number][]) {
    const args = [grey, 0, [0, 0, 1], L, 2.5, ao];
    const diffuse = light(CLUSTER_FRAGMENT, SURFACE_MODEL.diffuse)(...args);
    assert.equal(diffuse, light(DIRECT_LIGHTING_SHADER, MODEL_FLAG.diffuse)(...args));
    assert.ok(Math.abs(diffuse - lobe * cosine) < 1e-12, `the lobe at ${cosine}`);
    const toon = light(CLUSTER_FRAGMENT, SURFACE_MODEL.toon)(...args);
    assert.equal(toon, light(DIRECT_LIGHTING_SHADER, MODEL_FLAG.toon)(...args));
    assert.ok(Math.abs(toon - lobe * band) < 1e-12, `the band ${band}`);
  }
  // Both the lamp loop and the rectangle send those two models there, and no specular after; a
  // WebGL2 lamp's colour already carries its energy (`lights.ts`), a WebGPU one passes it apart.
  const lamp = CLUSTER_FRAGMENT.indexOf(
    'direct+=modelLight(base,metal,N,L,1.0,ao)*color;continue;',
  );
  assert.ok(lamp > 0 && lamp < CLUSTER_FRAGMENT.indexOf('specular+=E*specularLobe'));
  for (const [line, wgsl] of [
    ['return modelLight(base,metal,N,N,E,ao)', 'return modelLight(rgb,metal,N,N,E,ao)'],
    [
      'colorIntensity.w*PI*polygonFormFactor(a,b,c,d,F.xyz).w*window',
      `light.colorIntensity.w*${PI}*polygonFormFactor(r.a,r.b,r.c,r.d,incident.xyz).w*r.window`,
    ],
  ])
    assert.ok(CLUSTER_FRAGMENT.includes(line) && DIRECT_LIGHTING_SHADER.includes(wgsl), line);
});

test('a matcap reads its image where the WebGPU resolve does, and a normal view shows it', () => {
  // A camera turned 35° about y and tilted 20° down, off the origin.
  const [a, b] = [(35 * Math.PI) / 180, (-20 * Math.PI) / 180];
  const [ca, sa, cb, sb] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)];
  const world = Float64Array.from(
    [
      [ca, 0, -sa, 0],
      [sa * sb, cb, ca * sb, 0],
      [sa * cb, -sb, ca * cb, 0],
      [1, 2, 3, 1],
    ].flat(),
  );
  const projection = perspectiveProjection(new Float64Array(16), 50, 1.5, 0.1, 1);
  const { view, viewProjection } = updateCameraFrame(createCameraFrame(), projection, world);
  const viewProj = [0, 4, 8, 12].map((at) => [...viewProjection.subarray(at, at + 4)]);
  const viewNormal = runShaderText(
    declared(SURFACE_MODEL_SHADE_WGSL, 'viewNormal').replaceAll('uni.viewProj', 'viewProj'),
    { ...BUILTINS, viewProj },
  );
  const gpu = runShaderText(declared(SURFACE_MODEL_SHADE_WGSL, 'matcapUv'), { viewNormal });
  const gl = runShaderText(declared(CLUSTER_FRAGMENT, 'matcapUv'));
  for (const N of [
    [0, 0, 1],
    [0.48, 0.6, 0.64],
    [-0.8, 0, 0.6],
  ]) {
    // The WebGL2 program's normal is in view space already: the view's turn of N.
    const inView = transformDirectionVector3([0, 0, 0], view, N[0], N[1], N[2]);
    const [here, there] = [gl(inView), gpu(N)];
    assert.ok(Math.abs(here[0] - there[0]) + Math.abs(here[1] - there[1]) < 1e-12, `${N}`);
  }
  // The base map is read there, at its full detail, only for a matcap.
  assert.ok(
    CLUSTER_FRAGMENT.includes(
      `if(surfaceModel==${SURFACE_MODEL.matcap})base*=textureLod(baseMap,mapUv(baseUv,matcapUv(normalize(viewNormal))),0.0);`,
    ),
  );
  assert.ok(CLUSTER_FRAGMENT.includes(`if(surfaceModel==${SURFACE_MODEL.normal})rgb=N*0.5+0.5;`));
});
