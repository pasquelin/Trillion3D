/**
 * `trillion3dGpuLog=1` in the page's address: a `[T3D-GPU]` console line every 60 drawn images,
 * read from the engine's own timing sample (`timing.ts`, the stats corner's numbers): each pass's
 * own share of the GPU image, the size drawn and the display's, the shadow projection's dispatch;
 * the mean CPU time per drawn image and the mean and max display interval over the images since
 * the last line (` cpu 2.31 ms raf 9.10/16.70 ms`, right after the GPU field; the CPU is the
 * corner's `cpuFrameMs`, the interval its `rafIntervalMs`); the timed passes by the state their
 * timestamp pair read in (valid, unwritten, invalid) and, when the image has no GPU time, why
 * (`frameMsReason`); and once, first, the device's `subgroups` feature and the vote the projection
 * compiles with it.
 * Nothing is timed for it: without the flag it reads nothing and writes nothing.
 */
import { addressFlag } from '../../../host/addressFlag.ts';
import type { GpuTimingSample } from '../../../gpu/timing/types.ts';
import { vsmProjectionCanUseSubgroups } from '../../../vsm/projectionPass.ts';
import { VSM_PROJECTION_GROUP_SIZE } from '../../../vsm/projectionWgsl.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { passOwnMs } from '../../../stage/mapping.ts';

const EVERY_FRAMES = 60;
const asked = addressFlag((params) => params.get('trillion3dGpuLog') === '1');
const ms = (value: number | null | undefined) => (value == null ? '-' : value.toFixed(2));

/** The device's line, written once: its subgroups and the projection's vote. */
function deviceLine(device: GPUDevice) {
  const info = (device as { adapterInfo?: { subgroupMinSize?: number; subgroupMaxSize?: number } })
    .adapterInfo;
  const subgroups = vsmProjectionCanUseSubgroups(device);
  const vote = subgroups
    ? 'subgroup (workgroup counters where a half spans subgroups)'
    : 'workgroup counters';
  return (
    `[T3D-GPU] subgroups ${subgroups ? 'yes' : 'no'}` +
    ` (sizes ${info?.subgroupMinSize ?? '?'}-${info?.subgroupMaxSize ?? '?'}), projection vote: ${vote}`
  );
}

/** What the timing sample of `device` hands the log (`prepareGpuTiming`). */
export function createGpuLog(device: GPUDevice) {
  let next = -1;
  // The images since the last line: the corner's CPU time (`FrameMetrics.cpuFrameMs`, fed by
  // `frameCpuMs`) and the display's interval (`rafIntervalMs`), summed and maxed.
  let images = 0,
    cpuSum = 0,
    rafImages = 0,
    rafSum = 0,
    rafMax = 0;
  const log = (rt: WebgpuPagesRuntime, sample: GpuTimingSample) => {
    if (!asked() || sample.frame < next) return;
    if (next < 0) console.log(deviceLine(device));
    next = sample.frame + EVERY_FRAMES;
    // Each pass's own share, its instances summed; '-' where one went untimed.
    const own = new Map<string, number | null>();
    for (const pass of sample.passes) {
      const value = passOwnMs(pass),
        sum = own.get(pass.name);
      own.set(pass.name, value == null || sum === null ? null : (sum ?? 0) + value);
    }
    // The projection's groups over the size drawn now (`encodeVsmFrame`), the timed image's scale
    // beside it: a sample describes an image a few frames past.
    const cpu = images ? ` cpu ${ms(cpuSum / images)} ms` : '',
      raf = rafImages ? ` raf ${ms(rafSum / rafImages)}/${ms(rafMax)} ms` : '';
    images = cpuSum = rafImages = rafSum = rafMax = 0;
    const [width, height] = rt.gpu.targetSize,
      [displayWidth, displayHeight] = rt.gpu.displaySize,
      side = VSM_PROJECTION_GROUP_SIZE,
      x = Math.ceil(width / side),
      y = Math.ceil(height / side);
    console.log(
      `[T3D-GPU] frame ${sample.frame} gpu ${ms(sample.submittedMs)} ms` +
        cpu +
        raf +
        (sample.frameMsReason ? ` (no span: ${sample.frameMsReason})` : '') +
        ` pairs valid ${sample.pairs.valid} unwritten ${sample.pairs.unwritten}` +
        ` invalid ${sample.pairs.invalid} drawn ${width}x${height} display ${displayWidth}x${displayHeight}` +
        (typeof sample.renderScale === 'number'
          ? ` timed at scale ${sample.renderScale.toFixed(3)}`
          : '') +
        (own.has('vsm.projection')
          ? ` projection ${x}x${y} groups = ${x * side}x${y * side} = ${x * y * side * side} px`
          : ' no projection') +
        (sample.truncated ? ' (truncated)' : '') +
        ' |' +
        [...own].map(([name, value]) => ` ${name} ${ms(value)}`).join(''),
    );
  };
  /** One drawn image: its CPU time and the display's interval, `null` when not yet measured. */
  const frame = (cpuMs: number, rafMs: number | null) => {
    if (!asked()) return;
    images++;
    cpuSum += cpuMs;
    if (rafMs !== null) {
      rafImages++;
      rafSum += rafMs;
      if (rafMs > rafMax) rafMax = rafMs;
    }
  };
  return Object.assign(log, { frame });
}
