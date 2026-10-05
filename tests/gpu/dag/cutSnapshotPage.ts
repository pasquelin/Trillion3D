// What a frame pays to bring the cut back, on the engine's real cut (`createDagResources`,
// `encodeDagKernels`) and the machine's device. The engine copies `readbackBytes`, bounded by the
// readout's cap (`layout.ts`); the catalogue-sized readout it replaced, `16 + pageCount·4` bytes
// per list, is measured on a buffer of that size, the kernels' encode unchanged, so the gap between
// the two is the price of copying the worst case. The read is serialised here — copy, submit,
// `mapAsync`, read — where the engine double-buffers it: a frame's total work, not its stall.
import { createDagResources } from '../../../packages/sdk-browser/src/gpu/dag/resources.ts';
import { encodeDagKernels } from '../../../packages/sdk-browser/src/gpu/dag/encode.ts';
import { DAG_VIEW_WORDS } from '../../../packages/sdk-browser/src/gpu/dag/shader/viewsWgsl.ts';
import { writeDagUniforms } from '../../../packages/sdk-browser/src/gpu/dag/uniforms.ts';
import { SELECTION_HEADER_WORDS } from '../../../packages/sdk-browser/src/gpu/dag/layout.ts';
import { median } from '../../../scripts/median.ts';
import { openGpuDevice } from '../kit/webgpuDevice.ts';
import { sceneView } from './cutScene.ts';

interface Sweep {
  /** Scene sizes, in leaves: the pyramid holds about twice as many pages. */
  sizes: number[];
  levels: number;
  frames: number;
  rounds: number;
  /** Screen thresholds: what decides the cut's size, hence what a cap can lose. */
  thresholds: number[];
}

export async function measureReadback({ sizes, levels, frames, rounds, thresholds }: Sweep) {
  const gpu = await openGpuDevice();
  if (!gpu) throw new Error('WebGPU must be available');
  const rows = [];
  let refused: string | undefined;
  // A size past what this device holds is refused by the engine, and the larger ones with it.
  for (const leaves of sizes) {
    const view = sceneView(leaves, levels);
    const row = await measure(gpu.device, view, { frames, rounds, thresholds });
    if (!row) {
      refused = `${view.packed.pageCount} pages`;
      break;
    }
    rows.push(row);
  }
  const { court: adapter } = await gpu.fermer();
  return { adapter, errors: gpu.errors, rows, refused };
}

async function measure(
  device: GPUDevice,
  { packed, uniforms }: ReturnType<typeof sceneView>,
  { frames, rounds, thresholds }: Omit<Sweep, 'sizes' | 'levels'>,
) {
  const cut = await createDagResources(device, packed, true);
  if (!cut) return undefined;
  const block = new Float32Array(DAG_VIEW_WORDS);
  const setThreshold = (pixelError: number) => {
    writeDagUniforms(block, packed, { ...uniforms, pixelError }, true, cut.listCap);
    device.queue.writeBuffer(cut.uniforms, 0, block);
  };
  // The readout before the cap: the header and a rank per page, for each of its two lists.
  const worstBytes = 2 * (SELECTION_HEADER_WORDS + packed.pageCount) * 4;
  const worst = device.createBuffer({
    size: worstBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const target = device.createBuffer({
    size: Math.max(worstBytes, cut.readbackBytes),
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  /** A whole frame: the kernels, then `bytes` of `source` copied and read; the count it read. */
  const frame = async (bytes: number, source: GPUBuffer) => {
    const encoder = device.createCommandEncoder();
    encodeDagKernels(encoder, cut);
    if (bytes) encoder.copyBufferToBuffer(source, 0, target, 0, bytes);
    device.queue.submit([encoder.finish()]);
    if (!bytes) return void (await device.queue.onSubmittedWorkDone());
    await target.mapAsync(GPUMapMode.READ);
    const count = new Uint32Array(target.getMappedRange(0, bytes))[0];
    target.unmap();
    return count;
  };
  const batch = async (bytes: number, source: GPUBuffer, count: number) => {
    const start = performance.now();
    for (let i = 0; i < count; i++) await frame(bytes, source);
    return (performance.now() - start) / count;
  };
  // The cut each threshold keeps: which cap a scene of this size meets, read, never assumed.
  const kept = [];
  for (const pixelError of thresholds) {
    setThreshold(pixelError);
    kept.push({ pixelError, ranks: await frame(cut.readbackBytes, cut.output) });
  }
  // Three variants, one with no readout at all: it splits the copy's cost from the kernels'.
  const variants = [
    { name: 'kernels only', bytes: 0, source: cut.output },
    { name: 'shipped readout', bytes: cut.readbackBytes, source: cut.output },
    { name: 'catalogue-sized readout', bytes: worstBytes, source: worst },
  ];
  const times: number[][] = variants.map(() => []);
  for (let round = 0; round < rounds; round++)
    for (const [v, { bytes, source }] of variants.entries()) {
      if (!round) await batch(bytes, source, Math.max(2, frames >> 2));
      times[v].push(await batch(bytes, source, frames));
    }
  for (const buffer of [...cut.buffers, target, worst]) buffer.destroy();
  return {
    pages: packed.pageCount,
    listCap: cut.listCap,
    kept,
    deliveredBytes: cut.readbackBytes,
    worstBytes,
    variants: variants.map(({ name }, v) => ({
      name,
      ms: Number(median(times[v]).toFixed(4)),
      // The rounds' spread: a gap inside it is no gap.
      spread: Number((Math.max(...times[v]) - Math.min(...times[v])).toFixed(4)),
    })),
  };
}
