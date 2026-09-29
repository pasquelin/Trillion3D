// An explicitly requested `lit` view lights, even with no light: the contract runs and outputs
// black, emissives kept. Previously `store.count > 0` fell back to raw albedo, and a room just
// switched off displayed bright — the blackout showed on no pixel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore, type SceneLight } from '../../../../../sdk-core/src/index.ts';
import {
  followLightThreshold,
  readsAsIs,
  seedShare,
  wantsContractLighting,
} from './lightResources.ts';
import { createWebgpuLightState } from '../state/lights.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

const LAMPE: SceneLight = {
  id: 'l0',
  kind: 'point',
  position: [0, 2, 0],
  color: [1, 1, 1],
  intensity: 5,
  range: 10,
  castsShadow: false,
};

function banc() {
  const store = createSceneLightStore();
  return { store, rt: { lights: { store } } as unknown as WebgpuPagesRuntime };
}

test('`lit` view with no light: the contract still lights, the image comes out black', () => {
  const b = banc();
  b.store.setView('lit');
  assert.equal(wantsContractLighting(b.rt), true);
});

test('turning off the last light in a `lit` view does not bring albedo back', () => {
  const b = banc();
  b.store.setView('lit');
  b.store.add({ ...LAMPE });
  assert.equal(wantsContractLighting(b.rt), true);
  b.store.remove('l0');
  assert.equal(wantsContractLighting(b.rt), true, 'always lit, therefore black: that is the rule');
});

test('`auto` keeps its behaviour: albedo while no light is declared', () => {
  const b = banc();
  assert.equal(wantsContractLighting(b.rt), false, 'auto with no light: raw albedo');
  b.store.add({ ...LAMPE });
  assert.equal(wantsContractLighting(b.rt), true, 'a declared light: real lighting takes over');
  b.store.remove('l0');
  assert.equal(
    wantsContractLighting(b.rt),
    false,
    'and it falls back to albedo when there are none left',
  );
});

test('`unlit` stays the diagnostic view, lights or not', () => {
  const b = banc();
  b.store.setView('unlit');
  assert.equal(wantsContractLighting(b.rt), false);
  b.store.add({ ...LAMPE });
  assert.equal(wantsContractLighting(b.rt), false);
});

test('the light cuts select at the camera threshold, which no budget raises', () => {
  const lights = createWebgpuLightState(32);
  assert.equal(followLightThreshold(lights, 1), 1);
  assert.equal(followLightThreshold(lights, 8), 8);
});

// OMB-11: the flagless variants are chosen only when nothing in the image can write the as-is flag.
test('the image reads its as-is flags once a row shows one, or under a diagnostic view', () => {
  const at = (asIsShown: boolean, diagnostic: string) =>
    readsAsIs({ vis: { asIsShown }, run: { diagnostic } } as unknown as WebgpuPagesRuntime);
  assert.equal(at(false, 'beauty'), false, 'no as-is surface: flagless');
  assert.equal(at(true, 'beauty'), true, 'a normal or depth surface took a row');
  assert.equal(at(false, 'wireframe'), true, 'a diagnostic view writes the flag');
});

// #833: particles alone write their coverage as the reactive value, over a share seeded 0.
test('the share is seeded when blends or particles draw over it, and only then', () => {
  let seeds = 0;
  const share = { seed: () => void seeds++ };
  const at = (blends: number, particles: boolean) =>
    seedShare(
      {
        gpu: {
          asIsShare: share,
          hdrView: {},
          depthView: {},
          particles: particles ? {} : undefined,
        },
        blendState: { blendGpu: { length: blends } },
        vis: { blendPipelines: {} },
        context: { particles: [] },
        run: { diagnostic: 'beauty', lastCamera: {} },
      } as unknown as WebgpuPagesRuntime,
      {} as GPUCommandEncoder,
    );
  assert.equal(at(0, false), undefined, 'nothing draws over it: not seeded');
  assert.equal(seeds, 0);
  assert.equal(at(2, false), share, 'blends');
  assert.equal(at(0, true), share, 'particles alone');
  assert.equal(seeds, 2);
});
