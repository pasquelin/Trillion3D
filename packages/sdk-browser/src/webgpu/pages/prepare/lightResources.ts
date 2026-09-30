import { FLAG_BLEND_CASTER, FLAG_MASK, PAGE_INFO_STRIDE } from '../../../visibility/buffer.ts';
import type { PageRec } from '../../../page/selection/selection.ts';
import type { Placements } from '../../../page/selection/placements.ts';
import type { PageSurface } from '../../../page/surface.ts';
import { ROW_FLAGS_WORD, ROW_MAP_LAYER_WORD } from '../../row/pageRow.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { WebgpuLightState } from '../state/lights.ts';
import { boxEmpty, boxIsEmpty } from '../../../../../sdk-core/src/index.ts';
import { changeBoxes, growClusterBox, recordMoves } from '../../shadow/bounds.ts';

const EVERYWHERE_MIN = [-1e30, -1e30, -1e30],
  EVERYWHERE_MAX = [1e30, 1e30, 1e30];
const ROW_WORDS = PAGE_INFO_STRIDE / 4;
/** The rows whose shadow reads their colour map's alpha: a cutout's, and a blended caster's. */
const ALPHA_READERS = FLAG_MASK | FLAG_BLEND_CASTER;

/** The page-table rows the invalidation reads: their words, and the record each row draws. */
interface ShadowRowTable {
  rowCount: number;
  /** The blended casters' rows, `[blendFirst, casterSlots)`. */
  blendFirst: number;
  casterSlots: number;
  pageTableInts: Uint32Array | undefined;
  packedRecs: ArrayLike<PageRec | undefined>;
  /** The packed rank each row draws (#1235): a row's root is read from it. */
  packedPageIndex: ArrayLike<number>;
}

/**
 * Colour tiles of textures `slots` are resident, or have left: the alpha cutout the shadow pass
 * reads has just changed for every masked surface that carries one of these textures — and the
 * coverage of every blended caster that does (`../../../gpu/shadow/transmittance.ts`) —, and a
 * map drawn at the previous level would describe foliage that is no longer the image's. The
 * pages the world box of those surfaces covers go back to waiting once the camera rests, under
 * the ordinary Shadows stage budget — and those alone: a colour tile of a texture no cutout
 * reads changes no depth, and stales nothing. One scan of the page table per pump, whatever
 * the tiles served. At `-1` the pool changed without naming a texture — a resize — and every
 * page restarts. Without this signal, two identical runs produced two different shadows,
 * depending on when each page had been drawn.
 */
export function shadowsFollowTextures(
  lights: WebgpuLightState,
  rows: ShadowRowTable,
  roots: Placements,
  rootOfPacked: Int32Array,
  slots: ReadonlySet<number> | -1,
) {
  if (!lights.store.count) return;
  if (slots === -1) {
    lights.plan.representationChanged(EVERYWHERE_MIN, EVERYWHERE_MAX);
    return;
  }
  const ints = rows.pageTableInts;
  if (!ints || !slots.size) return;
  shadowsFollowRows(lights, rows, roots, rootOfPacked, (row) => {
    const base = row * ROW_WORDS;
    return (
      !!(ints[base + ROW_FLAGS_WORD] & ALPHA_READERS) && slots.has(ints[base + ROW_MAP_LAYER_WORD])
    );
  });
}

/**
 * Surfaces whose alpha mode or cutoff a page changed (#846): the depth their rows cast is no longer
 * the one drawn, whether they cut it before or not: the shadow pages over those rows alone are drawn
 * again at once, as a node shown or hidden is (`../render/worldUpload.ts`), not when the camera rests.
 */
export function shadowsFollowSurfaces(
  lights: WebgpuLightState,
  rows: ShadowRowTable,
  roots: Placements,
  rootOfPacked: Int32Array,
  surfaces: ReadonlySet<PageSurface>,
) {
  if (lights.store.count)
    shadowsFollowRows(
      lights,
      rows,
      roots,
      rootOfPacked,
      (row) => surfaces.has(rows.packedRecs[row]?.material as PageSurface),
      'worldChanged',
    );
}

/**
 * Stales the box of the rows, visibility then blended casters, that `stale` names, as the same
 * world at another precision or, `worldChanged`, as another world: one box for the rows the static
 * layer holds, one for the rows already moving — a blended caster's always is —, whose change
 * redraws the moving casters alone and leaves the static layer as it is (#993).
 */
function shadowsFollowRows(
  lights: WebgpuLightState,
  rows: ShadowRowTable,
  roots: Placements,
  rootOfPacked: Int32Array,
  stale: (row: number) => boolean,
  change: 'representationChanged' | 'worldChanged' = 'representationChanged',
) {
  for (const { box } of changeBoxes) boxEmpty(box, 0);
  for (const [from, to] of [
    [0, rows.rowCount],
    [rows.blendFirst, rows.casterSlots],
  ])
    for (let row = from; row < to; row++) {
      const rec = stale(row) && rows.packedRecs[row];
      if (!rec) continue;
      const rank = rootOfPacked[rows.packedPageIndex[row]] ?? -1;
      const moving = row >= rows.blendFirst || recordMoves(lights, rank);
      growClusterBox(rec, roots, changeBoxes[+moving].box, rank);
    }
  for (const moving of [false, true]) {
    const { box, min, max } = changeBoxes[+moving];
    if (!boxIsEmpty(box, 0)) lights.plan[change](min, max, moving);
  }
}

/**
 * The threshold the light cuts select casters at: the camera's, in the render frame of the eye
 * `origin`. The plan keeps the ones each page was drawn at, and redraws, once the camera rests,
 * only the pages drawn at another (`thresholds.ts`). Returns the threshold.
 */
export function followLightThreshold(
  lights: WebgpuLightState,
  pixelError: number,
  origin: ArrayLike<number>,
) {
  lights.plan.setThreshold(pixelError, origin);
  return pixelError;
}

/**
 * Serves tiles requested by the previous image, except during a pose barrier: the shadow
 * drain replays the image without admitting new ones. An arriving tile invalidates every
 * map (`shadowsFollowTextures`) and the queue would never empty (#25). Returns the tiles served.
 */
export function pumpResidentTiles(
  textures: { pump: (frame: number) => { served: number } } | undefined,
  frame: number,
  converging: boolean,
) {
  return (!converging && textures?.pump(frame).served) || 0;
}

export {
  compilingContract,
  directLightResources,
  readsAsIs,
  wantsContractLighting,
} from './contractLight.ts';

/** An occlusion test made while a growth was granted holds the cull's old lists: it follows. */
export function followOcclusion(rt: WebgpuPagesRuntime) {
  const { cull, occlusion } = rt.lights;
  if (cull && occlusion && occlusion.visible.size !== cull.kept.size)
    occlusion.grow(rt.layout.rows.casterSlots).commit();
}
