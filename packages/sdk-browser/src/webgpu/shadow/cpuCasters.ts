import { invertMatrix4, updateCameraFrame } from '../../../../sdk-core/src/index.ts';
import { createEngineCamera, type EngineCamera } from '../../camera/world.ts';
import { selectVisiblePages, type PageRec } from '../../page/selection/selection.ts';
import { createSelectionResult } from '../../page/cut/state.ts';
import { MAX_SHADOW_RUNS } from '../../gpu/shadow/batchBudget.ts';
import { planImageShadows } from '../pages/render/encodeShadows.ts';
import { forEachShadowBatch } from '../pages/render/encodeShadowBatches.ts';
import { writeShadowPages } from './pages.ts';
import type { ShadowRun } from './runs.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/**
 * The CPU cut's shadow casters: each redrawn face's pages, every batch's, then the same as
 * page-table rows at their own place in one buffer, with one indirect command per face. Allocated
 * at the first CPU light cut, sized by the catalogue; the per-face offsets, lengths and commands
 * hold the faces of the most batches a frame draws (`MAX_SHADOW_RUNS`, `batchBudget.ts`) from the
 * start and never grow. The rows' buffer grows to the next power of two a frame needs.
 */
export type CpuCasterLists = ReturnType<typeof createCpuCasterLists>;

/** Usage of the lists' buffers, read when one is made: the GPU globals exist only then. */
const storage = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;

export function createCpuCasterLists(device: GPUDevice, pageCount: number) {
  return {
    frame: -1,
    /** Faces of every batch of the frame, together. */
    runs: 0,
    source: device.createBuffer({
      label: 'Trillion3D CPU light casters',
      size: 4,
      usage: storage(),
    }),
    indirect: device.createBuffer({ size: MAX_SHADOW_RUNS * 16, usage: storage() }),
    bases: new Uint32Array(MAX_SHADOW_RUNS),
    lengths: new Uint32Array(MAX_SHADOW_RUNS),
    commands: new Uint32Array(MAX_SHADOW_RUNS * 4),
    words: new Uint32Array(1),
    shown: [] as PageRec[][],
    wanted: [] as PageRec[][],
    casters: [] as PageRec[],
    /** Per catalogue page: the frame that last marked it, and its row that frame. */
    marks: new Uint32Array(pageCount),
    rowOf: new Int32Array(pageCount),
    result: createSelectionResult<PageRec>(),
    camera: createEngineCamera(),
    viewport: [1, 1] as [number, number],
  };
}

/**
 * The face as a camera the CPU cut reads: its world pose, the projection cropped to the region,
 * no far plane beyond the projection's own. The viewport makes the cut's pixel scale the face's
 * texel scale: its error is counted in the map's texels, as the GPU light cut counts it.
 */
export function faceEngineCamera(run: ShadowRun, into: EngineCamera, viewport: number[]) {
  const { face } = run;
  invertMatrix4(into.world, face.worldView);
  into.projection.set(face.clip);
  updateCameraFrame(into, into.projection, into.world, Infinity);
  // An orthography weighs no depth against its near plane (clip w is 1): the CPU cut only asks
  // for a positive one, and the smallest leaves every error as the GPU computes it.
  into.near = face.perspective ? face.near : Number.MIN_VALUE;
  into.far = Infinity;
  into.perspective = face.perspective;
  for (let a = 0; a < 3; a++) into.eye[a] = into.world[12 + a];
  viewport[0] = (2 * face.focal) / Math.abs(face.clip[0]);
  viewport[1] = (2 * face.focal) / Math.abs(face.clip[5]);
  return into;
}

/** A list of casters for each of `runs` faces: never more than `MAX_SHADOW_RUNS`, what the
 *  offsets and commands hold. */
function holdRuns(lists: CpuCasterLists, runs: number) {
  if (runs > MAX_SHADOW_RUNS) throw new Error(`${runs} shadow faces, at most ${MAX_SHADOW_RUNS}`);
  while (lists.shown.length < runs) {
    lists.shown.push([]);
    lists.wanted.push([]);
  }
}

/**
 * Under the CPU cut, the casters of each redrawn face — every batch's the frame draws — are
 * selected FROM THE LIGHT by that same cut: the face's view, its texels, its redrawn pages,
 * residency held, the cone off. Returns the pages none of the camera's rows already draws — they
 * take rows behind the camera's — and hands what the faces asked for to the lower residency tier.
 */
export function selectCpuCasters(rt: WebgpuPagesRuntime, device: GPUDevice, cam: EngineCamera) {
  const { lights, run, services, layout } = rt,
    { runs } = lights,
    { rows } = layout;
  if (!lights.cull || !planImageShadows(rt, cam)) return undefined;
  const pageCount = rows.residentOffsetWords.length;
  if (!lights.cpuCasters || lights.cpuCasters.marks.length !== pageCount) {
    lights.cpuCasters?.source.destroy();
    lights.cpuCasters?.indirect.destroy();
    lights.cpuCasters = createCpuCasterLists(device, pageCount);
  }
  const lists = lights.cpuCasters,
    { casters, marks, shown, wanted, camera, viewport } = lists;
  casters.length = 0;
  const stamp = run.frame >>> 0 || 1;
  for (const rec of run.drawn) {
    const page = rows.pageIndexOf(rec);
    if (page !== undefined) marks[page] = stamp;
  }
  lists.runs = 0;
  forEachShadowBatch(rt, (from, to, runBase) => {
    writeShadowPages(lights, lights.shadowSlots, cam.eye, lights.shadowPixelError, from, to);
    holdRuns(lists, (lists.runs = runBase + runs.count));
    for (let r = 0; r < runs.count; r++) {
      const face = runs.list[r],
        at = runBase + r;
      selectVisiblePages(
        rt.setup.roots,
        faceEngineCamera(face, camera, viewport),
        {
          pixelError: face.uniforms.pixelError,
          viewport,
          holdResident: true,
          isResident: services.poolHolds,
          wanted: wanted[at],
          result: lists.result,
          light: face.pages,
        },
        shown[at],
      );
      for (const rec of shown[at]) {
        const page = rows.pageIndexOf(rec);
        if (page === undefined || marks[page] === stamp) continue;
        marks[page] = stamp;
        casters.push(rec);
      }
    }
    return true;
  });
  services.shadowTier.offerPages(wanted, lists.runs);
  return casters;
}

/**
 * Once the rows are written: each face's casters as rows, one after the other in one buffer,
 * and one indirect command per face that says how many — what the region cull reads. A blended
 * cluster the face keeps is listed at its caster row.
 */
export function writeCpuCasters(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { lights, run, layout } = rt,
    { rows } = layout,
    lists = lights.cpuCasters;
  if (!lists || lights.plannedFrame !== run.frame || !lists.runs) return;
  const { marks, rowOf, shown, commands } = lists;
  // A second stamp, after the selection's: this frame's rows, by catalogue page.
  const stamp = ~run.frame >>> 0 || 1;
  for (let row = 0; row < rows.packedCount; row++) {
    const page = rows.packedPageIndex[row];
    rowOf[page] = row;
    marks[page] = stamp;
  }
  let total = 0;
  for (let r = 0; r < lists.runs; r++) total += shown[r].length;
  if (lists.words.length < total) {
    lists.words = new Uint32Array(1 << Math.ceil(Math.log2(total)));
    lists.source.destroy();
    lists.source = device.createBuffer({
      label: 'Trillion3D CPU light casters',
      size: lists.words.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }
  const { words } = lists;
  let at = 0;
  for (let r = 0; r < lists.runs; r++) {
    lists.bases[r] = at;
    for (const rec of shown[r]) {
      const page = rows.pageIndexOf(rec);
      if (page === undefined) continue;
      // A blended cluster casts from its own row, behind the table (`../row/blendCasters.ts`).
      if (marks[page] === stamp) words[at++] = rowOf[page];
      else if (rows.blendRowOf[page] >= 0) words[at++] = rows.blendRowOf[page];
    }
    lists.lengths[r] = at - lists.bases[r];
    commands[r * 4 + 1] = lists.lengths[r];
  }
  if (at) device.queue.writeBuffer(lists.source, 0, words, 0, at);
  device.queue.writeBuffer(lists.indirect, 0, commands, 0, lists.runs * 4);
  lists.frame = run.frame;
}
