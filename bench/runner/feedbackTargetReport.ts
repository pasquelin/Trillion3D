import type { Capture } from '../../tests/kit/server/staticServer.ts';
import type { GpuPassTimings } from '../../packages/sdk-core/src/index.ts';
import { distribution } from './summary.ts';
import { passesGpu } from './seriesPasses.ts';
import { imageDiff } from './imageDiff.ts';
import type { FeedbackTargetResult } from './feedbackTargetPage.ts';
export const MIN_GPU_SAMPLES = 12;
const RESOLVE = 'Trillion3D material surfaces v1';
const BLEND = 'Trillion3D transparents';
const WATER = 'Trillion3D water surfaces';
const REDUCE = 'Trillion3D texture feedback reduce';
const NAMES = [RESOLVE, BLEND, WATER, REDUCE];
export function feedbackGainGate(inputs: {
  convergence: boolean;
  sameImage: boolean;
  residency: boolean;
  bytes: boolean;
  samples: number[];
  passes: boolean;
  delta: number | null;
  spread: number | null;
}): boolean | null {
  if (
    !inputs.convergence ||
    !inputs.sameImage ||
    !inputs.residency ||
    !inputs.bytes ||
    !inputs.passes ||
    inputs.samples.length !== 3 ||
    inputs.samples.some((count) => count < MIN_GPU_SAMPLES) ||
    inputs.delta === null ||
    inputs.spread === null
  )
    return null;
  return inputs.delta > inputs.spread;
}
const present = (samples: GpuPassTimings[], name: string) =>
  samples.some(
    (sample) =>
      !sample.truncated &&
      sample.passes.some((pass) => pass.name === name && typeof pass.gpuMs === 'number'),
  );
/** Pixel changes in the middle half of the view, where the frozen gaze looks. */
export function gazeDifferentPixels(a: Capture | undefined, b: Capture | undefined) {
  if (!a || !b || a.w !== b.w || a.h !== b.h) return null;
  let different = 0;
  for (let y = Math.floor(a.h / 4); y < Math.ceil((a.h * 3) / 4); y++)
    for (let x = Math.floor(a.w / 4); x < Math.ceil((a.w * 3) / 4); x++) {
      const at = (y * a.w + x) * 4;
      if (
        a.body[at] !== b.body[at] ||
        a.body[at + 1] !== b.body[at + 1] ||
        a.body[at + 2] !== b.body[at + 2]
      )
        different++;
    }
  return different;
}

export function summarizeFeedbackRun(
  raw: FeedbackTargetResult,
  scene: string,
  view: string,
  captures: ReadonlyMap<string, Capture>,
  incidents: readonly string[],
) {
  const reference = raw.convergence?.captures.find((entry) => entry.final);
  const convergence = raw.convergence && {
    ...raw.convergence,
    captures: raw.convergence.captures.map((entry) => ({
      ...entry,
      file: entry.file.replace(/\.rgba$/, '.png'),
      diffToFinal: reference
        ? imageDiff(captures.get(entry.file), captures.get(reference.file))
        : null,
      gazeDifferentPixels: reference
        ? gazeDifferentPixels(captures.get(entry.file), captures.get(reference.file))
        : null,
    })),
  };
  if (!raw.supported)
    return {
      scene,
      view,
      supported: false,
      reason: raw.reason,
      convergence,
      incidents: [...incidents],
      beyondSpread: null,
    };
  const [a1, b, a2] = raw.readings;
  const readings = raw.readings.map((reading, index) => {
    const all = passesGpu(reading.gpuPassSamples);
    return {
      label: ['A1', 'B', 'A2'][index],
      target: reading.target,
      gpuFrameMs: distribution(reading.gpuFrameMs),
      gpuSamples: reading.gpuFrameMs.length,
      passes: Object.fromEntries(
        NAMES.map((name) => [name, all?.passes.find((pass) => pass.name === name)?.gpuMs ?? null]),
      ),
      counters: reading.counters,
      residency: reading.residency,
      capture: reading.capture.replace(/\.rgba$/, '.png'),
    };
  });
  const aa = imageDiff(captures.get(a1.capture), captures.get(a2.capture));
  const ab = imageDiff(captures.get(a1.capture), captures.get(b.capture));
  const sameImage =
    !!aa && !!ab && 'pixels' in aa && 'pixels' in ab && aa.pixels === 0 && ab.pixels === 0;
  const sameResidency = raw.readings.every(
    (reading) =>
      reading.residency.geometry.sha256 === a1.residency.geometry.sha256 &&
      reading.residency.geometry.count === a1.residency.geometry.count &&
      reading.residency.tiles.sha256 === a1.residency.tiles.sha256 &&
      reading.residency.tiles.count === a1.residency.tiles.count,
  );
  const resident =
    sameResidency &&
    raw.readings.every((reading) => {
      const c = reading.counters;
      return (
        c.textureTilesPending === 0 &&
        c.textureMissingLevels === 0 &&
        c.textureTilesRequested === c.textureTilesAtLevel &&
        c.pagesLoading === 0 &&
        c.uncoveredTriangles === 0
      );
    });
  const feedbackBytes = 2496 * 1404 * 4;
  const onBytes = a1.counters.gpuFrameTargetBytes ?? null;
  const offBytes = b.counters.gpuFrameTargetBytes ?? null;
  const bytes =
    onBytes !== null &&
    offBytes !== null &&
    onBytes === a2.counters.gpuFrameTargetBytes &&
    onBytes - offBytes === feedbackBytes;
  const [first, middle, last] = readings.map((reading) => reading.gpuFrameMs?.p50 ?? null);
  const spread = first !== null && last !== null ? Math.abs(first - last) : null;
  const delta =
    first !== null && middle !== null && last !== null ? (first + last) / 2 - middle : null;
  const passValid = raw.readings.every(
    (reading, index) =>
      present(reading.gpuPassSamples, RESOLVE) &&
      (scene !== 'alpha-blend-mode-test' || present(reading.gpuPassSamples, BLEND)) &&
      (index === 1
        ? !reading.gpuPassSamples.some((sample) =>
            sample.passes.some((pass) => pass.name === REDUCE),
          )
        : present(reading.gpuPassSamples, REDUCE)),
  );
  const samples = readings.map((reading) => reading.gpuSamples);
  const visibleGazeGap =
    convergence?.captures.some(
      (entry) =>
        !entry.final &&
        entry.diffToFinal &&
        'pixels' in entry.diffToFinal &&
        entry.diffToFinal.pixels > 0 &&
        (entry.gazeDifferentPixels ?? 0) > 0,
    ) === true;
  const gain = feedbackGainGate({
    convergence: raw.convergence?.supported === true && visibleGazeGap,
    sameImage: sameImage && incidents.length === 0,
    residency: resident,
    bytes,
    samples,
    passes: passValid,
    delta,
    spread,
  });
  return {
    scene,
    view,
    supported: gain !== null,
    reason: gain === null ? 'FEEDBACK_AB_VERDICT_UNSUPPORTED; inspect gates' : null,
    pose: raw.pose,
    convergence,
    readings,
    aa,
    ab,
    feedbackBytes,
    feedbackTargetShare: onBytes ? feedbackBytes / onBytes : null,
    spread,
    delta,
    gates: {
      sameImage,
      resident,
      bytes,
      passValid,
      enoughSamples: samples.every((count) => count >= MIN_GPU_SAMPLES),
      convergence: raw.convergence?.supported === true,
      visibleGazeGap,
      incidents: incidents.length === 0,
    },
    parityValid: gain !== null,
    beyondSpread: gain,
    incidents: [...incidents],
  };
}
