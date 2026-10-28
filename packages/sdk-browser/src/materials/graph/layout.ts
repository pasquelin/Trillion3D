import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import type { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import type { MaterialGraph } from '../../../../sdk-core/src/world/material/graph/api.ts'
import { graphError } from '../../../../sdk-core/src/world/material/graph/valueType.ts'

/** A parameter held in a vector slot of the values: a scalar reads its first component. */
export interface VectorSlot {
  readonly name: string
  readonly scalar: boolean
  readonly initial: readonly number[]
}

/** A texture held in a word of the values, by the texture itself or, for a parameter, by its name;
 *  or a sparse volume texture, by the scene node (`source`) that cites its volume: the word holds
 *  that node, which the host's volume table names (`Slots.sparseVolume`). */
export interface TextureSlot {
  readonly key: string
  readonly name?: string
  readonly texture?: Texture
  readonly source?: number
}

/** The bytes of a four-component slot. */
const SLOT_BYTES = 16

/**
 * THE VALUES A COMPILED GRAPH READS, laid out: the vector slots first (a scalar or vector parameter
 * each, one slot a name), then the texture words (the slot of each texture in the colour atlas, the scene node of each sparse volume).
 * A parameter name used by two nodes is one slot; used as a scalar and as a vector it is refused.
 */
export class Slots {
  readonly vectors: VectorSlot[] = []
  readonly textures: TextureSlot[] = []

  /** The index of the vector slot of the parameter `name`, added the first time it is asked. */
  vector(name: string, scalar: boolean, initial: readonly number[]) {
    const at = this.vectors.findIndex((slot) => slot.name === name)
    if (at < 0) return this.vectors.push({ name, scalar, initial }) - 1
    if (this.vectors[at].scalar !== scalar)
      throw graphError(`parameter '${name}' is used as a scalar and as a vector`)
    return at
  }

  /** The index of the texture word of `key`, added the first time it is asked. */
  texture(key: string, texture: Texture, name?: string) {
    const at = this.textures.findIndex((slot) => slot.key === key)
    return at < 0 ? this.textures.push({ key, name, texture }) - 1 : at
  }

  /** The index of the word of the sparse volume of `key`, added the first time it is asked. */
  sparseVolume(key: string, source: number, name?: string) {
    const at = this.textures.findIndex((slot) => slot.key === key)
    return at < 0 ? this.textures.push({ key, name, source }) - 1 : at
  }

  /** The node a sparse volume slot names now: the one written by its parameter's name, else its own. */
  private sourceOf(slot: TextureSlot, graph: MaterialGraph) {
    const override = slot.name === undefined ? undefined : graph.values.get(slot.name)
    return typeof override === 'number' ? override : slot.source!
  }

  /** The scene node each sparse volume slot reads now, in the order of the slots. */
  sparseNodes(graph: MaterialGraph) {
    return this.textures
      .filter((slot) => slot.source !== undefined)
      .map((slot) => this.sourceOf(slot, graph))
  }

  /** The texture each slot reads now: the one written by its parameter's name, else its own. */
  current(graph: MaterialGraph) {
    return this.textures
      .filter((slot) => slot.source === undefined)
      .map((slot) => {
        const override = slot.name === undefined ? undefined : graph.values.get(slot.name)
        return (override as Texture | undefined)?.isTexture ? (override as Texture) : slot.texture!
      })
  }

  /** The words of texture slots, rounded up to whole four-word slots. */
  get textureRows() {
    return Math.max(ceilDiv(this.textures.length, 4), 1)
  }

  /** The bytes of the values: at least one slot of each kind. */
  get bytes() {
    return (Math.max(this.vectors.length, 1) + this.textureRows) * SLOT_BYTES
  }

  /**
   * Writes the values of `graph` into `out` at `offset`: each parameter its value (written by
   * name with `graph.set`, else its node's), each texture the slot `slotOf` gives it in the colour
   * atlas. False when a texture has no slot yet: nothing is drawable until it has.
   */
  fill(
    graph: MaterialGraph,
    out: ArrayBuffer,
    offset: number,
    slotOf: (texture: Texture) => number | undefined,
  ) {
    const floats = new Float32Array(out, offset, this.bytes / 4)
    const words = new Uint32Array(out, offset, this.bytes / 4)
    floats.fill(0)
    this.vectors.forEach((slot, i) => {
      const given = graph.values.get(slot.name)
      const value =
        typeof given === 'number' ? [given] : Array.isArray(given) ? given : slot.initial
      floats.set(value.slice(0, 4), i * 4)
      if (value.length === 3 && !slot.scalar) floats[i * 4 + 3] = 1
    })
    const first = Math.max(this.vectors.length, 1) * 4
    const textures = this.current(graph)
    let next = 0
    for (const [i, slot] of this.textures.entries()) {
      if (slot.source !== undefined) {
        words[first + i] = this.sourceOf(slot, graph)
        continue
      }
      const place = slotOf(textures[next++])
      if (place === undefined) return false
      words[first + i] = place
    }
    return true
  }
}
