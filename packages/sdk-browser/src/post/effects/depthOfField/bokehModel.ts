import { clamp } from '../../../../../math/src/scalar/reals.ts'
import type { ResolvedDepthOfField } from '../../../../../sdk-core/src/contracts/depthOfFieldOptions.ts'

/**
 * THE SHAPE OF A POINT OF LIGHT OUT OF FOCUS, from the lens' diaphragm: a circle where the aperture
 * is at or below its widest opening (`minAperture`); straight blades where that opening is
 * unlimited (`minAperture` 0); blades rounded to a circle of the widest opening's radius otherwise.
 * Every shape has the same area as the circle of the same circle-of-confusion radius, so a bokeh
 * keeps the energy it spreads; the factors below scale a circle's radius to the shape's corners and
 * to its sides.
 */

/** The shapes: the circle, straight blades, blades of the radius the widest opening gives. */
export type BokehShape = 'circle' | 'straight' | 'rounded'

/** The shape of the bokeh and what its tables are built from. */
export interface BokehModel {
  readonly shape: BokehShape
  /** The scale from a circle's radius to the radius of the circle through the shape's corners and
   *  to the one inside its sides. */
  readonly circumscribed: number
  readonly incircle: number
  /** Blades of the diaphragm; 0 for a circle. */
  readonly bladeCount: number
  /** The rotation of the diaphragm, in radians. */
  readonly rotation: number
  /** The radius of a rounded blade and the offset of its centre from the bokeh's, for a bokeh of the
   *  area of π; 0 for the other shapes. */
  readonly bladeRadius: number
  readonly bladeCenterOffset: number
  /** The anamorphic squeeze, from the coc model. */
  readonly squeeze: number
}

/** The circle's, which needs no table. */
const CIRCLE: Omit<BokehModel, 'squeeze'> = {
  shape: 'circle',
  circumscribed: 1,
  incircle: 1,
  bladeCount: 0,
  rotation: 0,
  bladeRadius: 0,
  bladeCenterOffset: 0,
}

/** Whether two models draw the same bokeh: the tables built from the first serve the second. */
export const sameBokeh = (a: BokehModel, b: BokehModel) =>
  a.shape === b.shape &&
  a.circumscribed === b.circumscribed &&
  a.incircle === b.incircle &&
  a.bladeCount === b.bladeCount &&
  a.rotation === b.rotation &&
  a.bladeRadius === b.bladeRadius &&
  a.bladeCenterOffset === b.bladeCenterOffset &&
  a.squeeze === b.squeeze

/** The straight blades of `count` blades on a circle of radius 1, scaled so their area is π. */
function straight(count: number) {
  const coverage = Math.PI / count
  const triangle = Math.cos(coverage) * Math.sin(coverage)
  const circumscribed = 1 / Math.sqrt((count * triangle) / Math.PI)
  return {
    ...CIRCLE,
    shape: 'straight' as const,
    bladeCount: count,
    circumscribed,
    incircle: circumscribed * Math.cos(coverage),
  }
}

/** The blades of `count` blades rounded to a circle `ratio` times the corners' radius, of area π. */
function rounded(count: number, ratio: number) {
  const coverage = Math.PI / count
  // The blade's circle for a circle of corners of radius 1, the angle one blade shows of it, and the
  // distance from its centre to the bokeh's.
  const bladeRadius = ratio
  const visible = Math.asin((1 / bladeRadius) * Math.sin(coverage))
  const offset = bladeRadius * Math.cos(visible) - Math.cos(coverage)
  // The area of the bokeh: a triangle per blade, plus the circle's cap beyond its straight side.
  const triangle = Math.cos(coverage) * Math.sin(coverage)
  const bladeTriangle = bladeRadius * bladeRadius * Math.cos(visible) * Math.sin(visible)
  const cap = bladeRadius * bladeRadius * visible - bladeTriangle
  const upscale = Math.sqrt(Math.PI / (count * (triangle + cap)))
  // Where the blade pivots, which fixes the rotation of the diaphragm.
  const pivotX = 0.5 * (bladeRadius - 1)
  const pivotY = Math.sqrt(bladeRadius * bladeRadius - pivotX * pivotX)
  return {
    shape: 'rounded' as const,
    bladeCount: count,
    rotation: Math.atan2(pivotX, pivotY),
    bladeRadius: upscale * bladeRadius,
    bladeCenterOffset: upscale * offset,
    circumscribed: upscale,
    incircle: upscale * (bladeRadius - offset),
  }
}

/** The bokeh of `volume`'s lens, with the squeeze `squeeze` of the circle of confusion's model. */
export function compileBokehModel(volume: ResolvedDepthOfField, squeeze: number): BokehModel {
  const count = clamp(volume.bladeCount, 4, 16)
  const { aperture } = volume
  const widest = Math.max(volume.minAperture, 0)
  if (aperture <= widest) return { ...CIRCLE, squeeze }
  if (widest === 0) return { ...straight(count), squeeze }
  return { ...rounded(count, aperture / widest), squeeze }
}
