import { LIGHT_KIND, LIGHT_SETTINGS, POINT_FACES } from '../light/contracts.ts';

/**
 * THE VIRTUAL LAYOUT OF SHADOW MAPS: what a page of each light is, and where its word sits in
 * the page table. Pure arithmetic, shared by the scheduler and — through the constants it
 * exports — by the shaders, so the two can never address a page differently.
 *
 * - A **sun** has `SUN_LEVELS` clipmap levels. Level `L` has texels of `2^L` metres and an extent
 *   of `SUN_WINDOW²` pages around the camera, addressed by absolute page modulo the extent — a
 *   ring: a camera step keeps every page that stays inside. The level itself sits in slot
 *   `L mod SUN_LEVELS`, a ring too, so a change of the finest level keeps the others.
 * - A **lamp** face — six for a point, one for a spot — is a map of `LAMP_SIDE²` pages at its
 *   finest mip, with every coarser mip down to one page.
 *
 * The physical pool is the one size here that depends on the world: `shadowPoolSide`.
 */
/** Side of a shadow page, in texels: the unit of the pool, of the virtual maps and of invalidation. */
export const SHADOW_PAGE: number = LIGHT_SETTINGS.shadowPage;
/** Pages per side of a lamp face's finest mip. */
export const LAMP_SIDE = Math.floor(LIGHT_SETTINGS.lampFaceSize / SHADOW_PAGE);
export const SUN_LEVELS: number = LIGHT_SETTINGS.sunLevels;
export const SUN_WINDOW: number = LIGHT_SETTINGS.sunLevelPages;
/** Mips of a lamp face, from `LAMP_SIDE` pages per side down to one. */
export const LAMP_MIPS = Math.log2(LAMP_SIDE) + 1;
/** The largest 2D texture side WebGPU guarantees on every device (the default
 *  `maxTextureDimension2D`): the pool's atlas never asks for more. */
const PORTABLE_TEXTURE_SIDE = 8192;
/** Texels a pixel reads at most from the level it picks: that level's texel is at most the
 *  pixel's footprint and more than half of it, so up to two texels a side. */
const TEXELS_PER_PIXEL = 4;

/**
 * Physical pages per side of the shadow pool, for a `width × height` screen: a fixed budget,
 * derived once when the world is created, never read off the machine.
 *
 * What a frame can read: a pixel reads the sun level whose texel is at most its footprint and more
 * than half of it — up to `TEXELS_PER_PIXEL` texels —, so one level seen by the whole screen reads
 * at most `width · height · 4 / 128²` pages. A pixel can pick any of the `SUN_LEVELS` levels — its
 * footprint grows with its depth, and the clipmap keeps every level's extent around the camera —,
 * and the pool holds all of them at once: the camera can sweep the screen over any level without
 * the pool evicting a page it read. The static layer mirrors the pool page for page
 * (`gpu/shadow/staticLayer.ts`), so it adds bytes, never pages.
 *
 * At 1280 × 720: 225 pages a level, 3 600 in all — 60 × 60 pages, a 7 680² depth texture of
 * 225 MiB, and as much for the static layer once something moves. The side is capped where the
 * atlas would pass the texture side every WebGPU device offers (64 pages): at 1920 × 1080 and
 * above, the pool is 4 096 pages and the screen's sweep over every level no longer fits.
 */
export function shadowPoolSide(width: number, height: number) {
  const perLevel = Math.ceil(
    (Math.max(1, width) * Math.max(1, height) * TEXELS_PER_PIXEL) / (SHADOW_PAGE * SHADOW_PAGE),
  );
  const side = Math.ceil(Math.sqrt(perLevel * SUN_LEVELS));
  return Math.min(side, Math.floor(PORTABLE_TEXTURE_SIDE / SHADOW_PAGE));
}
/** Entries of a sun level, of a whole sun, of one lamp face (every mip). */
export const SUN_LEVEL_ENTRIES = SUN_WINDOW * SUN_WINDOW;
export const SUN_ENTRIES = SUN_LEVELS * SUN_LEVEL_ENTRIES;
export const LAMP_FACE_ENTRIES = (() => {
  let total = 0;
  for (let mip = 0; mip < LAMP_MIPS; mip++) total += (LAMP_SIDE >> mip) ** 2;
  return total;
})();
/** A table word: the physical page in the low bits, `PAGE_MAPPED` while it holds one, and
 *  `PAGE_VALID` once that page's draw has landed — the only pages a shader reads. */
export const PAGE_VALID = 1 << 16;
export const PAGE_MAPPED = 1 << 17;
export const PAGE_INDEX_MASK = 0xffff;

/** Non-negative remainder. */
export const ringOf = (value: number, size: number) => ((value % size) + size) % size;

/** Pages per side of a lamp face at `mip`. */
export const lampPagesAt = (mip: number) => LAMP_SIDE >> mip;

/** First entry of `mip` inside a lamp face. */
export function lampMipOffset(mip: number) {
  let offset = 0;
  for (let m = 0; m < mip; m++) offset += lampPagesAt(m) ** 2;
  return offset;
}

/** Table entries a light of kind `rank` needs: a whole sun, or its lamp faces. */
export function tableEntriesOf(rank: number) {
  if (rank === LIGHT_KIND.directional) return SUN_ENTRIES;
  return (rank === LIGHT_KIND.point ? POINT_FACES : 1) * LAMP_FACE_ENTRIES;
}

/** Faces a lamp of kind `rank` draws: six for a point, one for a spot. */
export const lampFacesOf = (rank: number) => (rank === LIGHT_KIND.point ? POINT_FACES : 1);

/** Entry of sun page `(ax, ay)` of level `level`, relative to the light's table base. */
export const sunEntry = (level: number, ax: number, ay: number) =>
  ringOf(level, SUN_LEVELS) * SUN_LEVEL_ENTRIES +
  ringOf(ay, SUN_WINDOW) * SUN_WINDOW +
  ringOf(ax, SUN_WINDOW);

/** Entry of lamp page `(x, y)` of `face` at `mip`, relative to the light's table base. */
export const lampEntry = (face: number, mip: number, x: number, y: number) =>
  face * LAMP_FACE_ENTRIES + lampMipOffset(mip) + y * lampPagesAt(mip) + x;

/** What a relative lamp entry names: face, mip and page, written into `out`. */
export function decodeLampEntry(relative: number, out: Int32Array) {
  const face = Math.floor(relative / LAMP_FACE_ENTRIES);
  let rest = relative - face * LAMP_FACE_ENTRIES,
    mip = 0;
  while (mip < LAMP_MIPS - 1 && rest >= lampPagesAt(mip) ** 2) rest -= lampPagesAt(mip++) ** 2;
  const pages = lampPagesAt(mip);
  out[0] = face;
  out[1] = mip;
  out[2] = rest % pages;
  out[3] = Math.floor(rest / pages);
  return out;
}

/** Side of a sun page at `level`, in metres: 128 texels of `2^level`. */
export const sunPageMetres = (level: number) => SHADOW_PAGE * 2 ** level;

/**
 * The finest level a pixel of this view can read: the texel at most the size of its footprint
 * at the near plane. Every finer level would be sharper than any pixel that reads it.
 */
export const finestSunLevel = (pixelNear: number) =>
  Math.floor(Math.log2(Math.max(pixelNear, Number.MIN_VALUE)));
