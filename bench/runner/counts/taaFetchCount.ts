// The texels the temporal pass fetches for one display pixel of a still image whose history every
// pixel keeps, on flat surfaces with no pixel animation: each pass's fetches as its shipped WGSL
// issues them (`packages/sdk-browser/src/post/taa/`), per render texel for the analysis — the nearest
// velocity, the reprojection (the resurrected frame's guide in it where the level resurrects), the
// thin geometry detection where the setting asks for it (`temporalThinGeometry`, off by default),
// the flicker measure where the level runs one, the shading rejection, the spatial anti-aliaser —
// per history pixel for the history update, and per display pixel for the resolve that brings a
// history larger than the display down. The resurrected pixels' field is written only where a pixel
// is resurrected: none in a still image. A tiled pass's workgroup reads its inputs once for every
// texel of its tile, of which it writes the inner square (`REJECT_SHADING_TILE`,
// `REJECT_SHADING_STRIDE`); the thin geometry detection reads, at each stage, every texel of its span
// within the stage's ring (`ringTexels`, `tileWgsl.ts`) for the tile's own texels (ring 0). Every
// load, filtered sample and gather counts one; the words of a buffer (the page records, the occluder
// words) are no fetch. COUNTED, never timed: a pass's text that gains or loses a fetch breaks
// `taaFetchCount.test.ts`, which counts the fetches each program's text holds against this table.
//
//   node bench/runner/counts/taaFetchCount.ts
import type { TemporalAntialiasingLevel } from '../../../packages/sdk-core/src/contracts/compilerAbi.ts'
import { THIN_GEOMETRY_PLAN } from '../../../packages/sdk-browser/src/post/taa/thinGeometryWgsl.ts'
import {
  REJECT_SHADING_STRIDE,
  REJECT_SHADING_TILE,
} from '../../../packages/sdk-browser/src/post/taa/rejectionNetworkWgsl.ts'
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

/** The shading rejection's fetches per render texel written of `fetches` a texel of its tile. */
const perRejectTexel = (fetches: number) =>
  (fetches * REJECT_SHADING_TILE * REJECT_SHADING_TILE) /
  (REJECT_SHADING_STRIDE * REJECT_SHADING_STRIDE)

/**
 * Each pass: what a render texel (the analysis) or a display pixel (the history update) fetches,
 * and how many fetch calls its program's text holds (`sites`) — those of the blocks it lists
 * included, whether its entry reaches them or not.
 */
export const TAA_PASS_FETCHES = {
  // 9 depths, its identifier, the flags of its pixel (the velocity stage's second word) and the
  // responsiveness the layers over it carry; a second
  // identifier where it takes a neighbour's velocity, none on a flat surface; the displacement
  // atlas's normals of a displaced pixel's flat point (`normalAt`), none on an undisplaced surface;
  // the boundary's depth browse only where the texel's vector differs from its dilated one.
  // On the field's levels (`reprojectionField`), the 3×3's vectors besides. Where the image moved a
  // placement, a texel of it reads its two poses, now and as the last drawn frame drew them
  // (`placementMotion`: the world table's matrix and translation accessors of each of the two poses, four sites; the poses are placements' worlds, no instance accessor reads a table), none in
  // a still image.
  velocity: { perTexel: 10 + 1 + 1, field: 9, sites: 13 },
  // The marks, the closest word, its dilated vector (`dilatedVector`: its offset's code in the marks
  // and the vector it names; the closest surface's depth only where that vector is the camera's
  // alone), the shading history's five Catmull-Rom taps (`bicubicRead`'s site besides), the flicker
  // history, the thin geometry coverage; the 3×3 dilated vectors of the reprojection edge only where
  // the texel's velocity is offset (none on a flat surface). Its text also holds the resurrected
  // frame's guide (`guide`).
  reproject: { perTexel: 1 + 1 + 2 + 5 + 1 + 1, sites: 11 },
  // Where the level resurrects, in the reprojection: the marks, the depth the closest offset names,
  // and a bilinear read of the frame's shading history.
  guide: { perTexel: 3 },
  // Before the translucency: the flicker luma, the colour a texel, where the flicker measure or the
  // detection runs; the material's coverage, the identifier, where the detection runs (its page a
  // storage read, no fetch).
  measure: { luma: 1, coverage: 1, sites: 2 },
  // Where the detection runs. Its span: the depth, the reprojection word, the marks and the flicker
  // luma measured before the translucency (the material's coverage only on a texel that took a
  // neighbour's velocity); the reprojection word again two texels out and on the tile.
  thin: {
    perTexel: perTexel({
      plan: THIN_GEOMETRY_PLAN,
      stages: [
        { ring: 5, fetches: 4 },
        { ring: 2, fetches: 1 },
        { ring: 0, fetches: 1 },
      ],
    }),
    sites: 5,
  },
  // Its weight relaxation, a texel: the detection's word, the colour and the translucency the image
  // was composed with (the translucency's share of the colour's luma).
  relaxation: { perTexel: 3, sites: 3 },
  // The flicker measure, a texel of the shading rejection's tile: the reprojection word, the colour,
  // the translucency, the flicker luma measured before the translucency, the reprojected flicker
  // history and the marks; the thin geometry mask where the detection runs. Its errors, a buffer's
  // cells, are no fetch.
  flicker: {
    perTexel: perRejectTexel(6),
    thin: perRejectTexel(1),
    sites: 8,
  },
  // The shading rejection, a texel of its tile: the reprojection word, the colour, the translucency
  // and the reprojected shading history; the thin geometry mask where the detection runs; the
  // resurrected frame's shading history where the level resurrects. Its text also holds the
  // resurrected pixels' field (the marks and the depth) and the analysis views' reads.
  reject: {
    perTexel: perRejectTexel(4),
    thin: perRejectTexel(1),
    resurrection: perRejectTexel(1),
    // The thin geometry's coverage history (an analysis view's) is a site more since its pass is
    // its own; the flicker's reads moved to its measure.
    sites: 12,
  },
  // The rejection's bits; where they ask for it — a rejected or disoccluded edge, none in a still,
  // kept image — its 3×3 lumas and the samples a level browses, words of the LDR luma's buffer
  // (`lumaAt`): no fetch. Its one read a texel is the rejection's mask word, a storage buffer's: no
  // texture call in the program's text.
  antiAlias: { perTexel: 1, sites: 0 },
  // Per history pixel: the vector, the rejection, the anti-aliaser's offset (the kernel's five
  // colours are words of the scene colour's buffer, `sceneColorAt`: no fetch); a kept pixel's
  // history, five Catmull-Rom taps of the colour and of the validity; on the field's levels the
  // boundary, the dilated texel's rejection and its jacobian.
  update: { perPixel: 3, history: 5 * 2, field: 3, sites: 9 },
  // Per display pixel, where the history is larger than the display's: the sixteen history pixels
  // around it, their colour.
  resolveHistory: { perPixel: 16, sites: 1 },
} as const

/** The fetches of the temporal pass at `level` for an image drawn at `scale` of the display per
 *  axis: the analysis per render texel — without the flicker measure where the level runs none,
 *  the anti-aliaser's target cleared, no fetch, where it browses no sample, without the frame a
 *  pixel may be resurrected from where the level does not resurrect, and without the thin
 *  geometry detection and the mask reads it feeds unless `thin` asks for it —, the history update
 *  per history pixel and the resolve that brings the history down, together per display pixel
 *  (`resolve`, the history at the level's percent of the display's), for a pixel that keeps its
 *  history (`kept`) or one that does not, and the sum per display pixel; and each pass's share of
 *  them (`passes`). A device that cannot make the history that large keeps it the display's size:
 *  not counted. */
export function countTaaFetches(
  scale: number,
  { level = 'max', kept = true, thin = false } = {} as {
    level?: Exclude<TemporalAntialiasingLevel, 'off'>
    kept?: boolean
    thin?: boolean
  },
) {
  const P = TAA_PASS_FETCHES,
    knobs = taaKnobs(level),
    work = thin ? knobs.thinWork : knobs.work
  const factor = knobs.historyPercent / 100
  // Each pass's own, by its label (`TAA_*_PASS`): the analysis's a render texel, the update's and
  // the resolve's a display pixel. The display layers' resolve reads nothing where no filtering
  // blend is in the frame, which this count assumes.
  const passes = {
    measureFlickeringLuma: work.flicker || work.thin ? P.measure.luma : 0,
    measureThinCoverage: work.thin ? P.measure.coverage : 0,
    dilateVelocity: P.velocity.perTexel + (knobs.reprojectionField ? P.velocity.field : 0),
    decimateHistory: P.reproject.perTexel + (knobs.resurrection ? P.guide.perTexel : 0),
    detectThinGeometry: work.thin ? P.thin.perTexel : 0,
    relaxThinGeometry: work.thin ? P.relaxation.perTexel : 0,
    flickerMeasure: work.flicker ? P.flicker.perTexel + (work.thin ? P.flicker.thin : 0) : 0,
    rejectShading:
      P.reject.perTexel +
      (knobs.resurrection ? P.reject.resurrection : 0) +
      (work.thin ? P.reject.thin : 0),
    spatialAntiAliasing: work.antiAlias ? P.antiAlias.perTexel : 0,
    updateHistory:
      (P.update.perPixel +
        (knobs.reprojectionField ? P.update.field : 0) +
        (kept ? P.update.history : 0)) *
      factor *
      factor,
    resolveHistory: factor > 1 ? P.resolveHistory.perPixel : 0,
    resolveDisplayLayers: 0,
  }
  const analysis =
    passes.measureFlickeringLuma +
    passes.measureThinCoverage +
    passes.dilateVelocity +
    passes.decimateHistory +
    passes.detectThinGeometry +
    passes.relaxThinGeometry +
    passes.flickerMeasure +
    passes.rejectShading +
    passes.spatialAntiAliasing
  const resolve = passes.updateHistory + passes.resolveHistory + passes.resolveDisplayLayers
  return { analysis, resolve, perDisplayPixel: analysis * scale * scale + resolve, passes }
}

/** The temporal passes, by their labels (`TAA_*_PASS`), in their order. */
export type TaaPass = keyof ReturnType<typeof countTaaFetches>['passes']

function main() {
  const rows = (['low', 'medium', 'high', 'max'] as const).flatMap((level) =>
    [false, true].flatMap((thin) =>
      [1, 0.5].map((scale) => {
        const { analysis, resolve, perDisplayPixel } = countTaaFetches(scale, { level, thin })
        return { level, thin, scale, analysis, resolve, perDisplayPixel }
      }),
    ),
  )
  console.log('Temporal pass: fetches per render texel (analysis) and display pixel')
  console.table(rows)
}

if (import.meta.main) main()
