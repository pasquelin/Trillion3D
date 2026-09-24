import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inertTaaDevice } from './device.fixture.ts';
import { prepareTemporalAntialiasing, setWebgpuTemporalAntialiasing } from './prepare.ts';
import { TAA_CAPABILITY } from './capability.ts';
import { beginTaaFrame, taaSettled } from './frame.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import type { EngineCamera } from '../camera/world.ts';

function runtime(temporalAntialiasing: boolean) {
  let changed = 0;
  const rt = {
    context: { temporalAntialiasing },
    gpu: { temporal: undefined, temporalWanted: true, device: inertTaaDevice(), targetBytes: 0 },
    capabilities: { unsupported: [TAA_CAPABILITY] },
    layout: { selectionRoots: [] },
    signal: new AbortController().signal,
    capture: { capturing: false },
    run: { diagnostic: 'beauty', gate: { resourcesChanged: () => void changed++ } },
  } as unknown as WebgpuPagesRuntime;
  return { rt, changed: () => changed };
}

const served = (rt: WebgpuPagesRuntime) => !rt.capabilities.unsupported.includes(TAA_CAPABILITY);

// #363: the session opened with it off turns it on in place, and off again, without reopening.
test('temporal antialiasing is switched during the session', async () => {
  const { rt, changed } = runtime(false);
  await prepareTemporalAntialiasing(rt, rt.gpu.device!);
  assert.equal(rt.gpu.temporal, undefined, 'refused at opening: nothing created');
  setWebgpuTemporalAntialiasing(rt, true);
  assert.equal(served(rt), false, 'not drawn while the program compiles');
  for (let turn = 0; turn < 5; turn++) await new Promise(setImmediate);
  const temporal = rt.gpu.temporal!;
  assert.ok(temporal && served(rt), 'rigged in place');
  assert.equal(changed(), 2, 'a frame at the switch, one once rigged');
  temporal.frame.hasHistory = true;
  setWebgpuTemporalAntialiasing(rt, false);
  assert.equal(served(rt), false);
  assert.equal(temporal.frame.hasHistory, false, 'the history is dropped');
  const cam = { viewProjection: new Float64Array(16), eye: [0, 0, 0] } as unknown as EngineCamera;
  beginTaaFrame(rt, cam, true);
  assert.equal(temporal.frame.active, false, 'off: the image does not accumulate');
  assert.equal(taaSettled(rt), true, 'and the frame can be held');
  setWebgpuTemporalAntialiasing(rt, true);
  assert.ok(rt.gpu.temporal === temporal && served(rt), 'on again: the kept program, at once');
  assert.equal(changed(), 4);
});

test('a pass switched off while it compiles is not kept', async () => {
  const { rt } = runtime(false);
  await prepareTemporalAntialiasing(rt, rt.gpu.device!);
  setWebgpuTemporalAntialiasing(rt, true);
  setWebgpuTemporalAntialiasing(rt, false);
  for (let turn = 0; turn < 5; turn++) await new Promise(setImmediate);
  assert.equal(rt.gpu.temporal, undefined);
  assert.equal(served(rt), false);
});
