// #772: the WebGL2 program draws the Lambert, toon and matcap families — and the Phong and normal
// ones beside them — through the WebGPU path's one surface model (`../../scene/surfaceModel.ts`).
// The shaders cannot run under node: their functions are read out of the shipped texts and
// evaluated here on known normals, lights and views, so a shader edit is what the tests see.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { clusterMaterialReason } from './compatibility.ts';
import { CLUSTER_FRAGMENT } from './shaders.ts';
import { DIRECT_LIGHTING_SHADER } from '../../lighting/deferred/shaders.ts';
import { PI } from '../../lighting/shaderConstants.ts';
import { MODEL_FLAG, SURFACE_MODEL, SURFACE_MODEL_SHADE_WGSL } from '../../scene/surfaceModel.ts';
import {
  createCameraFrame,
  perspectiveProjection,
  updateCameraFrame,
} from '../../../../sdk-core/src/math/primitives/camera.ts';

type Vector = { x: number; y: number; z: number };
const vector = (x: number, y: number, z = 0): Vector => ({ x, y, z });
const dot = (a: Vector, b: Vector) => a.x * b.x + a.y * b.y + a.z * b.z;
/** What the two languages' built-ins do on the scalars and vectors these functions read. */
const BUILTINS = {
  vec2: vector,
  vec2f: vector,
  vec3f: vector,
  dot,
  cross: (a: Vector, b: Vector) =>
    vector(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x),
  normalize: (a: Vector) => {
    const length = Math.sqrt(dot(a, a));
    return vector(a.x / length, a.y / length, a.z / length);
  },
  max: Math.max,
  mix: (a: number, b: number, t: number) => a * (1 - t) + b * t,
  smoothstep: (from: number, to: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
    return t * t * (3 - 2 * t);
  },
};

/** The function `name` of a shader text as JavaScript, over `globals` and the built-ins: its
 *  typed declarations read as constants, unsigned literals without their suffix. */
function shaderFunction(source: string, name: string, globals: Record<string, unknown> = {}) {
  const head = source.match(new RegExp(`\\b${name}\\(([^)]*)\\)[^{;]*\\{`));
  assert.ok(head, `no function ${name}`);
  const start = head.index! + head[0].length;
  let end = start;
  for (let depth = 1; depth; end++) depth += { '{': 1, '}': -1 }[source[end]] ?? 0;
  const body = source
    .slice(start, end - 1)
    .replace(/(\d)u\b/g, '$1')
    .replace(/\b(?:vec2|vec3|float|let)\s+(\w+)=/g, 'const $1=');
  const parameters = head[1].split(',').map((one) => one.split(':')[0].trim().split(' ').pop()!);
  const scope = { ...BUILTINS, ...globals };
  const run = new Function(...Object.keys(scope), ...parameters, body);
  return (...values: unknown[]) => run(...Object.values(scope), ...values);
}

test('lambert, toon and matcap draw on WebGL2, as Phong and normal do, and each needs its normal', () => {
  const position = new G.BufferAttribute(new Float32Array(9), 3);
  const normal = new G.BufferAttribute(new Float32Array(9), 3);
  for (const family of ['lambert', 'toon', 'matcap', 'phong', 'normal'] as const) {
    const surface = new G.GraphSurface(family);
    assert.equal(clusterMaterialReason(surface, { position, normal }), undefined, family);
    assert.equal(
      clusterMaterialReason(surface, { position }),
      `material ${family} has no normal attribute`,
    );
  }
  // A matcap's image is read by its normal and needs no UV; one no path can read is named.
  const matcap = new G.GraphSurface('matcap', { matcap: G.dataTexture(new Uint8Array(4)) });
  assert.equal(clusterMaterialReason(matcap, { position, normal }), undefined);
  matcap.matcap = G.dataTexture(new Uint8Array(4), 1, 1, 1022);
  assert.match(clusterMaterialReason(matcap, { position, normal })!, /texel format 1022/);
});

test('a diffuse and a toon surface take a lamp by the WebGPU formula on WebGL2', () => {
  const gl = (model: number) =>
    shaderFunction(CLUSTER_FRAGMENT, 'modelLight', { surfaceModel: model });
  const gpu = (flag: number) =>
    shaderFunction(DIRECT_LIGHTING_SHADER, 'modelLight', { surfaceModel: flag });
  const N = vector(0, 0, 1),
    grey = 0.6,
    ao = 0.9;
  for (const [L, cosine, band] of [
    [vector(0, 0.6, 0.8), 0.8, 1],
    [vector(0.8, 0, 0.6), 0.6, 1],
    [vector(0, 0.8, -0.6), 0, 0.7],
  ] as const) {
    const lobe = (grey * ao * 2.5) / Math.PI;
    const diffuse = gl(SURFACE_MODEL.diffuse)(grey, 0, N, L, 2.5, ao);
    assert.equal(diffuse, gpu(MODEL_FLAG.diffuse)(grey, 0, N, L, 2.5, ao));
    assert.ok(Math.abs(diffuse - lobe * cosine) < 1e-12, `the cosine lobe at ${cosine}`);
    const toon = gl(SURFACE_MODEL.toon)(grey, 0, N, L, 2.5, ao);
    assert.equal(toon, gpu(MODEL_FLAG.toon)(grey, 0, N, L, 2.5, ao));
    assert.ok(Math.abs(toon - lobe * band) < 1e-12, `the band ${band}`);
  }
  // Both the lamp loop and the rectangle send those two models there, and no specular after; a
  // WebGL2 lamp's colour already carries its energy (`lights.ts`), a WebGPU one passes it apart.
  const lamp = `if(surfaceModel==${SURFACE_MODEL.diffuse}||surfaceModel==${SURFACE_MODEL.toon}){direct+=modelLight(base,metal,N,L,1.0,ao)*color;continue;}`;
  assert.ok(CLUSTER_FRAGMENT.indexOf(lamp) > 0);
  assert.ok(CLUSTER_FRAGMENT.indexOf(lamp) < CLUSTER_FRAGMENT.indexOf('specular+=E*specularLobe'));
  for (const [line, wgsl] of [
    [
      `if(surfaceModel==${SURFACE_MODEL.diffuse})return modelLight(base,metal,N,N,E,ao)`,
      `if(surfaceModel==${MODEL_FLAG.diffuse}u){return modelLight(rgb,metal,N,N,E,ao)`,
    ],
    [
      'modelLight(base,metal,N,F.xyz,colorIntensity.w*PI*polygonFormFactor(a,b,c,d,F.xyz).w*window,ao)',
      `facing=light.colorIntensity.w*${PI}*polygonFormFactor(r.a,r.b,r.c,r.d,incident.xyz).w*r.window;`,
    ],
  ])
    assert.ok(CLUSTER_FRAGMENT.includes(line) && DIRECT_LIGHTING_SHADER.includes(wgsl), line);
});

test('a matcap reads its image where the WebGPU resolve does, and a normal view shows it', () => {
  // A camera turned 35° about y and tilted 20° down, off the origin.
  const [a, b] = [(35 * Math.PI) / 180, (-20 * Math.PI) / 180];
  const [ca, sa, cb, sb] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)];
  const world = Float64Array.of(
    ca,
    0,
    -sa,
    0,
    sa * sb,
    cb,
    ca * sb,
    0,
    sa * cb,
    -sb,
    ca * cb,
    0,
    1,
    2,
    3,
    1,
  );
  const projection = perspectiveProjection(new Float64Array(16), 50, 1.5, 0.1, 1);
  const { view, viewProjection: m } = updateCameraFrame(createCameraFrame(), projection, world);
  const columns = [0, 4, 8, 12].map((at) => ({ x: m[at], y: m[at + 1], z: m[at + 2] }));
  const viewNormal = shaderFunction(SURFACE_MODEL_SHADE_WGSL, 'viewNormal', {
    uni: { viewProj: columns },
  });
  const gpu = shaderFunction(SURFACE_MODEL_SHADE_WGSL, 'matcapUv', { viewNormal });
  const gl = shaderFunction(CLUSTER_FRAGMENT, 'matcapUv');
  for (const N of [vector(0, 0, 1), vector(0.48, 0.6, 0.64), vector(-0.8, 0, 0.6)]) {
    // The WebGL2 program's normal is in view space already: the view's rotation of N.
    const inView = vector(
      view[0] * N.x + view[4] * N.y + view[8] * N.z,
      view[1] * N.x + view[5] * N.y + view[9] * N.z,
      view[2] * N.x + view[6] * N.y + view[10] * N.z,
    );
    const [here, there] = [gl(inView) as Vector, gpu(N) as Vector];
    assert.ok(Math.abs(here.x - there.x) + Math.abs(here.y - there.y) < 1e-12, `${N.x},${N.y}`);
  }
  // The base map is read there, at its full detail, only for a matcap.
  assert.ok(
    CLUSTER_FRAGMENT.includes(
      `bool matcap=surfaceModel==${SURFACE_MODEL.matcap};\nif((mapMask&1)!=0){vec2 st=mapUv(baseUv,matcap?matcapUv(normalize(viewNormal)):sourceUv(mapChannels.x));base*=matcap?textureLod(baseMap,st,0.0):texture(baseMap,st);}`,
    ),
  );
  assert.ok(CLUSTER_FRAGMENT.includes(`if(surfaceModel==${SURFACE_MODEL.normal})rgb=N*0.5+0.5;`));
});
