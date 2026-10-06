import type { Capture } from '../../tests/kit/server/staticServer.ts';
import type { GpuPassTimings } from '../../packages/sdk-core/src/index.ts';
import { distribution } from './summary/summary.ts';
import { passesGpu } from './series/seriesPasses.ts';
import { imageDiff } from './imageDiff.ts';
import type { FeedbackTargetResult } from './feedbackTargetPage.ts';
const MIN_GPU_SAMPLES = 12;
const RESOLVE = 'Trillion3D material surfaces v1';
const BLEND = 'Trillion3D transparents';
const REDUCE = 'Trillion3D texture feedback reduce';
const NAMES = [RESOLVE, BLEND, 'Trillion3D water surfaces', REDUCE];
const present = (samples: GpuPassTimings[], name: string) =>
  samples.some(
    (sample) =>
      !sample.truncated &&
      sample.passes.some((pass) => pass.name === name && typeof pass.gpuMs === 'number'),
  );
export function summarizeFeedbackRun(
  raw: FeedbackTargetResult,
  scene: string,
  view: string,
  captures: ReadonlyMap<string, Capture>,
  incidents: readonly string[],
) {
  const convergence = raw.convergence && {
    ...raw.convergence,
    gpuPassSamples: raw.convergence.gpuPassSamples.length,
    convergingReduceMs:
      passesGpu(raw.convergence.gpuPassSamples)?.passes.find((pass) => pass.name === REDUCE)
        ?.gpuMs ?? null,
    mipScope: 'scene',
    captures: raw.convergence.captures.map((entry) => ({
      ...entry,
      file: entry.file.replace(/\.rgba$/, '.png'),
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
    const frame = distribution(reading.gpuFrameMs);
    const passes = Object.fromEntries(
      NAMES.map((name) => [name, all?.passes.find((pass) => pass.name === name)?.gpuMs ?? null]),
    );
    return {
      label: ['A1', 'B', 'A2'][index],
      target: reading.target,
      gpuFrameMs: frame,
      gpuSamples: reading.gpuFrameMs.length,
      passes,
      passFrameShare: Object.fromEntries(
        NAMES.map((name) => [
          name,
          frame?.p50 && passes[name]?.p50 != null ? passes[name].p50 / frame.p50 : null,
        ]),
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
        c.coverageReady === true &&
        (c.selectedTriangles ?? 0) > 0 &&
        c.selectedTriangles === c.drawnTriangles
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
  // The whole frame and every surface kind both regions request converge center first.
  const orderedMip =
    !!convergence &&
    Object.entries(convergence.order).every(
      ([scope, at]) =>
        (scope !== 'all' && !at.present) ||
        (at.centerFirst !== null &&
          at.peripheryAtLevel !== null &&
          at.centerFirst < at.peripheryAtLevel),
    );
  const parityValid =
    raw.convergence?.supported === true &&
    orderedMip &&
    sameImage &&
    incidents.length === 0 &&
    resident &&
    bytes &&
    passValid &&
    samples.length === 3 &&
    samples.every((count) => count >= MIN_GPU_SAMPLES);
  const gain = parityValid && delta !== null && spread !== null ? delta > spread : null;
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
      orderedMip,
      incidents: incidents.length === 0,
    },
    parityValid: gain !== null,
    beyondSpread: gain,
    incidents: [...incidents],
  };
}
