// The shipped cull of a caster against the mip views of a map (`renderCullWgsl.ts`), over stand-ins for
// the map's tables, the box cull and the occlusion's test.

import { FLOAT32_MAX } from '../../../../../../math/src/constants.ts'
import { f32Bits } from '../../../../../../math/src/float/bits.ts'
import { wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../../../../materials/texture/shaderRunMatrix.fixture.ts'
import { SUNS_LAYOUT } from '../layout.fixture.ts'
import { vsmRenderCullWgsl } from './renderCullWgsl.ts'

export const CULL = vsmRenderCullWgsl(SUNS_LAYOUT)

/** The shipped `vsmRenderCullViews` on the views of `mips` mips of a map (view `i` is mip `i`) and a
 *  candidate; the map's tables, the box cull and the occlusion's test stand in — `hiddenBefore` and
 *  `hiddenNow` the pyramids' verdicts —, the views' stale `layers` (bit 0 dynamic, bit 1 static) —, and the records it holds back and draws are told. */
export function viewCull(
  hiddenBefore: (centre: number[]) => boolean,
  hiddenNow: () => boolean = () => false,
  software = false,
  mips = 1,
  layers = 3,
) {
  const C = wgslConstants(CULL)
  // A mip view as the views' pass lists it: the map, the mip, its stale layers, its level of detail's scale.
  const mipViews = Array.from({ length: mips }, (_, mip) => [7, mip, layers, f32Bits(1)])
  const identity = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const map = {
    ...{ uncached: false, useCover: false, finestMip: 0, viewSlot: 0, wpoThreshold: 0 },
    lightKind: C.LIGHT_KIND_DIRECTIONAL! + 1,
    dynamicDepthCullRange: [0, FLOAT32_MAX],
    ...{ lightViewToClip: identity, shiftedToMapUv: identity },
    ...{ originShiftHigh: [0, 0, 0], originShiftLow: [0, 0, 0] },
  }
  const inView = {
    ...{ inMapView: true, clipHigh: [0, 0, 1], clipLow: [0, 0, 0.5] },
    ...{ pastNear: false, pastFar: false },
  }
  const held: unknown[][] = [],
    drawn: unknown[][] = [],
    boxes: unknown[][] = [],
    projections: unknown[][] = []
  const run = shaderRun<{ vsmRenderCullViews(...a: unknown[]): void }>(
    CULL,
    ['vsmRenderCullViews'],
    {
      ...C,
      params: {},
      vsm: { lodDeltaInvalidates: 0 },
      views: mipViews,
      vsmHandleFromId: (id: number) => ({ id }),
      vsmProjectionOf: () => map,
      vsmShiftedToClip: (m: Mat) => m,
      vsmBoxCullPoint: () => [0, 0, 0],
      vsmBoxInView: () => inView,
      vsmCasterBoxInView: (...args: unknown[]) => (boxes.push(args), inView),
      vsmClipRadius: () => 1,
      vsmIsFineCaster: () => false,
      vsmRenderEdgeScale: () => 1,
      vsmRenderLodAt: () => C.VSM_RENDER_LOD_OWN,
      vsmRectPixels: () => [0, 0, 16, 16],
      vsmClipToStaleRect: (pixels: number[]) => pixels,
      vsmTouchesMappedPixels: () => true,
      vsmRenderSwapped: () => false,
      vsmRenderTierOf: () => 0,
      vsmRenderSoftware: () => software,
      vsmPrevViewHolds: () => true,
      vsmPrevBoxInView: (...args: unknown[]) => (projections.push(args), { centre: args[1] }),
      vsmHiddenBefore: (_map: object, cull: { centre: number[] }) => hiddenBefore(cull.centre),
      vsmHiddenNow: hiddenNow,
      vsmRenderHold: (...args: unknown[]) => held.push(args),
      vsmRenderEmit: (...args: unknown[]) => drawn.push(args),
    },
  )
  const caster = (prevShift: number[]) => ({
    ...{ c: [10, 0, 0, 1], l: [0, 0, 0], row: 3, corners: 3, flags: 0, farDepth: 0 },
    ...{ own: [0, 0, 0, 1], parent: [0, 0, 0, 1], errors: [0, 0], edge: 0 },
    ...{ inst: [0, 0, 0, 1], viewBits: 0, offsetDisableSq: 0 },
    ...{ a0: [1, 0, 0], a1: [0, 1, 0], a2: [0, 0, 1] },
    // The axis fit (1, 1, 1) and the previous half axes (the same), in the pads of the vec3 members.
    ...{ tail0: [1, 1, 1, 1], tail1: [0, 0, 0, 1], tail2: [0, 0, 0, 1] },
    // No displacement: none to fall back from.
    tess: [0, 0, 0, 0],
    prevShift,
  })
  const kind = (name: 'FIRST' | 'SECOND' | 'POST') => C[`VSM_RENDER_CULL_${name}`]
  return { run, held, drawn, boxes, projections, caster, kind, map }
}
