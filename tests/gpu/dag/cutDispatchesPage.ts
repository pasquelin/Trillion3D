// The engine's real cut — `createDagResources` and `encodeDagKernels` — against the cut from before
// the single-pass descent, frozen in `bench/oracles/browser/cut-dispatches.ts`. The shipped side is
// never rewritten: a hand-copied encoder would measure the copy.
//
// What the GPU pays between two kernels is counted in commands, not threads: each compute pass and
// each copy outside a pass closes an encoder and opens another. So a frame's whole sequence is
// measured, never one kernel, and the variants alternate so thermal drift falls on both.
import { createDagResources } from '../../../packages/sdk-browser/src/gpu/dag/resources.ts';
import { encodeDagKernels } from '../../../packages/sdk-browser/src/gpu/dag/encode.ts';
import { DAG_VIEW_WORDS } from '../../../packages/sdk-browser/src/gpu/dag/shader/viewsWgsl.ts';
import { writeDagUniforms } from '../../../packages/sdk-browser/src/gpu/dag/uniforms.ts';
import { SELECTION_HEADER_WORDS } from '../../../packages/sdk-browser/src/gpu/dag/layout.ts';
import { encodeBefore, resourcesBefore } from '../../../bench/oracles/browser/cut-dispatches.ts';
import { DAG_SELECTION_SHADER_BEFORE } from '../../../bench/oracles/browser/cut-dispatches-wgsl.ts';
import { median } from '../../../scripts/median.ts';
import { openGpuDevice } from '../kit/webgpuDevice.ts';
import { countCommands, sceneView } from './cutScene.ts';

export interface DispatchSweep {
  leaves: number;
  levels: number;
  /** Depths past the scene's own: empty tiers whose commands are still opened. */
  depths: number[];
  frames: number;
  rounds: number;
  /** Tier widths each level is launched flat over, the scene unchanged. */
  bounds: number[];
}

type Timing = { encode: number; total: number };

export async function measureDispatches(sweep: DispatchSweep) {
  const gpu = await openGpuDevice();
  if (!gpu) throw new Error('WebGPU must be available');
  const { device } = gpu;
  const { packed, uniforms } = sceneView(sweep.leaves, sweep.levels);
  const shipped = await createDagResources(device, packed, true);
  if (!shipped) throw new Error('the shipped cut does not mount');
  const { module, compilation } = await gpu.compile(DAG_SELECTION_SHADER_BEFORE);
  if (compilation.length) throw new Error(`the frozen cut does not compile: ${compilation}`);
  // The oracle reads the fields `packed` carries under its own, private, shape.
  const before = resourcesBefore(
    device,
    module,
    shipped.layout,
    packed as unknown as Parameters<typeof resourcesBefore>[3],
  );
  const block = new Float32Array(DAG_VIEW_WORDS);
  writeDagUniforms(block, packed, uniforms, true, shipped.listCap);
  device.queue.writeBuffer(shipped.uniforms, 0, block);
  device.queue.writeBuffer(before.uniforms, 0, block);

  const target = device.createBuffer({
    size: shipped.readbackBytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  /** The wanted and the drawn pages an output holds, bit for bit. */
  const read = async (output: GPUBuffer) => {
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(output, 0, target, 0, shipped.readbackBytes);
    device.queue.submit([encoder.finish()]);
    await target.mapAsync(GPUMapMode.READ);
    const words = new Uint32Array(target.getMappedRange().slice(0));
    target.unmap();
    const list = (at: number) =>
      Array.from(
        words.subarray(
          at + SELECTION_HEADER_WORDS,
          at + SELECTION_HEADER_WORDS + Math.min(words[at], packed.pageCount),
        ),
      );
    return {
      pages: list(0).sort((a, b) => a - b),
      drawn: list(shipped.outputBytes / 4),
      frustumRejected: words[1],
      overflow: words[3],
    };
  };
  /** A batch of frames, and the two times kept apart: what the CPU spends writing commands, and
   *  what is still waited once the last is submitted. */
  const batch = async (encode: (encoder: GPUCommandEncoder) => void, count: number) => {
    const start = performance.now();
    for (let i = 0; i < count; i++) {
      const encoder = device.createCommandEncoder();
      encode(encoder);
      device.queue.submit([encoder.finish()]);
    }
    const written = performance.now();
    await device.queue.onSubmittedWorkDone();
    return { encode: (written - start) / count, total: (performance.now() - start) / count };
  };
  // Tiers the shipped descent launches flat: widened, they change no verdict — the extra threads
  // exit on the count guard — and give the depth asked.
  const tiers = (depth: number, width: number) =>
    Uint32Array.from({ length: depth }, (_, l) =>
      l < packed.levelSizes.length ? Math.max(packed.levelSizes[l], width) : width,
    );
  const variants = [
    {
      output: before.output,
      encode: (e: GPUCommandEncoder, d: number) => encodeBefore(e, before, d),
    },
    {
      output: shipped.output,
      encode: (e: GPUCommandEncoder, d: number) =>
        encodeDagKernels(e, { ...shipped, levelSizes: tiers(d, 0) }),
    },
  ];
  const depths = [packed.levelSizes.length, ...sweep.depths];
  const commands = variants.map((v) => depths.map((d) => countCommands((e) => v.encode(e, d))));
  const timings: Timing[][][] = variants.map(() => depths.map(() => []));
  for (let round = 0; round < sweep.rounds; round++)
    for (const [v, variant] of variants.entries())
      for (const [k, depth] of depths.entries()) {
        const encode = (e: GPUCommandEncoder) => variant.encode(e, depth);
        await batch(encode, Math.max(2, sweep.frames >> 2));
        timings[v][k].push(await batch(encode, sweep.frames));
      }
  const outputs = [];
  for (const variant of variants) {
    await batch((e) => variant.encode(e, packed.levelSizes.length), 1);
    outputs.push(await read(variant.output));
  }
  // The guardrail: the shipped descent launched over ever-wider tiers, the scene unchanged.
  const bounds = [];
  for (const width of sweep.bounds) {
    const encode = (e: GPUCommandEncoder) =>
      encodeDagKernels(e, { ...shipped, levelSizes: tiers(packed.levelSizes.length, width) });
    await batch(encode, Math.max(2, sweep.frames >> 2));
    const totals = [];
    for (let round = 0; round < sweep.rounds; round++)
      totals.push((await batch(encode, sweep.frames)).total);
    bounds.push({
      width,
      ms: Number(median(totals).toFixed(4)),
      output: await read(shipped.output),
    });
  }
  const { court: adapter } = await gpu.fermer();
  const ms = (list: Timing[], field: keyof Timing) =>
    Number(median(list.map((t) => t[field])).toFixed(4));
  return {
    adapter,
    errors: gpu.errors,
    pages: packed.pageCount,
    nodes: packed.nodeCount,
    sceneDepth: packed.levelSizes.length,
    depths,
    outputs,
    bounds,
    rows: depths.map((depth, k) => ({
      depth,
      commands: commands.map((byDepth) => byDepth[k].passes + byDepth[k].copies),
      msTotal: timings.map((byDepth) => ms(byDepth[k], 'total')),
      msEncode: timings.map((byDepth) => ms(byDepth[k], 'encode')),
    })),
  };
}
