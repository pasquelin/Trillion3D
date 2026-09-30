// #1275: a point lamp with a radius shades through PCSS (`lampSoftWgsl.ts`), whose taps spread over
// a disk that crosses pages and cube faces. The per-pixel demand, run from its shipped WGSL through
// `shaderRun`, marks every page the shipped soft shading reads at the same point, in the same frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SceneLight } from '../../../../sdk-core/src/index.ts';
import { writeFace } from '../../../../sdk-core/src/scene/light-shadow/faces.ts';
import { LAMP } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { PAGE_MODEL_FUNCTIONS } from '../../../../sdk-core/src/scene/light-shadow/pageModelWgsl.ts';
import { POINT_FACES } from '../../../../sdk-core/src/scene/light/contracts.ts';
import { LAMP_SOFT_WGSL } from '../../lighting/direct/lampSoftWgsl.ts';
import { SHADOW_FACTOR_WGSL } from '../../lighting/direct/shadowFactorWgsl.ts';
import { POISSON_16 } from '../../lighting/direct/shadowWgsl.ts';
import { wgslConstants } from '../../texture/shaderRule.fixture.ts';
import { Mat, shaderRun } from '../../texture/shaderRun.fixture.ts';
import { shadowDemandWgsl } from './demandWgsl.ts';

const SHADOW_DEMAND_WGSL = shadowDemandWgsl();

type V = number[];
type PageMap = { base: number };
type Run = {
  demandLamp: (index: number, light: object, P: V, N: V, L: V, footprint: number) => void;
  lampShadowFactor: (index: number, light: object, P: V, N: V, L: V, taps: boolean) => number;
  shadowPageEntry: (m: PageMap, p: V) => number;
};

const SOURCE = SHADOW_DEMAND_WGSL + SHADOW_FACTOR_WGSL + LAMP_SOFT_WGSL;
const lamp: SceneLight = { ...LAMP, position: [0, 0, 0], range: 20, emitterRadius: 0.5 };
const matrices = new Float32Array(POINT_FACES * 16);
const planes = [0, 1, 2, 3, 4, 5].map((face) =>
  writeFace(matrices, face * 16, null, 0, lamp, face),
);
const { near, far } = planes[0];
/** A face's matrix, its columns indexed as well (\`lampShadowFactor\` reads their \`w\`). */
const faceOf = (face: number) => {
  const m = [...matrices.subarray(face * 16, face * 16 + 16)];
  return Object.assign(
    new Mat(m),
    [0, 1, 2, 3].map((c) => m.slice(c * 4, c * 4 + 4)),
  );
};
/** The lamp's record: its six faces, its tangent half-field, its near plane, entry 0 first. */
const record = {
  faces: planes.map((_, face) => faceOf(face)),
  info: [POINT_FACES, Math.tan(planes[0].halfFov), near, 0],
};
/** The pages marked and read, and the depth every atlas texel holds: a caster at one axial depth. */
const live = { marked: new Set<number>(), read: new Set<number>(), maps: new Set<number>(), z: 0 };
const cross = (a: V, b: V) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const run: Run = shaderRun<Run>(
  SOURCE,
  [
    ...['demandLamp', 'demandPages', 'demandPage', 'demandSoftLamp', 'softPageExit'],
    ...['lampShadowFactor', 'pointSoftShadow', 'lampDiskSample', 'lampSoftDisk'],
    ...['shadowPageEntry', 'lampReadAt', 'shadowNormalTexels', 'pointFaceOf'],
    ...PAGE_MODEL_FUNCTIONS,
  ],
  {
    ...wgslConstants(SOURCE),
    POISSON: POISSON_16,
    cross,
    shadows: { records: [record] },
    shadowFootprint: 0.004,
    shadowTransmission: [1, 1, 1],
    shadowAtlas: null,
    shadowTransmittance: null,
    requestShadowPage: (entry: number) => live.marked.add(entry),
    // The shading's page read: every page it takes is readable and heard.
    shadowPageWord: (m: PageMap, p: V) => {
      live.read.add(run.shadowPageEntry(m, p));
      live.maps.add(m.base);
      return 1;
    },
    shadowOffset: () => [0, 0, 0],
    textureLoad: () => live.z,
    textureDimensions: () => [1, 1],
    shadowDepthMargin: () => 0,
    // Not the soft answer, 1: the test sees which one shades.
    shadowPcf: () => 0.5,
    LampDisk: (T: V, B: V, distance: number, closest: number, search: number) => ({
      ...{ T, B, distance },
      ...{ closest, search },
    }),
    LampSample: (distance: number, blocked: boolean, through: V) => ({
      distance,
      blocked,
      through,
    }),
    ShadowAt: (map: object, t: V, home: V, Q: V, texel: number) => ({ map, t, home, Q, texel }),
    LampAt: (at: object, clip: V, ndc: V, face: number, side: number, inside: boolean) => ({
      ...{ at, clip, ndc },
      ...{ face, side, inside },
    }),
    ShadowMap: (base: number, ring: number, pages: number, ox: number, oy: number) => ({
      ...{ base, ring, pages },
      ...{ ox, oy },
    }),
  },
);

test('the demand marks every page a wide point lamp soft shadow reads, across faces', () => {
  const light = { positionRange: [...lamp.position!, lamp.range!], shape: [0.5, 0, 0, 0] };
  // Casters at these axial depths, every one past the emitter's sphere, as a map holds them.
  for (const axial of [0.6, 1.2, 1.8]) {
    live.z = (near * (far - axial)) / ((far - near) * axial);
    // A floor 2 m under the lamp, its points near the edge of the down face and a side face.
    for (let x = 1.6; x <= 2.4; x += 0.2)
      for (const z of [-0.3, 0.4, 1.9]) {
        const P = [x, -2, z],
          N = [0, 1, 0],
          radius = Math.hypot(...P),
          L = P.map((c) => -c / radius);
        live.read.clear();
        live.marked.clear();
        live.maps.clear();
        run.demandLamp(0, light, P, N, L, 0.004);
        assert.equal(run.lampShadowFactor(0, light, P, N, L, true), 1, 'the soft shadow answers');
        assert.ok(live.maps.size > 1, `${P}: the taps read two faces or mips`);
        const unmarked = [...live.read].filter((entry) => !live.marked.has(entry));
        assert.deepEqual(unmarked, [], `${P}, caster at ${axial}: pages read and not marked`);
      }
  }
});
