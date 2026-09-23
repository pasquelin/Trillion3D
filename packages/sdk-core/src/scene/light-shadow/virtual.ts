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
 * - A **lamp** face — six for a point, one for a spot — is a map of `POOL_SIDE²` pages at its
 *   finest mip, the pool's own side, with every coarser mip down to one page.
 */
/** Side of a shadow page, in texels: the unit of the pool, of the virtual maps and of invalidation. */
export const SHADOW_PAGE: number = LIGHT_SETTINGS.shadowPage;
/** Physical pages per side of the pool, and in all. */
export const POOL_SIDE = Math.floor(LIGHT_SETTINGS.shadowAtlasSize / SHADOW_PAGE);
export const POOL_PAGES = POOL_SIDE * POOL_SIDE;
export const SUN_LEVELS: number = LIGHT_SETTINGS.sunLevels;
export const SUN_WINDOW: number = LIGHT_SETTINGS.sunLevelPages;
/** Mips of a lamp face, from `POOL_SIDE` pages per side — the finest spans the pool — down to one. */
export const LAMP_MIPS = Math.log2(POOL_SIDE) + 1;
/** Entries of a sun level, of a whole sun, of one lamp face (every mip). */
export const SUN_LEVEL_ENTRIES = SUN_WINDOW * SUN_WINDOW;
export const SUN_ENTRIES = SUN_LEVELS * SUN_LEVEL_ENTRIES;
export const LAMP_FACE_ENTRIES = (() => {
  let total = 0;
  for (let mip = 0; mip < LAMP_MIPS; mip++) total += (POOL_SIDE >> mip) ** 2;
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
export const lampPagesAt = (mip: number) => POOL_SIDE >> mip;

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
