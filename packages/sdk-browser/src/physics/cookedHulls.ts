import type { CookedBody } from '../../../sdk-core/src/physics/index.ts'
import type { SharedShape, SharedShapes } from './sharedShapes.ts'
import { cookedHref, type Model } from './tilePlace.ts'

/** The hulls an opening's declared bodies are built on, by the URL their manifest names. */
export type Hulls = ReadonlyMap<string, SharedShape>

/** The hulls the `declared` bodies of an opening of `model` are built on (`sharedShapes.ts`): each
 *  held and kept restored from that opening to its leaving (`letGoHulls`), read and restored once
 *  for the session however many bodies and models name it. */
export function holdHulls(shapes: SharedShapes, model: Model, declared: readonly CookedBody[]) {
  const hulls = new Map<string, SharedShape>()
  for (const { shape } of declared)
    if (shape.type === 'cooked' && !hulls.has(shape.url)) {
      const hull = shapes.hold(cookedHref(model, shape.url), 0, {})
      shapes.use(hull)
      hulls.set(shape.url, hull)
    }
  return hulls
}

/** The `hulls` of an opening leaving, let go. */
export const letGoHulls = (shapes: SharedShapes, hulls: Hulls) =>
  hulls.forEach((hull) => (shapes.done(hull), shapes.letGo(hull)))

/** The hull `body` is built on among `hulls`, `undefined` for a primitive. */
export const hullOf = (hulls: Hulls, { shape }: CookedBody) =>
  shape.type === 'cooked' ? hulls.get(shape.url) : undefined
