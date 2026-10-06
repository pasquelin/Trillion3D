import type { CookedBody, CookedTile } from '../../../sdk-core/src/physics/index.ts'
import type { CookedKind, SharedShape, SharedShapes } from './sharedShapes.ts'
import { cookedHref, type Model } from './tilePlace.ts'

/** The cooked objects an opening's bodies are built from, by the URL their manifest names. */
export type HeldObjects = ReadonlyMap<string, SharedShape>

/** The cooked `objects` of `kind` an opening of `model` builds its bodies from (`sharedShapes.ts`),
 *  each held from that opening to its leaving (`letGoAll`) and read once however many bodies and
 *  models name it; a hull, its body's own shape, counts no bytes of the static collision. */
export function holdObjects(
  shapes: SharedShapes,
  model: Model,
  kind: Exclude<CookedKind, 'tile'>,
  objects: Iterable<Pick<CookedTile, 'url'> | undefined>,
) {
  const held = new Map<string, SharedShape>()
  for (const object of objects)
    if (object && !held.has(object.url)) {
      const shape = shapes.hold(kind, cookedHref(model, object.url), 0, {})
      // The opening keeps it restored for its bodies, made or waiting for another scale.
      shapes.use(shape)
      held.set(object.url, shape)
    }
  return held
}

/** The objects an opening held and kept, let go as it leaves. */
export const letGoAll = (shapes: SharedShapes, held: HeldObjects) =>
  held.forEach((shape) => (shapes.done(shape), shapes.letGo(shape)))

/** The cooked hull of `body`, `undefined` for a primitive. */
export const cookedHull = ({ shape }: CookedBody) => (shape.type === 'cooked' ? shape : undefined)

/** The shape `body`'s hull is among `hulls`, `undefined` for a primitive. */
export const hullOf = (hulls: HeldObjects, body: CookedBody) => {
  const hull = cookedHull(body)
  return hull && hulls.get(hull.url)
}
