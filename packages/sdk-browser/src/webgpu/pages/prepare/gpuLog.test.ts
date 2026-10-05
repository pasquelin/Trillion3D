// The GPU log (`gpuLog.ts`): silent without `trillion3dGpuLog=1`; with it, the device's line once,
// then one line every 60 drawn images from the timing sample the stats corner reads — each pass's
// own share, the sizes drawn and displayed, the projection's dispatch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuLog } from './gpuLog.ts';
import type { GpuTimingSample } from '../../../gpu/timing/types.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

const device = {
  features: new Set(['subgroups']),
  adapterInfo: { subgroupMinSize: 4, subgroupMaxSize: 64 },
};
const rt = {
  gpu: { targetSize: [1440, 900], displaySize: [2880, 1800] },
} as unknown as WebgpuPagesRuntime;
const sample = (frame: number, extra: object = {}) =>
  ({
    frame,
    submittedMs: 15.25,
    frameMsReason: null,
    pairs: { valid: 3, unwritten: 0, invalid: 0 },
    passes: [
      { name: 'vsm.projection', gpuMs: 7.5, ownMs: 7.14 },
      { name: 'taa', gpuMs: 1 },
      { name: 'vsm.projection', gpuMs: 0.5, ownMs: 0.5 },
    ],
    ...extra,
  }) as unknown as GpuTimingSample;

function logged(search: string | undefined, frames: number[], extra: object = {}) {
  const lines: string[] = [],
    log = console.log,
    had = 'location' in globalThis,
    before = (globalThis as { location?: unknown }).location;
  (globalThis as { location?: unknown }).location = search === undefined ? undefined : { search };
  console.log = (line: string) => void lines.push(line);
  try {
    const gpuLog = createGpuLog(device as unknown as GPUDevice);
    for (const frame of frames) gpuLog(rt, sample(frame, extra));
  } finally {
    console.log = log;
    if (had) (globalThis as { location?: unknown }).location = before;
    else delete (globalThis as { location?: unknown }).location;
  }
  return lines;
}

test('silent without the flag', () => {
  assert.deepEqual(logged(undefined, [0, 60, 120]), []);
  assert.deepEqual(logged('?trillion3dGpuLog=0', [0, 60]), []);
});

test('the device once, then a line every 60 images: passes, sizes, the dispatch', () => {
  const lines = logged('?trillion3dGpuLog=1', [12, 24, 72, 84, 133]);
  assert.equal(lines.length, 4);
  assert.match(
    lines[0],
    /^\[T3D-GPU\] subgroups yes \(sizes 4-64\), projection vote: subgroup \(workgroup counters where a half spans subgroups\)$/,
  );
  assert.equal(
    lines[1],
    '[T3D-GPU] frame 12 gpu 15.25 ms pairs valid 3 unwritten 0 invalid 0 drawn 1440x900 display 2880x1800 projection 180x113 groups' +
      ' = 1440x904 = 1301760 px | vsm.projection 7.64 taa 1.00',
  );
  assert.match(lines[2], /^\[T3D-GPU\] frame 72 /);
  assert.match(lines[3], /^\[T3D-GPU\] frame 133 /);
});

test('the timed scale, an untimed instance as -, a truncated image and no projection said', () => {
  const [, line] = logged('?trillion3dGpuLog=1', [5], {
    renderScale: 0.5,
    truncated: true,
    passes: [
      { name: 'taa', gpuMs: 1 },
      { name: 'taa', gpuMs: null },
    ],
  });
  assert.match(line, / timed at scale 0\.500 no projection \(truncated\) \| taa -$/);
});

test('an image with no GPU time says why, with its pairs by state', () => {
  const lines = logged('?trillion3dGpuLog=1', [12], {
    submittedMs: null,
    frameMsReason: 'no-valid-pair',
    pairs: { valid: 0, unwritten: 5, invalid: 1 },
  });
  assert.match(
    lines[1],
    /^\[T3D-GPU\] frame 12 gpu - ms \(no span: no-valid-pair\) pairs valid 0 unwritten 5 invalid 1 drawn /,
  );
});

test('the mean CPU and the mean and max interval of the images since the last line', () => {
  const lines: string[] = [],
    log = console.log,
    before = (globalThis as { location?: unknown }).location;
  (globalThis as { location?: unknown }).location = { search: '?trillion3dGpuLog=1' };
  console.log = (line: string) => void lines.push(line);
  try {
    const gpuLog = createGpuLog(device as unknown as GPUDevice);
    gpuLog.frame(2, null);
    gpuLog.frame(3, 8);
    gpuLog.frame(2.5, 16.7);
    gpuLog(rt, sample(1));
    gpuLog.frame(1, 9);
    gpuLog(rt, sample(61));
    gpuLog(rt, sample(200));
  } finally {
    console.log = log;
    (globalThis as { location?: unknown }).location = before;
  }
  assert.match(lines[1], /^\[T3D-GPU\] frame 1 gpu 15\.25 ms cpu 2\.50 ms raf 12\.35\/16\.70 ms pairs/);
  assert.match(lines[2], / gpu 15\.25 ms cpu 1\.00 ms raf 9\.00\/9\.00 ms pairs/);
  assert.doesNotMatch(lines[3], / cpu | raf /);
});
