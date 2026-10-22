// The texels the temporal pass fetches for one display pixel of a still image whose history every
// pixel keeps, on flat surfaces with no pixel animation: each pass's fetches as its shipped WGSL
// issues them (`packages/sdk-browser/src/post/taa/`), per render texel for the analysis — the nearest
// velocity, the reprojection, the thin geometry detection where the setting asks for it
// (`temporalThinGeometry`, off by default), the flicker measure, the rejection's two passes (the
// held measure and the shading rejection), the spatial anti-aliaser — and per display pixel for
// the history update. A workgroup's tile reads, at each stage, every texel of its span within
// the stage's ring (`ringTexels`, `tileWgsl.ts`) for the tile's own texels (ring 0). Every load,
// filtered sample and gather counts one; the words of a buffer (the page records, the occluder
// words) are no fetch. COUNTED, never timed: a pass's text that
// gains or loses a fetch breaks `taaFetchCount.test.ts`, which counts the fetches each program's
// text holds against this table.
//
//   node bench/runner/counts/taaFetchCount.ts
import type { TemporalAntialiasingLevel } from '../../../packages/sdk-core/src/contracts/compilerAbi.ts'
import { THIN_GEOMETRY_PLAN } from '../../../packages/sdk-browser/src/post/taa/thinGeometryWgsl.ts'
import { flickerPlanFor } from '../../../packages/sdk-browser/src/post/taa/flickerWgsl.ts'
import {
  HELD_MEASURE_PLAN,
  REJECTION_PLAN,
} from '../../../packages/sdk-browser/src/post/taa/rejectionWgsl.ts'
import { ringTexels, type TilePlan } from '../../../packages/sdk-browser/src/post/taa/tileWgsl.ts'
import { taaKnobs } from '../../../packages/sdk-browser/src/post/taa/levels.ts'

/** A tiled pass's fetches: per stage, its ring and what a slot of it fetches. */
type TiledPass = { plan: TilePlan; stages: readonly { ring: number; fetches: number }[] }

/** The workgroup memory of a device that holds the wide flicker tile, bytes: what the engine
 *  asks of an adapter (`session/engine/common.ts`) comes to at least it; the guaranteed 16 KiB
 *  takes the narrow tile. */
const WIDE_TILE_BYTES = 32768

/** A tiled pass's fetches per render texel: each stage's slots over the tile's texels. */
const perTexel = ({ plan, stages }: TiledPass) =>
  stages.reduce(
    (sum, { ring, fetches }) => sum + (fetches * ringTexels(plan, ring)) / ringTexels(plan, 0),
    0,
  )

/** The flicker measure's stages: the colour, the transparents' share and the flicker history nine
 *  texels out; the thin geometry mask five texels out and again two out, where the detection runs
 *  (`thin`); the flicker history two out; the flicker history, the marks and the reprojection word
 *  on the tile. */
const flickerStages = (thin: boolean) => [
  { ring: 9, fetches: 3 },
  ...(thin ? [{ ring: 5, fetches: 1 }] : []),
  { ring: 2, fetches: thin ? 2 : 1 },
  { ring: 0, fetches: 3 },
]

/** The rejection's stages: the reprojection word, the filtered input and history four texels out;
 *  the thin geometry mask three out, where the detection runs (`thin`); the filtered input,
 *  history and error and the flicker error two out; the shading history's edge; on the tile, the
 *  reprojection word, the filtered input's visibility, the colour and the shading history (the
 *  3×3's colours and words again only where a pixel animation lies near). */
const rejectionStages = (thin: boolean) => [
  { ring: 4, fetches: 3 },
  ...(thin ? [{ ring: 3, fetches: 1 }] : []),
  { ring: 2, fetches: 4 },
  { ring: 1, fetches: 1 },
  { ring: 0, fetches: 4 },
]

/**
 * Each pass: what a render texel (the analysis) or a display pixel (the history update) fetches,
 * and how many fetch calls its program's text holds (`sites`) — those of the blocks it lists
 * included, whether its entry reaches them or not.
 */
export const TAA_PASS_FETCHES = {
  // 9 depths, its identifier; a second identifier where it takes a neighbour's velocity, none on a
  // flat surface; the displacement atlas's normals of a displaced pixel's flat point (`normalAt`),
  // none on an undisplaced surface.
  velocity: { perTexel: 10, sites: 4 },
  // The marks, the closest word, its dilated vector (`dilatedVector`: its offset's code in the marks
  // and the vector it names; the closest surface's depth only where that vector is the camera's
  // alone), the shading history's five Catmull-Rom taps (`bicubicRead`'s site besides), the flicker
  // history, the thin geometry coverage; the 3×3 dilated vectors of the reprojection edge only where
  // the texel's velocity is offset (none on a flat surface).
  reproject: { perTexel: 1 + 1 + 2 + 5 + 1 + 1, sites: 9 },
  // Where the detection runs. Its span: the depth, the reprojection word, the marks and the colour
  // (the identifiers only on a texel that took a neighbour's velocity); the reprojection word
  // again two texels out and on the tile, the transparents' share on the tile.
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
  // Over the wide tile, without the thin geometry detection (`flickerStages`).
  flicker: {
    perTexel: perTexel({ plan: flickerPlanFor(WIDE_TILE_BYTES), stages: flickerStages(false) }),
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
  // Without the thin geometry detection (`rejectionStages`). Its text also holds the analysis
  // views' reads, which only a diagnostic view runs.
  rejection: {
    perTexel: perTexel({ plan: REJECTION_PLAN, stages: rejectionStages(false) }),
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
 *  the anti-aliaser's target cleared, no fetch, where it browses no sample, and without the thin
 *  geometry detection and the mask reads it feeds unless `thin` asks for it —, the flicker measure
 *  over the tile a device holding `workgroupBytes` of workgroup memory takes, the history update
 *  per display pixel, for a pixel that keeps its history (`kept`) or one that does not, and their
 *  sum per display pixel. */
export function countTaaFetches(
  scale: number,
  {
    level = 'max',
    kept = true,
    asIs = false,
    thin = false,
    workgroupBytes = WIDE_TILE_BYTES,
  } = {} as {
    level?: Exclude<TemporalAntialiasingLevel, 'off'>
    kept?: boolean
    asIs?: boolean
    thin?: boolean
    workgroupBytes?: number
  },
) {
  const P = TAA_PASS_FETCHES,
    knobs = taaKnobs(level),
    work = thin ? knobs.thinWork : knobs.work
  const flicker = perTexel({
    plan: flickerPlanFor(workgroupBytes),
    stages: flickerStages(work.thin),
  })
  const rejection = perTexel({ plan: REJECTION_PLAN, stages: rejectionStages(work.thin) })
  const analysis =
    P.velocity.perTexel +
    P.reproject.perTexel +
    (work.thin ? P.thin.perTexel : 0) +
    (work.flicker ? flicker : 0) +
    P.held.perTexel +
    rejection +
    (work.antiAlias ? P.antiAlias.perTexel : 0)
  const resolve = P.resolve.perPixel + (kept ? P.resolve.history : 0) + (asIs ? P.resolve.asIs : 0)
  return { analysis, resolve, perDisplayPixel: analysis * scale * scale + resolve }
}

function main() {
  const rows = (['low', 'medium', 'high', 'max'] as const).flatMap((level) =>
    [false, true].flatMap((thin) =>
      [1, 0.5].map((scale) => ({ level, thin, scale, ...countTaaFetches(scale, { level, thin }) })),
    ),
  )
  console.log('Temporal pass: fetches per render texel (analysis) and display pixel')
  console.table(rows)
}

if (import.meta.main) main()
