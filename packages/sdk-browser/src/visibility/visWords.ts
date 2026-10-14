import { wgslFn } from '../../../math/src/wgsl/decl.ts'

/**
 * Visibility identifier layout: `(pageRow + 1) << 8 | triangleIndex`, zero meaning background.
 *
 * A page is one cluster, and a cluster holds at most 128 triangles in a DAG cache and 256 in an older
 * cache, so eight bits index a triangle and the twenty-four remaining bits address the page. That is
 * 16.7 M pages instead of the 65 535 a 16/16 split allowed, which a scene replicated a few times
 * exhausts immediately.
 */
export const VIS_TRIANGLE_BITS = 8

export const VIS_TRIANGLE_MASK = (1 << VIS_TRIANGLE_BITS) - 1

/** The page row identifier `id` names, as WGSL: its high bits minus one, the background's
 *  wrapping past any table. Every pass decodes an identifier with it and `visTriangle`. */
export const visPageIndex = wgslFn(
  'visPageIndex',
  [],
  `fn visPageIndex(id:u32)->u32{return (id>>${VIS_TRIANGLE_BITS}u)-1u;}`,
)

/** The triangle of its page that identifier (or cached word) `id` names, as WGSL: its low bits. */
export const visTriangle = wgslFn(
  'visTriangle',
  [],
  `fn visTriangle(id:u32)->u32{return id&${VIS_TRIANGLE_MASK}u;}`,
)

/** Largest triangle count a page may carry; one more would collide with the next page's rows. */
export const VIS_MAX_PAGE_TRIANGLES = VIS_TRIANGLE_MASK + 1

/**
 * The identifier a card's pixel holds: `VIS_CARD_BASE | slot`, its slot in the card records. Its page
 * row lies past every table a view can hold (`VIS_CARD_ROWS` rows below it), so each pass that
 * reads an identifier already leaves it as a pixel of no page — the resolve and the shadow
 * receiver reject a row past the table, the temporal passes (`taa/`) read it as the background —
 * and only the card pass's surface stage reads it, by equality (`webgpu/impostor/cardWgsl.ts`).
 */
export const VIS_CARD_BASE = 0xff000000

/** The most page rows an identifier names beside a card's. */
export const VIS_CARD_ROWS = VIS_CARD_BASE >>> VIS_TRIANGLE_BITS
