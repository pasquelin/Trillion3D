// The texels the temporal pass fetches for one display pixel of a still image whose history every
// pixel keeps, on flat surfaces with no pixel animation: each pass's fetches as its shipped WGSL
// issues them (`packages/sdk-browser/src/post/taa/`), per render texel for the analysis — the nearest
// velocity, the reprojection, the thin geometry, the flicker measure, the rejection's two passes
// (the held measure and the shading rejection), the spatial anti-aliaser — and per display pixel
// for the history update. A workgroup's tile reads, at each stage, every texel of its span within
// the stage's ring (`ringTexels`, `tileWgsl.ts`) for the tile's own texels (ring 0). Every load, filtered sample and gather counts one; the words of a buffer
// (the page records, the occluder words) are no fetch. COUNTED, never timed: a pass's text that
// gains or loses a fetch breaks `taaFetchCount.test.ts`, which counts the fetches each program's
// text holds against this table.
//
//   node bench/runner/counts/taaFetchCount.ts
import type { TemporalAntialiasingLevel } from '../../../packages/sdk-core/src/contracts/compilerAbi.ts'
import { THIN_GEOMETRY_PLAN } from '../../../packages/sdk-browser/src/post/taa/thinGeometryWgsl.ts'
import { FLICKER_PLAN } from '../../../packages/sdk-browser/src/post/taa/flickerWgsl.ts'
import {
  HELD_MEASURE_PLAN,
  REJECTION_PLAN,
} from '../../../packages/sdk-browser/src/post/taa/rejectionWgsl.ts'
import { ringTexels, type TilePlan } from '../../../packages/sdk-browser/src/post/taa/tileWgsl.ts'
import { taaKnobs } from '../../../packages/sdk-browser/src/post/taa/levels.ts'

/** A tiled pass's fetches: per stage, its ring and what a slot of it fetches. */
type TiledPass = { plan: TilePlan; stages: readonly { ring: number; fetches: number }[] }

/** A tiled pass's fetches per render texel: each stage's slots over the tile's texels. */
const perTexel = ({ plan, stages }: TiledPass) =>
  stages.reduce(
    (sum, { ring, fetches }) => sum + (fetches * ringTexels(plan, ring)) / ringTexels(plan, 0),
    0,
  )

/**
 * Each pass: what a render texel (the analysis) or a display pixel (the history update) fetches,
 * and how many fetch calls its program's text holds (`sites`) — those of the blocks it lists
 * included, whether its entry reaches them or not.
 */
export const TAA_PASS_FETCHES = {
  // 9 depths, its identifier; a second identifier where it takes a neighbour's velocity, none on a
  // flat surface.
  velocity: { perTexel: 10, sites: 3 },
  // The marks, the closest word, the 3×3 vectors of the reprojection edge, its own vector, the
  // shading history's five Catmull-Rom taps, the flicker history, the thin geometry coverage.
  reproject: { perTexel: 1 + 1 + 9 + 1 + 5 + 1 + 1, sites: 7 },
  // Its span: the depth, the reprojection word, the marks and the colour (the identifiers only on
  // a texel that took a neighbour's velocity); the reprojection word again two texels out and on
  // the tile, the transparents' share on the tile.
  thin: {
    perTexel: perTexel({
      plan: THIN_GEOMETRY_PLAN,
      stages: [
        { ring: 5, fetches: 4 },
        { ring: 2, fetches: 1 },
        { ring: 0, fetches: 2 },
      ],
    }),
    sites: 6,
  },
  // Its span: the colour, the transparents' share, the flicker history; the thin geometry mask
  // five texels out; the flicker history and the mask two out; the flicker history, the marks and
  // the reprojection word on the tile.
  flicker: {
    perTexel: perTexel({
      plan: FLICKER_PLAN,
      stages: [
        { ring: 9, fetches: 3 },
        { ring: 5, fetches: 1 },
        { ring: 2, fetches: 2 },
        { ring: 0, fetches: 3 },
      ],
    }),
    sites: 9,
  },
  // Its span: the colour and the reprojection word; the shading history a texel in.
  held: {
    perTexel: perTexel({
      plan: HELD_MEASURE_PLAN,
      stages: [
        { ring: 5, fetches: 2 },
        { ring: 4, fetches: 1 },
      ],
    }),
    sites: 3,
  },
  // Its span: the reprojection word, the filtered input and history; the thin geometry mask; the
  // filtered input, history and error and the flicker error; the shading history's edge; on the
  // tile, the reprojection word, the filtered input's visibility, the colour and the shading
  // history (the 3×3's colours and words again only where a pixel animation lies near). Its text
  // also holds the analysis views' reads, which only a diagnostic view runs.
  rejection: {
    perTexel: perTexel({
      plan: REJECTION_PLAN,
      stages: [
        { ring: 4, fetches: 3 },
        { ring: 3, fetches: 1 },
        { ring: 2, fetches: 4 },
        { ring: 1, fetches: 1 },
        { ring: 0, fetches: 4 },
      ],
    }),
    sites: 18,
  },
  // The rejection's bits; where they ask for it — a rejected or disoccluded edge, none in a still,
  // kept image — its 3×3 lumas and up to two bilinear samples a side a level browses.
  antiAlias: { perTexel: 1, sites: 3 },
  // Per display pixel: the vector, the rejection, the anti-aliaser's offset, what the
  // transparents give up of its history; the kernel's five colours; a kept pixel's history, five
  // Catmull-Rom taps of the colour and of the share target. An as-is resolve adds each kernel
  // sample's flag. Its text also holds the received image of a diagnostic view.
  resolve: { perPixel: 4 + 5, history: 5 * 2, asIs: 5, sites: 8, asIsSites: 9 },
} as const

/** The fetches of the temporal pass at `level` for an image drawn at `scale` of the display per
 *  axis: the analysis per render texel — without the flicker measure where the level runs none,
 *  the anti-aliaser's target cleared, no fetch, where it browses no sample —, the history update
 *  per display pixel, for a pixel that keeps its history (`kept`) or one that does not, and their
 *  sum per display pixel. */
export function countTaaFetches(
  scale: number,
  { level = 'max', kept = true, asIs = false } = {} as {
    level?: Exclude<TemporalAntialiasingLevel, 'off'>
    kept?: boolean
    asIs?: boolean
  },
) {
  const P = TAA_PASS_FETCHES,
    knobs = taaKnobs(level)
  const analysis =
    P.velocity.perTexel +
    P.reproject.perTexel +
    P.thin.perTexel +
    (knobs.flicker ? P.flicker.perTexel : 0) +
    P.held.perTexel +
    P.rejection.perTexel +
    (knobs.antiAliasIterations > 0 ? P.antiAlias.perTexel : 0)
  const resolve = P.resolve.perPixel + (kept ? P.resolve.history : 0) + (asIs ? P.resolve.asIs : 0)
  return { analysis, resolve, perDisplayPixel: analysis * scale * scale + resolve }
}

function main() {
  const rows = (['low', 'medium', 'high', 'max'] as const).flatMap((level) =>
    [1, 0.5].map((scale) => ({ level, scale, ...countTaaFetches(scale, { level }) })),
  )
  console.log('Temporal pass: fetches per render texel (analysis) and display pixel')
  console.table(rows)
}

if (import.meta.main) main()
