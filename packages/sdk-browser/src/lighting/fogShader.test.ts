// The fog law (#345): a CPU oracle — the linear ramp, and the transmittance of a medium whose
// density falls off with height, integrated numerically along the view ray — against the two
// shipped shader texts, read out of `FOG_WGSL` and `FOG_GLSL` and evaluated here, so a shader
// edit is what the test sees. With no fog the shaders hand the lit colour back untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FOG_GLSL, FOG_WGSL } from './fogShader.ts';
import {
  packEnvironment,
  SCENE_ENVIRONMENT_FLOATS,
} from '../../../sdk-core/src/scene/core/environment.ts';
import { packFog, type SceneFog } from '../../../sdk-core/src/scene/core/fog.ts';
import { WebglClusterFog } from '../webgl/cluster/fog.ts';

type V3 = [number, number, number];
const length = (v: V3) => Math.hypot(v[0], v[1], v[2]);

/** The oracle: the fog law at `P` seen from `eye`, the optical depth summed over 20 000 steps. */
function oracle(fog: SceneFog, eye: V3, P: V3) {
  const d = length(sub(P, eye));
  if ('near' in fog) return Math.min(1, Math.max(0, (fog.far - d) / (fog.far - fog.near)));
  const { density, heightFalloff = 0, baseHeight = 0 } = fog;
  let tau = 0;
  for (let i = 0, n = 20000; i < n; i++) {
    const y = eye[1] + ((i + 0.5) / n) * (P[1] - eye[1]);
    tau += density * Math.exp(-heightFalloff * (y - baseHeight)) * (d / n);
  }
  return Math.exp(-tau);
}

/** A vector as both languages read it: components by name and by swizzle. */
const vec = (v: ArrayLike<number>) => {
  const [x, y, z, w] = Array.from(v);
  return Object.assign([x, y, z] as V3, { x, y, z, w, rgb: [x, y, z] as V3 });
};
const sub = (a: V3, b: V3) => vec([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
const BUILTINS = {
  clamp: (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x)),
  select: (no: unknown, yes: unknown, when: boolean) => (when ? yes : no),
  mix: (a: V3, b: V3, t: number) => a.map((value, i) => value + (b[i] - value) * t),
  length,
  sub,
  ...{ exp: Math.exp, abs: Math.abs, min: Math.min, max: Math.max },
};

/** Every function of `source` as JavaScript: headers and declarations stripped of their types. */
function evaluate(source: string, operators: [string, string][]) {
  let js = source
    .replace(/uniform [^;]*;/g, '')
    .replace(
      /^(?:fn )?(?:\w+ )?(\w+)\(([^)]*)\)(?:->\w+)?\{/gm,
      (_, name: string, params: string) => {
        const names = params.split(',').map((param) => param.split(/[\s:]/).filter(Boolean)[0]);
        const glsl = params.split(',').map((param) => param.trim().split(/\s+/).pop()!);
        return `function ${name}(${(params.includes(':') ? names : glsl).join(',')}){`;
      },
    )
    .replace(/\b(?:let|float|vec3) (\w+)=/g, 'let $1=');
  for (const [from, to] of operators) js = js.replace(from, to);
  const scope = {
    ...BUILTINS,
    directLights: {},
    fogColor: {},
    fogLaw: {},
    toWorld: {},
    viewPosition: {},
  };
  const run = new Function(...Object.keys(scope), `${js};return {fogTransmittance,fogged};`);
  const bind = (values: Partial<typeof scope> & Record<string, unknown>) =>
    run(...Object.values({ ...scope, ...values })) as {
      fogged: (...args: unknown[]) => number[];
    };
  return bind;
}

const wgsl = evaluate(FOG_WGSL, [['P-eye', 'sub(P,eye)']]);
const glsl = evaluate(FOG_GLSL, [['viewPosition*viewRotation', 'toWorld(viewPosition)']]);

/** The WGSL `fogged` on the contract buffer's fog block, as `packEnvironment` writes it. */
function wgslFogged(fog: SceneFog | undefined, rgb: V3, P: V3, eye: V3) {
  const packed = packEnvironment({ exposure: 1, fog }, new Float32Array(SCENE_ENVIRONMENT_FLOATS));
  const block = [vec(packed.subarray(36, 40)), vec(packed.subarray(40, 44))];
  return wgsl({ directLights: { fog: block } }).fogged(rgb, vec(P), vec(eye));
}

/** The GLSL `fogged` in view space, its uniforms written by `WebglClusterFog` for a camera at
 *  `eye` turned by `yaw` about +y, its view matrix column-major. */
function glslFogged(fog: SceneFog | undefined, rgb: V3, P: V3, eye: V3, yaw = 0.7) {
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  const R = [c, 0, s, 0, 1, 0, -s, 0, c]; // world to view, column-major
  const turn = (v: V3): V3 =>
    [0, 1, 2].map((r) => R[r] * v[0] + R[3 + r] * v[1] + R[6 + r] * v[2]) as V3;
  const t = turn(eye).map((value) => -value);
  const view = [R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, t[0], t[1], t[2], 1];
  const uniforms: Record<string, number[]> = {};
  const gl = {
    getUniformLocation: (_: unknown, name: string) => name,
    uniform4fv: (at: string, data: Float32Array, from: number) =>
      void (uniforms[at] = Array.from(data.subarray(from, from + 4))),
  } as unknown as WebGL2RenderingContext;
  new WebglClusterFog(gl, {} as WebGLProgram).upload(fog, view);
  // `v * viewRotation` in GLSL: the transpose, view back to world.
  const toWorld = (v: V3) =>
    vec([0, 1, 2].map((j) => R[j * 3] * v[0] + R[j * 3 + 1] * v[1] + R[j * 3 + 2] * v[2]));
  const viewPosition = turn(sub(P, eye));
  return glsl({
    fogColor: vec(uniforms.fogColor),
    fogLaw: vec(uniforms.fogLaw),
    toWorld,
    viewPosition,
  }).fogged(rgb);
}

const RGB: V3 = [0.8, 0.3, 0.1];
const COLOR: V3 = [0.5, 0.6, 0.7];
const expected = (fog: SceneFog, P: V3, eye: V3) => {
  const t = oracle(fog, eye, P);
  return RGB.map((value, i) => COLOR[i] + (value - COLOR[i]) * t);
};
const close = (actual: number[], wanted: number[], label: string) =>
  actual.forEach((value, i) =>
    assert.ok(Math.abs(value - wanted[i]) < 2e-5, `${label}: ${value} ≠ ${wanted[i]}`),
  );
/** Both shaders at every point against the oracle. */
function lawHolds(fog: SceneFog, eye: V3, points: V3[]) {
  for (const P of points) {
    const want = expected(fog, P, eye);
    close(wgslFogged(fog, RGB, P, eye), want, `WGSL ${JSON.stringify({ fog, P })}`);
    close(glslFogged(fog, RGB, P, eye), want, `GLSL ${JSON.stringify({ fog, P })}`);
  }
}

test('linear fog: untouched before near, half-way between, the fog colour alone past far', () => {
  const fog = { color: COLOR, near: 10, far: 110 };
  const eye: V3 = [3, 2, -4];
  lawHolds(fog, eye, [
    [3, 2, 1],
    [3, 2, 6],
    [3, 2, 56],
    [3, 2, 106],
    [3, 2, 300],
  ]);
  close(
    wgslFogged(fog, RGB, [3, 2, 56], eye),
    RGB.map((v, i) => (v + COLOR[i]) / 2),
    'half',
  );
  close(glslFogged(fog, RGB, [3, 2, 300], eye), COLOR, 'far');
});

test('exponential fog: exp(−density·d) at every height when nothing falls off', () => {
  const fog = { color: COLOR, density: 0.02 };
  lawHolds(
    fog,
    [0, 5, 0],
    [
      [0, 5, 50],
      [30, -20, 10],
      [0, 80, -40],
    ],
  );
  close(wgslFogged(fog, RGB, [0, 5, 50], [0, 5, 0]), expected(fog, [0, 5, 50], [0, 5, 0]), 'e⁻¹');
});

test('height fog: the integrated density, looking level, up and down, from above and below', () => {
  const fog = { color: COLOR, density: 0.08, heightFalloff: 0.35, baseHeight: 1 };
  const points: V3[] = [
    [40, 2, 0],
    [40, 2.0001, 0],
    [10, -3, 30],
    [5, 25, -5],
    [0, 1, 200],
  ];
  lawHolds(fog, [0, 2, 0], points);
  lawHolds(fog, [0, -4, 0], points);
  // A long ray that barely rises: the two densities' mean, where the closed form would round.
  lawHolds({ ...fog, density: 0.005 }, [0, 2, 0], [[400, 2.0028, 0]]);
  // High above a steep falloff, the densities underflow and stay finite.
  lawHolds(
    { ...fog, heightFalloff: 1 },
    [0, 400, 0],
    [
      [0, 0, 10],
      [300, 1, 0],
    ],
  );
});

test('no fog: both shaders hand the lit colour back as it is, the block all zero', () => {
  const block = packFog(undefined, new Float32Array(8).fill(9), 0);
  assert.deepEqual(Array.from(block), [0, 0, 0, 0, 0, 0, 0, 0]);
  for (const P of [
    [0, 0, 5],
    [1e4, -300, 2],
  ] as V3[]) {
    assert.equal(wgslFogged(undefined, RGB, P, [0, 1, 0]), RGB);
    assert.equal(glslFogged(undefined, RGB, P, [0, 1, 0]), RGB);
  }
});
