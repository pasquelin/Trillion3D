import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { random } from '../../page/cut/cutRuleChecks.fixture.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { requestExplorerDevice } from '../../world/session/gpuDevice.ts';
import { LIGHT_TILES_SHADERS } from './shader.ts';
import { createGpuLightTiles } from './tiles.ts';

// #924 (OMB-03): granted `subgroups`, each subgroup reduces the tile's depth bounds first: the
// per-thread atomics' words to the bit, any subgroup size, NaN, ±0, +Inf and subnormals included.

const LANES = LIGHT_SETTINGS.tileSize ** 2;
const word = new Float32Array(1),
  bits = new Uint32Array(word.buffer);
const bitsOf = (z: number) => ((word[0] = z), bits[0]);
type Lane = { z: number; inside: boolean };

/** `SUBGROUP_DEPTH_BOUNDS`: each subgroup of `size` lanes reduces, its elected lane stores. One
 *  lane per subgroup is `ATOMIC_DEPTH_BOUNDS`, each thread its own atomics. */
function subgroupBounds(lanes: Lane[], size: number) {
  const out = { nearest: 0, farthest: 0xffffffff, covered: 0, skyward: 0 };
  for (let first = 0; first < lanes.length; first += size) {
    const group = lanes.slice(first, first + size);
    const lit = group.map(({ z, inside }) => inside && z > 0);
    const near = Math.max(...group.map(({ z }, i) => (lit[i] ? bitsOf(z) : 0)));
    const far = Math.min(...group.map(({ z }, i) => (lit[i] ? bitsOf(z) : 0xffffffff)));
    const anyLit = lit.some(Boolean),
      anySky = group.some(({ inside }, i) => inside && !lit[i]);
    if (anyLit) {
      out.nearest = Math.max(out.nearest, near);
      out.farthest = Math.min(out.farthest, far);
      out.covered = 1;
    }
    if (anySky) out.skyward = 1;
  }
  return out;
}

const SPECIAL = [NaN, 0, -0, Infinity, -Infinity, 1, 1e-45, 1.1754942e-38, 0.5, 1e-6];
const same = (lanes: Lane[], at: string) => {
  const expected = subgroupBounds(lanes, 1);
  for (const size of [4, 8, 16, 32, 64, 128])
    assert.deepEqual(subgroupBounds(lanes, size), expected, `${at}, subgroup ${size}`);
};

test('subgroup depth bounds write the words of the per-thread atomics, any subgroup size', () => {
  const r = random(924);
  for (let run = 0; run < 400; run++) {
    const special = r() < 0.5,
      cut = Math.floor(r() * LANES) + 1;
    const lanes = [...Array(LANES).keys()].map((i) => ({
      z: Math.fround(special && r() < 0.3 ? SPECIAL[Math.floor(r() * SPECIAL.length)] : r()),
      inside: i < cut || r() < 0.5,
    }));
    same(lanes, `run ${run}`);
  }
});

test('an adapter that offers subgroups gets them, and its light tiles run the subgroup pass', async () => {
  for (const offered of [['subgroups'], []]) {
    const compiled: string[] = [];
    const adapter = {
      features: new Set(offered),
      limits: {},
      requestDevice: async ({ requiredFeatures }: GPUDeviceDescriptor) =>
        Object.assign(fakeDevice().device, {
          features: new Set(requiredFeatures),
          createShaderModule: ({ code }: GPUShaderModuleDescriptor) => (
            compiled.push(code),
            { getCompilationInfo: async () => ({ messages: [] }) }
          ),
        }),
    } as unknown as GPUAdapter;
    const tiles = await createGpuLightTiles(await requestExplorerDevice(adapter));
    const granted = offered.length > 0;
    assert.equal(tiles.subgroups, granted);
    assert.deepEqual(compiled, [LIGHT_TILES_SHADERS[+granted][1]]);
    assert.equal(compiled[0].startsWith('enable subgroups;'), granted);
  }
});
