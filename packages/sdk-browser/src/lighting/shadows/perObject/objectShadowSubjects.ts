import { objectShadowSize, type ObjectShadowView } from './objectShadowSize.ts'
import {
  objectShadowInitializer,
  setupObjectProjection,
  type Bounds,
  type ObjectShadowLight,
  type ObjectShadowProjection,
} from './objectShadowSetup.ts'
import {
  makesTranslucentObjectShadow,
  type ObjectShadowSettings,
} from './translucentShadowRules.ts'

/**
 * THE SUBJECTS OF A VIEW'S TRANSLUCENT OBJECT SHADOWS: for each light of the classic maps that lets translucent surfaces cast, the objects (all of them shadow
 * relevant casters of a volumetric translucent shadow, the feed gives no other) that draw a translucent surface, each with the projection and the rectangle its shadow
 * is drawn in. The table is filled on the CPU, once for a view, before the shadow passes; a light x object pair keeps its place from
 * one image to the next only by its two ids.
 */

/** A primitive as the table reads it. Lengths are centimetres. */
export interface ObjectShadowPrimitive {
  readonly id: number
  readonly bounds: Bounds
  /** The primitive draws a translucent surface at all (something for the depth pass to draw). */
  readonly hasTranslucent: boolean
}

/** A light as the table reads it. */
export interface ObjectShadowLightRecord {
  readonly id: number
  readonly light: ObjectShadowLight
  readonly castTranslucentShadows: boolean
  /** The light's resolution scale. */
  readonly resolutionScale: number
}

/** One light x object translucent shadow of a view. It carries no depth bias: the reference's translucent depth stage and projection apply none (`TranslucentShadowDepthShaders.usf`). */
export interface ObjectShadowSubject {
  readonly lightId: number
  readonly primitiveId: number
  /** The place of the primitive in the list the table was given, which is its caster's in the feed's list. */
  readonly place: number
  readonly projection: ObjectShadowProjection
  /** The fade of the view, which scales what the shadow darkens. */
  readonly fade: number
}

/** What the table needs of the view the shadows are sized for and of the frame's settings. */
export interface ObjectShadowTableInput {
  readonly settings: ObjectShadowSettings
  readonly view: ObjectShadowView
}

/**
 * The translucent object shadows of a view, into `out` (emptied first): each (light, object) pair where the light lets translucent surfaces cast and the object draws a
 * translucent surface; sized by the view, dropped where it fades away or where the light cannot see the object. Nothing at all unless the project
 * allows the shadows.
 */
export function objectShadowSubjects(
  input: ObjectShadowTableInput,
  lights: readonly ObjectShadowLightRecord[],
  primitives: readonly ObjectShadowPrimitive[],
  out: ObjectShadowSubject[] = [],
): ObjectShadowSubject[] {
  out.length = 0
  if (!makesTranslucentObjectShadow(input.settings)) return out
  for (const l of lights) {
    if (!l.castTranslucentShadows) continue
    for (let place = 0; place < primitives.length; place++) {
      const o = primitives[place]!
      if (!o.hasTranslucent) continue
      const size = objectShadowSize(
        input.settings,
        { center: o.bounds.origin, radius: o.bounds.radius },
        input.view,
        l.resolutionScale,
      )
      if (!size) continue
      const init = objectShadowInitializer(l.light, o.bounds, input.settings)
      if (!init) continue
      const projection = setupObjectProjection(
        init,
        size.translucentX,
        size.translucentMaxY,
        size.maxScreenPercent,
        true,
      )
      if (!projection) continue
      out.push({
        lightId: l.id,
        primitiveId: o.id,
        place,
        projection,
        fade: size.fade,
      })
    }
  }
  return out
}
