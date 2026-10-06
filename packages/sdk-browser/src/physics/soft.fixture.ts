import {
  CommandWriter,
  FLAG,
  PHYSICS_STEP,
  SOFT_STATE_WORDS,
  softBodyOf,
  writeSoft,
  type SoftBodyOptions,
  type SoftBodyRecord,
} from '../../../sdk-core/src/physics/index.ts'
import { softSettings } from '../../../sdk-core/src/physics/softSettings.ts'
import { plane } from '../../../sdk-core/src/world/geometry/basic.ts'
import { fromArrays } from '../../../sdk-core/src/world/geometry/builder.ts'
import type { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts'
import { startModule, type Module } from './module.fixture.ts'
import { FLAT, body, id } from './records.fixture.ts'

/** The engine ids of the floor in slot 0, the soft body in slot 1, the box in slot 2. */
export const FLOOR = id(0),
  CLOTH = id(1),
  BOX = id(2)

/** A box of `mass` kg and 0.2 m in slot 2, its centre at `y`, with `flags`. */
export function addBox(jolt: Module, mass: number, y: number, flags = 0) {
  const writer = new CommandWriter()
  writer.add({ ...body(BOX, 2, y, 0.1, flags), mass })
  jolt.step(writer.take(), 0)
}

/** A committed module with Earth's gravity and a floor in slot 0, its top at y = 0, turned by
 *  `quaternion` about its centre, stepped in fixed steps of `step` seconds. */
export async function softWorld(quaternion = [0, 0, 0, 1], step = PHYSICS_STEP) {
  const jolt = await startModule({}, null, step)
  const writer = new CommandWriter()
  writer.gravity([0, -9.81, 0])
  writer.add({ ...body(FLOOR, 0, -1, 1), size: [20, 1, 20], quaternion })
  jolt.step(writer.take(), 0)
  return jolt
}

/** Writes `geometry` as a soft body of engine id `id`, at `position` turned by `quaternion`,
 *  reckoned at `step`; `words` override the record's. Its record. */
export function writeSoftBody(
  writer: CommandWriter,
  id: number,
  geometry: Geometry,
  options: SoftBodyOptions,
  position: number[],
  quaternion = [0, 0, 0, 1],
  words: Partial<SoftBodyRecord> = {},
  step = PHYSICS_STEP,
) {
  const settings = softSettings(options)
  const record = softBodyOf(geometry, { x: 1, y: 1, z: 1 }, settings, step)
  writeSoft(writer, {
    ...{ id, position, quaternion, scale: [1, 1, 1] },
    ...{ friction: 0.5, restitution: 0, gravityScale: 1, linearDamping: 0.05 },
    ...{ settings, record, ...words },
  })
  return record
}

/** Adds `geometry` as a soft body in slot 1, at `position`, reckoned at the module's step;
 *  `words` override the record's. */
export function addSoft(
  jolt: Module,
  geometry: Geometry,
  options: SoftBodyOptions,
  position: number[],
  words: Partial<SoftBodyRecord> = {},
) {
  const writer = new CommandWriter()
  const { fixedStep } = jolt
  const record = writeSoftBody(
    writer,
    CLOTH,
    geometry,
    options,
    position,
    undefined,
    words,
    fixedStep,
  )
  jolt.step(writer.take(), 0)
  return record
}

/** Steps `seconds` in steps of `step` seconds (the module's unless told), then the soft body's
 *  vertices as the page hears them, per geometry vertex. */
export function settle(
  jolt: Module,
  record: { map: Uint32Array },
  seconds: number,
  step = jolt.fixedStep,
) {
  let last: Float32Array | null = null
  for (let s = 0; s < Math.round(seconds / step); s++) {
    jolt.step(null, step)
    const words = jolt.soft()
    if (words.length) last = new Float32Array(words.slice(SOFT_STATE_WORDS).buffer)
  }
  const out = new Float32Array(record.map.length * 3)
  record.map.forEach((v, i) => out.set(last!.subarray(v * 3, v * 3 + 3), i * 3))
  return out
}

/** A rope of `count` points along x from the origin, `length` long. */
export const ropeLine = (count: number, length: number) =>
  fromArrays(
    Array.from({ length: count }, (_, i) => [(i * length) / (count - 1), 0, 0]).flat(),
    [],
    [],
    [],
  )

/** The most any vertex of `vertices` strays from `rest` once `offset` is taken off. */
export const strayed = (vertices: Float32Array, rest: ArrayLike<number>, offset = [0, 0, 0]) =>
  Math.max(...Array.from(vertices, (x, i) => Math.abs(x - offset[i % 3] - rest[i])))

/** The vertex `v` of `vertices`. */
export const at = (vertices: Float32Array, v: number) => [...vertices.subarray(v * 3, v * 3 + 3)]

/** A 1 m cloth of 10 × 10 squares laid flat at `y` in slot 1, `pins` held, its events wanted when
 *  told. */
export function flatCloth(jolt: Module, y: number, pins: number[], events = false) {
  const record = addSoft(jolt, plane(1, 1, 10, 10), { type: 'cloth', pins }, [0, y, 0], {
    quaternion: FLAT,
  })
  const writer = new CommandWriter()
  if (events) writer.flags(1, FLAG.events)
  jolt.step(writer.take(), 0)
  return record
}

/**
 * How far a written-back vertex may stray from the per-vertex chain it replaces:
 * four float spacings at 32 m, the reach of the soft tests' scenes (2⁻¹⁹ m each), 7.6 µm; a tenth
 * of a pixel is millimetres at any distance the page draws a soft body from.
 */
export const WRITEBACK_BOUND = 4 * 2 ** -19

/** Each body a step's soft words name (`softLayout.ts`): its engine id, its vertex count, and the
 *  word its vertices start at. */
export function* softBodiesIn(words: Uint32Array) {
  for (let at = 0; at < words.length; at += SOFT_STATE_WORDS + words[at + 1] * 3)
    yield { engine: words[at], count: words[at + 1], from: at + SOFT_STATE_WORDS }
}

/**
 * Steps `jolt` `seconds` in steps of `step` seconds (the module's unless told), `record`'s soft
 * body in it: per step, its vertices as the page hears them, per geometry vertex (`null` while it
 * sends none), whether the module brought it back or took it out, and the step's soft words
 * (valid until the next step).
 */
export function* stepped(
  jolt: Module,
  record: { map: Uint32Array },
  seconds: number,
  step = jolt.fixedStep,
) {
  for (let s = 0; s < Math.round(seconds / step); s++) {
    jolt.step(null, step)
    const words = jolt.soft()
    let vertices: Float32Array | null = null
    if (words.length) {
      const floats = new Float32Array(words.slice(SOFT_STATE_WORDS).buffer)
      vertices = new Float32Array(record.map.length * 3)
      record.map.forEach((v, i) => vertices!.set(floats.subarray(v * 3, v * 3 + 3), i * 3))
    }
    yield { vertices, recovered: jolt.recovered(), diverged: jolt.diverged(), words }
  }
}
