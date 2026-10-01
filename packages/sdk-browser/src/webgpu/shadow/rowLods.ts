import { transformAffinePoint } from '../../../../sdk-core/src/index.ts';
import { hypot3 } from '../../../../sdk-core/src/math/primitives/hypot.ts';
import { rootOf, type PageRec } from '../../page/selection/selection.ts';
import type { Placements } from '../../page/selection/placements.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** Floats of a row's detail: its own error's world sphere centre and error, then its parent's. */
export const ROW_LOD_FLOATS = 8;
/** The error a row with no coarser form carries as its parent's: every page wants finer. */
export const NO_PARENT = 3.4e38;

const centre = new Float32Array(3);

/** The world centre of local sphere `sphere` and its world error `error`, at `out[at]`. */
function writeError(
  out: Float32Array,
  at: number,
  e: ArrayLike<number>,
  sphere: ArrayLike<number>,
  error: number,
) {
  transformAffinePoint(centre, e, sphere[0], sphere[1], sphere[2], 0);
  out.set(centre, at);
  out[at + 3] = error;
}

/**
 * Writes row `row`'s detail (#831): the world error of its own form and of the coarser one that
 * replaces it, each at its level-of-detail sphere's world centre, as the GPU cut projects them
 * (`../../gpu/dag/shader/error.ts`): the local error, grown by the placement's deformation reach
 * past the finest level, by the placement's largest scale. The cut rule's residency is folded in
 * (`../../page/cut/rule.ts`): a row not `ready` carries a parent error of 0, so no page draws it;
 * one whose finer group is not ready (`childReady`), an own error of 0, so every page that reaches
 * it draws it. A row with no record — a blended caster's is given none — or of a cache without
 * errors is drawn by every page.
 */
export function writeRowLod(
  out: Float32Array,
  row: number,
  rec: PageRec | undefined,
  root: Placements[number] | undefined,
  ready = true,
  childReady = true,
) {
  const at = row * ROW_LOD_FLOATS;
  out.fill(0, at, at + ROW_LOD_FLOATS);
  out[at + 7] = NO_PARENT;
  if (!root || !rec?.sphere || rec.lodError === undefined) return;
  const e = root.world.elements,
    reach = 2 * (root.reach ?? 0),
    scale = Math.max(hypot3(e[0], e[1], e[2]), hypot3(e[4], e[5], e[6]), hypot3(e[8], e[9], e[10]));
  const own = rec.lodError + ((rec.level ?? 0) > 0 ? reach : 0);
  writeError(out, at, e, rec.sphere, childReady ? own * scale : 0);
  const parent = rec.parentError ?? -1;
  if (!ready) out[at + 7] = 0;
  else if (parent >= 0 && rec.parentSphere)
    writeError(out, at + 4, e, rec.parentSphere, (parent + reach) * scale);
}

/** One row's detail words per row of `casterSlots` rows, and their CPU copy. */
const rowLodBuffer = (device: GPUDevice, casterSlots: number) => ({
  buffer: device.createBuffer({
    label: 'Trillion3D shadow row detail v1',
    size: Math.max(1, casterSlots) * ROW_LOD_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  }),
  packed: new Float32Array(Math.max(1, casterSlots) * ROW_LOD_FLOATS),
  rows: casterSlots,
});

export type ShadowRowLods = ReturnType<typeof rowLodBuffer>;

/**
 * The detail of rows `[from, to]`, on the interval the mobility words follow (`bounds.ts`): the
 * rows the table rewrote, moved, or whose cut readiness moved. Every row once when the buffer is
 * made for a table of another size. What the GPU's own page draws choose each caster's level by,
 * per page (`freshCullWgsl.ts`).
 */
export function uploadRowLods(rt: WebgpuPagesRuntime, device: GPUDevice, from: number, to: number) {
  const { lights, layout } = rt,
    { rows, selectionRoots, placement } = layout,
    { casterSlots } = rows;
  if (!lights.rowLods || lights.rowLods.rows !== casterSlots) {
    lights.rowLods?.buffer.destroy();
    lights.rowLods = rowLodBuffer(device, casterSlots);
    from = 0;
    to = casterSlots - 1;
  }
  const { buffer, packed } = lights.rowLods,
    last = Math.min(to, casterSlots - 1),
    selection = rt.run.gpuSelection;
  if (last < from) return;
  for (let row = from; row <= last; row++) {
    const page = rows.packedPageIndex[row],
      rec = row < rows.blendFirst ? rows.packedRecs[row] : undefined,
      root = rec && rootOf(selectionRoots, placement.rootOfPacked[page]);
    const ready = selection?.isReady(page) ?? true,
      childReady = selection?.isChildReady(page) ?? true;
    writeRowLod(packed, row, rec, root, ready, childReady);
  }
  const first = from * ROW_LOD_FLOATS;
  device.queue.writeBuffer(buffer, first * 4, packed, first, (last - from + 1) * ROW_LOD_FLOATS);
}
