import type { Material } from '../material/material.ts'
import {
  blendableOf,
  isPostProcessMaterial,
  type BlendableLocation,
  BLENDABLE_LOCATIONS,
} from '../material/postProcessMaterial.ts'

/** One blendable the image holds: a post-process material and the weight it joins the image with, 0 (excluded) to 1. */
export interface WeightedBlendable {
  readonly material: Material
  readonly weight: number
}

/** A blendable of a chain, ready to draw: its material, its place in the chain and the parameter values its weight leaves. */
export interface ChainedBlendable {
  readonly material: Material
  /** The weight the material's parameters are blended in with: 1 draws them as they are, under 1 they are mixed with the neutral
   *  state the graph's nodes hold. */
  readonly weight: number
}

/** A weight held to what a blendable takes: a number above 0, at most 1. */
function checkWeight(weight: unknown) {
  if (typeof weight !== 'number' || !(weight > 0 && weight <= 1))
    throw new RangeError(`BLENDABLE_WEIGHT:${String(weight)}`)
  return weight
}

/**
 * THE BLENDABLES OF THE IMAGE (`world.effects.blendables`): the post-process materials (`material.postProcess`)
 * the image joins, each with a weight, as the list of weighted blendables of a camera's post-process settings. A material
 * joins the image at its `blendableLocation`, the materials of one location ordered by their `blendablePriority`, equal
 * ones in the order they were added (`chainAt`). An empty list costs nothing: no pass, no resource, the image is the one
 * without the feature. A write tells the chain, which draws the image again.
 */
export class Blendables {
  private readonly list: WeightedBlendable[] = []
  private readonly touched: () => void
  /** @internal The sorted chains, kept from change to change so a frame allocates none. */
  private readonly chains = new Map<BlendableLocation, readonly ChainedBlendable[]>()
  /** A write to a material the list holds: its place, its priority or its parameters moved. */
  private readonly heard = () => {
    this.changed()
  }
  /** @param changed - Runs after every change of the list or of one of its materials. */
  constructor(changed: () => void = () => {}) {
    this.touched = changed
  }
  /** The blendables, in the order they were added. */
  get entries(): readonly WeightedBlendable[] {
    return this.list
  }
  /** How many blendables the image holds. */
  get size() {
    return this.list.length
  }
  /**
   * Adds a post-process material to the image.
   * @param material - A material made by `material.postProcess`.
   * @param weight - How much of the material joins the image, above 0 and at most 1 (1).
   */
  add(material: Material, weight = 1) {
    if (!isPostProcessMaterial(material))
      throw new TypeError('a blendable is a material made by material.postProcess')
    this.list.push({ material, weight: checkWeight(weight) })
    material._listeners.subscribe(this.heard)
    return this.changed()
  }
  /** Takes a material out of the image; false when it was not in it. */
  remove(material: Material) {
    const at = this.list.findIndex((entry) => entry.material === material)
    if (at < 0) return false
    this.list.splice(at, 1)
    // A material added twice stays heard while an entry holds it.
    if (!this.list.some((entry) => entry.material === material))
      material._listeners.unsubscribe(this.heard)
    this.changed()
    return true
  }
  /** Takes every blendable out. */
  clear() {
    if (!this.list.length) return
    for (const { material } of this.list) material._listeners.unsubscribe(this.heard)
    this.list.length = 0
    this.changed()
  }
  /**
   * The materials that join the image at `location`, in the order they run, stably sorted by priority. A material added twice is
   * one entry whose parameters are mixed in turn by each weight, unless it may not be blended (`isBlendable` off, which only turns
   * the blending of parameters off): each add is then a node of its own.
   * Kept until the list or a material changes: the same array is returned.
   */
  chainAt(location: BlendableLocation): readonly ChainedBlendable[] {
    if (!this.chains.size) this.rebuild()
    return this.chains.get(location)!
  }
  private changed() {
    this.chains.clear()
    this.touched()
    return this
  }
  private rebuild() {
    const byLocation = new Map<BlendableLocation, { entry: ChainedBlendable; priority: number }[]>()
    const seen = new Map<Material, number>()
    for (const { material, weight } of this.list) {
      const place = blendableOf(material)
      // A material met again takes its place in the first entry: the weights compose, each mixing the values in by its own.
      // One that may not be blended is not mixed: every add is a node of its own.
      const again = place.isBlendable ? seen.get(material) : undefined
      if (again !== undefined) {
        const group = byLocation.get(place.location)!
        const first = group.find((one) => one.entry.material === material)!
        first.entry = { material, weight: first.entry.weight + (1 - first.entry.weight) * weight }
        seen.set(material, again + 1)
        continue
      }
      if (place.isBlendable) seen.set(material, 1)
      const group = byLocation.get(place.location) ?? []
      group.push({ entry: { material, weight }, priority: place.priority })
      byLocation.set(place.location, group)
    }
    this.chains.clear()
    for (const location of BLENDABLE_LOCATIONS)
      this.chains.set(
        location,
        (byLocation.get(location) ?? [])
          // Array.prototype.sort is stable: equal priorities keep the order they were added in.
          .sort((a, b) => a.priority - b.priority)
          .map((one) => one.entry),
      )
  }
}
