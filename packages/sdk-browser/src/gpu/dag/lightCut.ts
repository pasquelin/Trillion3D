import { SELECTION_UNIFORM_BYTES } from '../core/selection.ts';
import type { DagViewUniforms } from './types.ts';
import { createDagOutputScratch, parseDagOutput, writeDagUniforms } from './uniforms.ts';
import { encodeDagKernels, type DagView } from './encode.ts';
import type { createDagResources } from './resources.ts';

type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>;
export type DagLightCut = ReturnType<typeof createDagLightCut>;

/**
 * The same cluster cut, seen from a light: the kernels, the pipelines, the clusters, the
 * hierarchy, the placements and the residency bits are the camera cut's, shared; only what one
 * view writes is its own — draw flags, working counters, output and dispatch argument. A shadow
 * face selects its casters with it exactly as the camera selects its surfaces, in its own texels
 * and against its own pages (`DagViewUniforms.light`).
 *
 * Its escalation and its pinned fallback live in its own `work`: a caster the light wants and
 * the cache lacks can raise the light's threshold, never the one an object on screen is drawn at.
 *
 * A frame runs it once per redrawn face, one after the other in the same command buffer, each
 * run's result consumed before the next begins. The uniforms of each run are written before the
 * buffer is submitted, so each run has its own uniform block — `runs` of them, the most faces a
 * frame redraws. Its requests accumulate over the frame's runs (`VIEW_APPEND`) and come back in
 * one readback. Allocated once, when a scene first draws a shadow: a scene without one pays nothing.
 */
export function createDagLightCut(resources: DagResources, runs: number) {
  const { device, packed, residentCut, nodeCount, outputBytes, readbackBytes, buffers } = resources;
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const own = (descriptor: GPUBufferDescriptor) => {
    const buffer = device.createBuffer(descriptor);
    // Released with the camera cut: the runtime's dispose destroys every buffer of the list.
    buffers.push(buffer);
    return buffer;
  };
  const flags = own({ label: 'WG light cut flags', size: resources.flags.size, usage: storage });
  const work = own({
    label: 'WG light cut work',
    size: resources.work.size,
    usage: storage | GPUBufferUsage.COPY_SRC,
  });
  const output = own({
    label: 'WG light cut output',
    size: readbackBytes,
    usage: storage | GPUBufferUsage.COPY_SRC,
  });
  const dispatchArgs = own({ size: 16, usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(dispatchArgs, 0, new Uint32Array([0, 1, 1, 0]));
  const readback = own({
    size: outputBytes,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const uniformData = new Float32Array(SELECTION_UNIFORM_BYTES / 4);
  const views: DagView[] = [];
  for (let run = 0; run < runs; run++) {
    const uniforms = own({
      size: SELECTION_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bound = [resources.clusters, resources.nodes, uniforms, flags, output, work];
    bound.push(resources.worlds, resources.frames, resources.pageCones);
    const bindGroup = device.createBindGroup({
      layout: resources.layout,
      entries: bound.map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    views.push({
      ...resources,
      uniforms,
      flags,
      output,
      work,
      dispatchArgs,
      bindGroup,
      repeat: null,
      drawnList: false,
    });
  }
  const scratch = createDagOutputScratch();
  let mapped = false,
    requests: readonly number[] | null = null;
  return {
    runs,
    /** Where `dagMask` leaves the light's draw flags: what the light compaction reads. */
    maskBuffer: flags,
    maskOffset: nodeCount,
    /** Encodes run `run` of the frame; the first run of a frame starts the request list over. */
    encode(encoder: GPUCommandEncoder, run: number, uniforms: DagViewUniforms) {
      const view = views[run];
      writeDagUniforms(uniformData, packed, uniforms, residentCut, run > 0);
      device.queue.writeBuffer(view.uniforms, 0, uniformData);
      encodeDagKernels(encoder, view);
    },
    /**
     * Copies the frame's requests for the host, unless the previous copy is still being read.
     * Returns the settlement to call once the command buffer is submitted, or dropped.
     */
    encodeReadback(encoder: GPUCommandEncoder) {
      if (mapped) return undefined;
      mapped = true;
      encoder.copyBufferToBuffer(output, 0, readback, 0, outputBytes);
      return (submitted: boolean) => {
        if (!submitted) {
          mapped = false;
          return;
        }
        readback
          .mapAsync(GPUMapMode.READ)
          .then(() => {
            const bytes = readback.getMappedRange();
            const parsed = parseDagOutput(bytes, 0, bytes.byteLength, 0, scratch);
            requests = parsed ? parsed.pageIds.slice() : null;
            readback.unmap();
          })
          .catch(() => {})
          .finally(() => {
            mapped = false;
          });
      };
    },
    /** The pages the last read frame's light cuts asked for, highest priority first. */
    takeRequests() {
      const taken = requests;
      requests = null;
      return taken;
    },
  };
}
