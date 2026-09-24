import { FRAME_VEC4, type DagViewUniforms, type DrawnLog } from './types.ts';
import { writeDagUniforms, type DagCutViews } from './uniforms.ts';
import { createLightCutReports } from './lightCutReports.ts';
import { encodeDagKernels, type DagView } from './encode.ts';
import { dagWorkLayout } from './shader/floorWgsl.ts';
import { LEVEL_QUEUES } from './shader/levelWgsl.ts';
import { DAG_MAX_VIEWS, DAG_UNIFORM_BYTES, DAG_VIEW_WORDS } from './shader/viewsWgsl.ts';
import type { createDagResources } from './resources.ts';

type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>;
export type DagLightCut = ReturnType<typeof createDagLightCut>;

/**
 * The same cluster cut, seen from the lights: the kernels, the pipelines, the clusters, the
 * hierarchy, the placements and the residency bits are the camera cut's, shared; only what the
 * light views write is their own — flags, working counters, per-primitive planes, output and
 * dispatch argument. A shadow view selects its casters with it exactly as the camera selects its
 * surfaces, in its own texels and against its own pages (`DagViewUniforms.light`).
 *
 * ONE traversal a frame for every view it redraws (`shader/viewsWgsl.ts`): each work item carries
 * its view, each view its uniform block and its per-primitive slots, and one set of dispatches
 * serves them all. Each view's drawn clusters land in their own range of one log, which the shadow
 * cull then reads for every view at once (`drawnLog`).
 *
 * Its escalation and pinned fallback live in its own `work`: a caster the light wants and the
 * cache lacks raises the light's threshold, never the one an object on screen is drawn at.
 *
 * Its budget is fixed at creation, whatever the views a frame runs: the lists and queues are the
 * camera cut's — each list the whole catalogue, each queue every node, or one root per slot when
 * the slots outnumber the nodes —, and the per-primitive words one row per view. What several views
 * together keep beyond the catalogue is dropped and said (`WORK_DROPPED`, `reports`). Allocated
 * once, when a scene first draws a shadow: a scene without one pays nothing.
 */
export function createDagLightCut(resources: DagResources) {
  const { device, packed, residentCut, pageCount, nodeCount, outputBytes, readbackBytes } =
    resources;
  const { worldCount, blockCount, buffers } = resources;
  const capacity = DAG_MAX_VIEWS,
    queueCap = Math.max(nodeCount, worldCount * capacity),
    layout = dagWorkLayout(blockCount, worldCount, capacity);
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const own = (descriptor: GPUBufferDescriptor) => {
    const buffer = device.createBuffer(descriptor);
    // Released with the camera cut: the runtime's dispose destroys every buffer of the list.
    buffers.push(buffer);
    return buffer;
  };
  const flags = own({
    label: 'WG light cut flags',
    size: (queueCap * LEVEL_QUEUES + pageCount * 4) * 4,
    usage: storage,
  });
  const work = own({
    label: 'WG light cut work',
    size: layout.words * 4,
    usage: storage | GPUBufferUsage.COPY_SRC,
  });
  // One row of per-primitive planes per view; the root and stretch words the kernel reads sit in
  // the first row, as the camera's frames hold them.
  const frames = own({
    label: 'WG light cut frames',
    size: capacity * worldCount * FRAME_VEC4 * 16,
    usage: storage,
  });
  device.queue.writeBuffer(frames, 0, resources.frameData);
  let frameWrites = resources.frameWrites.count;
  const output = own({
    label: 'WG light cut output',
    size: readbackBytes,
    usage: storage | GPUBufferUsage.COPY_SRC,
  });
  const dispatchArgs = own({ size: 16, usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(dispatchArgs, 0, new Uint32Array([0, 1, 1, 0]));
  const uniforms = own({
    size: DAG_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bound = [resources.clusters, resources.nodes, uniforms, flags, output, work];
  bound.push(resources.worlds, frames, resources.pageCones);
  const light = { views: 0, queueCap };
  const view: DagView = {
    ...resources,
    uniforms,
    flags,
    output,
    work,
    frames,
    dispatchArgs,
    liveGroupsOffset: layout.liveGroups * 4,
    candGroupsOffset: layout.candGroups * 4,
    drawnGroupsOffset: layout.drawnGroups * 4,
    bindGroup: device.createBindGroup({
      layout: resources.layout,
      entries: bound.map((buffer, binding) => ({ binding, resource: { buffer } })),
    }),
    repeat: null,
    light,
  };
  // Every view's drawn clusters: one log over the candidate list's words, one range per view.
  const drawnLog: DrawnLog = {
    buffer: flags,
    offset: queueCap + pageCount * 3,
    work,
    offsetWord: layout.viewWords + capacity,
    countWord: layout.viewWords + 2 * capacity,
    groupsWord: layout.drawnGroupsMax,
  };
  const uniformData = new Float32Array(DAG_UNIFORM_BYTES / 4);
  const cutViews: DagCutViews = { count: 0, capacity, queueCap };
  const reports = createLightCutReports(own, output, outputBytes);
  return {
    /** Catalogue pages the logs index. */
    pageCount,
    /** Where the mask kernel logs the pages each view draws: what the shadow cull reads. */
    drawnLog,
    /** Encodes the frame's cut: the first `count` of `views`, in one traversal. */
    encode(
      encoder: GPUCommandEncoder,
      views: ArrayLike<{ uniforms: DagViewUniforms }>,
      count: number,
    ) {
      if (count > capacity) throw new Error(`${count} light views, at most ${capacity}`);
      cutViews.count = light.views = count;
      for (let v = 0; v < count; v++) {
        const block = uniformData.subarray(v * DAG_VIEW_WORDS, (v + 1) * DAG_VIEW_WORDS);
        writeDagUniforms(block, packed, views[v].uniforms, residentCut, cutViews);
      }
      device.queue.writeBuffer(uniforms, 0, uniformData, 0, count * DAG_VIEW_WORDS);
      // A placement's stretch or a parked root changed on the camera's side: the first row follows.
      if (frameWrites !== resources.frameWrites.count) {
        frameWrites = resources.frameWrites.count;
        encoder.copyBufferToBuffer(resources.frames, 0, frames, 0, resources.frameData.byteLength);
      }
      encodeDagKernels(encoder, view);
    },
    /** Its requests and drops, read back after submission (`lightCutReports.ts`). */
    reports,
  };
}
