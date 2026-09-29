import { DRAW_INDIRECT_WORDS } from '../../gpu/draw/contract.ts';
import { invertMatrix4, updateCameraFrame } from '../../../../sdk-core/src/index.ts';
import { createEngineCamera, type EngineCamera } from '../../camera/world.ts';
import { selectVisiblePages, type PageRec } from '../../page/selection/selection.ts';
import { createSelectionResult } from '../../page/cut/state.ts';
import { MAX_SHADOW_RUNS } from '../../gpu/shadow/batchBudget.ts';
import { DRAW_INDIRECT_STRIDE } from '../../gpu/draw/contract.ts';
import { planImageShadows } from '../pages/render/encodeShadows.ts';
import { forEachShadowBatch } from '../pages/render/encodeShadowBatches.ts';
import { writeShadowPages } from './pages.ts';
import type { ShadowRun } from './runs.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** The casters' rows, written from the packed ranks this cut publishes (`./cpuCasterRows.ts`). */
export { writeCpuCasters } from './cpuCasterRows.ts';

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
    indirect: device.createBuffer({
      size: MAX_SHADOW_RUNS * DRAW_INDIRECT_STRIDE,
      usage: storage(),
    }),
    bases: new Uint32Array(MAX_SHADOW_RUNS),
    lengths: new Uint32Array(MAX_SHADOW_RUNS),
    commands: new Uint32Array(MAX_SHADOW_RUNS * DRAW_INDIRECT_WORDS),
    words: new Uint32Array(1),
    /** The cut's record scratch per face, and the packed ranks it publishes beside them. */
    shown: [] as PageRec[][],
    wanted: [] as PageRec[][],
    shownPacked: [] as number[][],
    wantedPacked: [] as number[][],
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
    lists.shownPacked.push([]);
    lists.wantedPacked.push([]);
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
    { casters, marks, shown, wanted, shownPacked, wantedPacked, camera, viewport } = lists,
    recordOf = layout.recordOf;
  casters.length = 0;
  const stamp = run.frame >>> 0 || 1;
  for (const rec of run.drawn) {
    const page = rows.pageIndexOf(rec);
    if (page !== undefined) marks[page] = stamp;
  }
  lists.runs = 0;
  // Nothing loads or leaves while the faces select — what they want is offered after the last —:
  // the cache's changes reach the cut's residency once, before the first.
  services.syncResidency();
  forEachShadowBatch(rt, (from, to, runBase) => {
    writeShadowPages(lights, cam.eye, from, to);
    lists.runs = runBase + runs.count;
    holdRuns(lists, lists.runs);
    for (let r = 0; r < runs.count; r++) {
      const face = runs.list[r],
        at = runBase + r;
      const selected = selectVisiblePages(
        rt.setup.roots,
        faceEngineCamera(face, camera, viewport),
        {
          pixelError: face.uniforms.pixelError,
          viewport,
          held: services.heldResidency,
          wanted: wanted[at],
          result: lists.result,
          light: face.pages,
        },
        shown[at],
      );
      // The face keeps its WHOLE cut by rank (`kept`, parallel to `shown[at]`): the caster buffer
      // `writeCpuCasters` fills draws every one of them. `casters` holds only the pages no row
      // already draws — the extras `syncRowsFromCut` gives shadow-only rows to.
      const ids = selected.shownPacked,
        kept = shownPacked[at];
      kept.length = 0;
      for (let k = 0; k < ids.length; k++) {
        const page = ids[k];
        if (page < 0) continue;
        kept.push(page);
        if (marks[page] === stamp) continue;
        marks[page] = stamp;
        const rec = recordOf(page);
        if (rec) casters.push(rec);
      }
      const asked = selected.wantedPacked,
        wantedIds = wantedPacked[at];
      wantedIds.length = 0;
      for (let k = 0; k < asked.length; k++) wantedIds.push(asked[k]);
    }
    return true;
  });
  services.shadowTier.offerPages(wantedPacked, lists.runs);
  return casters;
}
