import type { SHAPE } from './layout.ts'

/** One primitive part of a compound body, placed in the body's frame (`PART_WORDS`). */
export interface CompoundPart {
  shape: (typeof SHAPE)['box' | 'sphere' | 'capsule' | 'cylinder']
  size: readonly [number, number, number]
  position: ArrayLike<number>
  quaternion: ArrayLike<number>
}

/** One body as the ADD command carries it (`layout.ts`). */
export interface BodyRecord {
  /** The body's engine id: its slot and the slot's generation (`BODY_INDEX`). */
  id: number
  motion: number
  layer: number
  shape: (typeof SHAPE)[keyof typeof SHAPE]
  flags: number
  position: ArrayLike<number>
  quaternion: ArrayLike<number>
  /** Primitive sizes, a cooked shape's scale; unused for triangles and hulls. */
  size: readonly [number, number, number]
  /** Kilograms; 0 takes `density × volume`. */ mass: number
  density: number
  friction: number
  restitution: number
  gravityScale: number
  /** Speed lost per second, linear then angular; left out, `DAMPING`. */
  damping?: readonly [number, number]
  vertices?: ArrayLike<number>
  indices?: ArrayLike<number>
  /** A compound's parts (shape `SHAPE.compound`). */
  parts?: readonly CompoundPart[]
  /** A primitive's or a cooked shape's mass frame, 3 or 12 floats (`ADD_WORDS`). */
  massFrame?: readonly number[]
}
