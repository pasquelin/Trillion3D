import { LIGHT_KIND, LIGHT_SETTINGS, MAX_SHADOW_SLICES, POINT_FACES } from '../light/contracts.ts';

/**
 * THE VIRTUAL LAYOUT OF SHADOW MAPS: what a page of each light is, and where its word sits in
 * the page table. The formulas that address a page — shared by the scheduler and the shaders —
 * are the page model's (`pageModel.ts`).
 *
 * - A **sun** has `SUN_LEVELS` clipmap levels. Level `L` has texels of `2^L` metres and an extent
 *   of `SUN_WINDOW²` pages around the camera, addressed by absolute page modulo the extent — a
 *   ring: a camera step keeps every page that stays inside. The level itself sits in slot
 *   `L mod SUN_LEVELS`, a ring too, so a change of the finest level keeps the others.
 * - A **lamp** face — six for a point, one for a spot — is a map of `LAMP_SIDE²` pages at its
 *   finest mip, with every coarser mip down to one page.
 *
 * The physical pool is the one size here that depends on the world: `shadowPoolSize`.
 */
/** Side of a shadow page, in texels: the unit of the pool, of the virtual maps and of invalidation. */
export const SHADOW_PAGE: number = LIGHT_SETTINGS.shadowPage;
/** Pages per side of a lamp face's finest mip. */
export const LAMP_SIDE = Math.floor(LIGHT_SETTINGS.lampFaceSize / SHADOW_PAGE);
export const SUN_LEVELS: number = LIGHT_SETTINGS.sunLevels;
export const SUN_WINDOW: number = LIGHT_SETTINGS.sunLevelPages;
/** Mips of a lamp face, from `LAMP_SIDE` pages per side down to one. */
export const LAMP_MIPS = Math.log2(LAMP_SIDE) + 1;
/** Pages a side of a sun's `2W × 2H` texel rectangle: one per `P / 2` screen pixels. */
const tiles = (pixels: number) => Math.ceil((2 * Math.max(1, pixels)) / SHADOW_PAGE);
/** The pool the first frame asks for `lights` shadowed lights, each read over the whole smooth
 *  `w × h` screen — its texel rectangle, and a third more while pages wait —, twice: the report
 *  the pool holds and the next one, which a turn of the camera may renew in full. */
export const priorPoolPages = (w: number, h: number, lights: number) =>
  2 * lights * Math.ceil((4 * tiles(w) * tiles(h)) / 3);
/**
 * Physical pages of the shadow pool, for a `width × height` screen and its `lights` shadowed
 * lights: a fixed budget, derived once from the screen the first
 * frame draws, never read off the machine.
 *
 * What one frame reads. A pixel reads ONE sun level — the one whose texel is at most its
 * footprint and more than half of it — around one point, the PCF taps a few texels wide. A page
 * of that level is `P` texels, so more than `P / 2` of the footprints that read it: a tile of
 * `P / 2 × P / 2` screen pixels lying on one surface lands in light space inside `P × P` texels —
 * projection on the light's plane never lengthens a distance — and reads at most the 2 × 2 pages
 * such a square straddles, its PCF border included: four pages a tile. A pixel whose page is not
 * drawn yet reads — and asks for — the next coarser level instead, whose pages each cover four of
 * the finer: while pages wait, the requests grow by at most a quarter, a sixteenth, … — a third.
 * So a frame asks for at most `⁴⁄₃ · 4 · ⌈2W / P⌉ · ⌈2H / P⌉` pages.
 *
 * That bound is exact for a tile on one surface at one level, and loose everywhere else by the
 * same count: two tiles side by side on one floor share their pages, so a smooth screen reads a
 * quarter of it (a `2W × 2H` texel rectangle). What a tile loses at an edge — a level switch, a
 * silhouette whose two sides read two places of the map — its smooth neighbours leave free.
 * Named approximation: a screen where most tiles straddle an edge (dense foliage) can read more;
 * the pages past the pool wait a frame, read at the coarser level meanwhile.
 *
 * The request that asks for a frame's pages comes back a frame later, and the pages the latest
 * report named are never taken (`pool.ts`): the pool holds that report's pages and the next
 * report's — twice a frame's read (`priorPoolPages`). The static layer mirrors the pool page for
 * page (`gpu/shadow/staticLayer.ts`), so it adds bytes, never pages.
 *
 * The pool holds the worst-case bound while it fits one layer, and the smooth read of every
 * shadowed light past it. At 1280 × 720: 20 × 12 tiles, 1 280 pages a frame at worst, 2 560 held —
 * 51 × 51 pages, a 6 528² depth texture of 163 MiB. At 3 456 × 2 234 with one sun: 54 × 35 tiles,
 * 2 520 pages a frame, 5 040 held — one layer of 71 × 71 pages on a device 16 384 texels wide,
 * two of 51 × 51 on one of 8 192. The only limits are the device's and the memory grant
 * (`webgpu/shadow/poolSize.ts`).
 */
export function shadowPoolSize(width: number, height: number, lights = 1) {
  const worst = 2 * Math.ceil((4 * 4 * tiles(width) * tiles(height)) / 3);
  return Math.max(Math.min(worst, LAYER_PAGES), priorPoolPages(width, height, lights));
}
/** Entries a request report lists, for a pool of `pages`: never fewer than the pool holds — a full
 *  list names every page the pool can keep. */
export const shadowRequestCap = (pages: number) => Math.max(LIGHT_SETTINGS.shadowRequestCap, pages);
/** Entries of one lamp face (every mip). */
export const LAMP_FACE_ENTRIES = (() => {
  let total = 0;
  for (let mip = 0; mip < LAMP_MIPS; mip++) total += (LAMP_SIDE >> mip) ** 2;
  return total;
})();
/** The extent is a session's, not the module's: a reference session raises it so every pixel of a
 *  wide view reads the finest clipmap level (`referenceMode.ts`), an ordinary one keeps the
 *  constant. Every size an extent implies is a function of its pages, the constant the default. */
export const sunLevelEntries = (pages: number) => pages * pages;
export const sunEntries = (pages: number) => SUN_LEVELS * sunLevelEntries(pages);
/** Words of the page table each slice owns: the largest range a light needs, a whole sun or a
 *  point light's six faces — so a slice of any kind always finds its span. */
export const shadowTableStride = (pages: number) =>
  Math.max(sunEntries(pages), POINT_FACES * LAMP_FACE_ENTRIES);
/** Words of the whole page table: one span per shadow slice, one slice per light. */
export const shadowTableEntries = (pages: number) => MAX_SHADOW_SLICES * shadowTableStride(pages);
export const SUN_LEVEL_ENTRIES = sunLevelEntries(SUN_WINDOW);
export const SUN_ENTRIES = sunEntries(SUN_WINDOW);
export const SHADOW_TABLE_STRIDE = shadowTableStride(SUN_WINDOW);
export const SHADOW_TABLE_ENTRIES = shadowTableEntries(SUN_WINDOW);
/** A table word: the physical page in the low bits, `PAGE_MAPPED` while it holds one, and
 *  `PAGE_VALID` while its depth may be read — set once its draw has landed, cleared while what it
 *  holds is wrong and waits to be drawn again (`pool.withdraw`). A page not valid hands the point
 *  to the next coarser level. */
export const PAGE_VALID = 1 << 16;
export const PAGE_MAPPED = 1 << 17;
export const PAGE_INDEX_MASK = 0xffff;
/** Depth ranges a sun keeps at once: a pair of floats each, in the six lamp matrices its record
 *  leaves free (`faces.ts`). A drawn page's word names the one its depth was drawn in, from bit
 *  `PAGE_RANGE_SHIFT` (`sunLevels.ts`): a new range leaves every page drawn in an older one read. */
export const SUN_DEPTH_RANGES = (POINT_FACES * 16) / 2;
export const PAGE_RANGE_SHIFT = 18;
export const PAGE_RANGE_MASK = 2 ** Math.ceil(Math.log2(SUN_DEPTH_RANGES)) - 1;
/** Pages a side of one layer of the pool: an 8 192-texel square, the largest 2D texture side
 *  WebGPU guarantees on every device (the default `maxTextureDimension2D`). */
const LAYER_SIDE = Math.floor(8192 / SHADOW_PAGE);
export const LAYER_PAGES = LAYER_SIDE * LAYER_SIDE;
/** The fewest whole layers of at most `layerSide²` pages — the device's texture side, the portable
 *  one by default — that hold `pages`, each the smallest square that shares them out. Page `p`
 *  lies in layer `⌊p / side²⌋`: one layer is the one square the pool always was. */
export function shadowPoolShape(pages: number, layerSide = LAYER_SIDE) {
  const wanted = Math.min(Math.max(1, Math.ceil(pages)), PAGE_INDEX_MASK + 1);
  const layers = Math.ceil(wanted / layerSide ** 2);
  return { side: Math.ceil(Math.sqrt(wanted / layers)), layers };
}
/** Where physical page `phys` lies in a pool of `side²`-page layers: its first texel, its layer. */
export function pageOrigin(phys: number, side: number) {
  const local = phys % (side * side);
  return {
    x: (local % side) * SHADOW_PAGE,
    y: Math.floor(local / side) * SHADOW_PAGE,
    layer: Math.floor(phys / (side * side)),
  };
}
/** Pages a layer side of the pool one shadowed light over a `width × height` screen asks. */
export const shadowPoolSide = (width: number, height: number) =>
  shadowPoolShape(shadowPoolSize(width, height)).side;

/** Pages per side of a lamp face at `mip`. */
export const lampPagesAt = (mip: number) => LAMP_SIDE >> mip;

/** Faces a lamp of kind `rank` draws: six for a point, one for a spot. */
export const lampFacesOf = (rank: number) => (rank === LIGHT_KIND.point ? POINT_FACES : 1);

/** Table entries a light of kind `rank` needs: a whole sun, or its lamp faces. */
export function tableEntriesOf(rank: number, pages = SUN_WINDOW) {
  if (rank === LIGHT_KIND.directional) return sunEntries(pages);
  return lampFacesOf(rank) * LAMP_FACE_ENTRIES;
}

/** A light's floor, the last level a reader falls back to: a sun's coarsest clipmap level, and a
 *  lamp face's one-page mip. */
export const sunFloorLevel = (finest: number) => finest + SUN_LEVELS - 1;
export const LAMP_FLOOR_MIP = LAMP_MIPS - 1;
