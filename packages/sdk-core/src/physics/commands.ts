import {
  ADD_WORDS,
  ANGULAR_DAMPING,
  BUILT_IN_FILTER,
  FILTER_AT,
  FILTER_BIT,
  FILTER_WORDS,
  JOINT_WORDS,
  LINEAR_DAMPING,
  MAX_FILTERS,
  OP,
  PART_WORDS,
  VIEW_WORDS,
} from './layout.ts'
import {
  bodyCollision,
  filterKey,
  maskWords,
  resolveCollision,
  type ResolvedCollision,
} from './collisionChannels.ts'
import { EngineError } from '../contracts/cache.ts'
import type { BodyRecord } from './bodyRecord.ts'
import type { JointRecord } from './joint/jointRecord.ts'
import { SpareBuffers } from './spareBuffers.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { resized } from '../../../math/src/sequence/resized.ts'

/** The floats of a command that has none. */
const NO_FLOATS: readonly number[] = []
/** What the character is to the others. */
const PAWN = resolveCollision({ profile: 'Pawn' }, 'Pawn')

/**
 * A growable command buffer: the page writes a frame's commands, then hands the words over in one
 * message; the worker copies them into the module's memory before one step and hands the buffer
 * back (`recycle`). Nothing allocates per command once the buffer has grown to the frame's size,
 * nor per frame once enough buffers go back and forth.
 */
export class CommandWriter {
  private words = new Uint32Array(1024)
  private floats = new Float32Array(this.words.buffer)
  private spare = new SpareBuffers()
  /** The filters defined so far, by what they are (`filterKey`): their ids are the module's object layers. */
  private filters = new Map<string, number>([
    [filterKey(bodyCollision({ type: 'static' }), true), BUILT_IN_FILTER.static],
    [filterKey(bodyCollision({ type: 'dynamic' }), false), BUILT_IN_FILTER.moving],
    [
      filterKey(bodyCollision({ type: 'dynamic', decorative: true }), false),
      BUILT_IN_FILTER.decorative,
    ],
    [filterKey(PAWN, false), BUILT_IN_FILTER.pawn],
  ])
  /** The record a filter is written in. */
  private readonly filterRecord = new Uint32Array(FILTER_WORDS)
  /** The filter of each collision, for a body that moves then one that does not, once known: a collision shared by many bodies is keyed once. */
  private readonly filterIds = new WeakMap<ResolvedCollision, [number?, number?]>()
  /** Words written since the last `take`. */
  length = 0

  private reserve(count: number) {
    const grown = resized(this.words, this.length + count)
    if (grown === this.words) return
    this.words = grown
    this.floats = new Float32Array(grown.buffer)
  }
  /** A command of the opcode, one index and floats, written in place. */
  private op(op: number, index: number, values: ArrayLike<number> = NO_FLOATS) {
    this.reserve(2 + values.length)
    this.words[this.length++] = op >>> 0
    this.words[this.length++] = index >>> 0
    for (let i = 0; i < values.length; i++) this.floats[this.length++] = values[i]
  }
  /** A command of whole words, then floats (the vehicles', `vehicle/vehicleCommands.ts`), then bytes padded
   *  with zeros to whole words (a cooked shape's or soft body's native binary state). */
  put(words: ArrayLike<number>, floats: ArrayLike<number> = NO_FLOATS, bytes?: Uint8Array) {
    const padded = ceilDiv(bytes?.length ?? 0, 4)
    this.reserve(words.length + floats.length + padded)
    for (let i = 0; i < words.length; i++) this.words[this.length++] = words[i] >>> 0
    for (let i = 0; i < floats.length; i++) this.floats[this.length++] = floats[i]
    if (!bytes?.length) return
    this.words[this.length + padded - 1] = 0
    new Uint8Array(this.words.buffer).set(bytes, this.length * 4)
    this.length += padded
  }
  /**
   * The id of the filter `collision` makes a body, defined in the buffer the first time it is named
   * (`FILTER_WORDS`): the same collision of a body that moves or one that does not, one filter.
   */
  filter(collision: ResolvedCollision, still: boolean): number {
    let ids = this.filterIds.get(collision)
    if (!ids) this.filterIds.set(collision, (ids = []))
    const known = ids[+still]
    if (known !== undefined) return known
    const key = filterKey(collision, still)
    const defined = this.filters.get(key)
    if (defined !== undefined) return (ids[+still] = defined)
    if (this.filters.size >= MAX_FILTERS)
      throw new EngineError(
        'PHYSICS_FILTERS',
        `The physics holds ${MAX_FILTERS} kinds of collision at most: ${this.filters.size} are in use.`,
        { limit: MAX_FILTERS },
      )
    const id = (ids[+still] = this.filters.size)
    this.filters.set(key, id)
    const bits =
      (collision.query ? FILTER_BIT.query : 0) |
      (collision.physics ? FILTER_BIT.physics : 0) |
      (still ? FILTER_BIT.still : 0)
    const record = this.filterRecord
    record[FILTER_AT.op] = OP.filter
    record[FILTER_AT.id] = id
    record[FILTER_AT.objectType] = collision.objectType
    record[FILTER_AT.switches] = bits
    record.set(maskWords(collision.block), FILTER_AT.block)
    record.set(maskWords(collision.overlap), FILTER_AT.overlap)
    this.put(record)
    return id
  }
  /** Creates a body. */
  add(body: BodyRecord) {
    const vertexCount = body.vertices ? body.vertices.length / 3 : 0
    const dataWords = body.indices?.length ?? (body.parts?.length ?? 0) * PART_WORDS
    const indexCount = dataWords + (body.massFrame?.length ?? 0)
    this.reserve(ADD_WORDS + vertexCount * 3 + indexCount)
    const w = this.words,
      f = this.floats,
      at = this.length
    w.set([OP.add, body.id, body.motion, body.filter, body.shape, body.flags], at)
    f.set(body.position, at + 6)
    f.set(body.quaternion, at + 9)
    f.set(body.size, at + 13)
    f.set([body.mass, body.density, body.friction, body.restitution, body.gravityScale], at + 16)
    f.set(body.damping ?? [LINEAR_DAMPING, ANGULAR_DAMPING], at + 21)
    w[at + 23] = vertexCount
    w[at + 24] = indexCount
    if (body.vertices) f.set(body.vertices, at + ADD_WORDS)
    if (body.indices) w.set(body.indices, at + ADD_WORDS + vertexCount * 3)
    if (body.massFrame) f.set(body.massFrame, at + ADD_WORDS + vertexCount * 3 + dataWords)
    body.parts?.forEach((part, i) => {
      const p = at + ADD_WORDS + i * PART_WORDS
      w[p] = part.shape
      f.set(part.size, p + 1)
      f.set(part.position, p + 4)
      f.set(part.quaternion, p + 7)
    })
    this.length += ADD_WORDS + vertexCount * 3 + indexCount
  }
  /** Removes a body. */
  remove(index: number) {
    this.op(OP.remove, index)
  }
  /** Moves a body at once, velocity kept (`position.set` on a dynamic body). */
  teleport(index: number, position: ArrayLike<number>, quaternion: ArrayLike<number>) {
    this.pose(OP.teleport, index, position, quaternion)
  }
  /** Drives a kinematic body to a pose over the next step, pushing what it meets. */
  moveKinematic(index: number, position: ArrayLike<number>, quaternion: ArrayLike<number>) {
    this.pose(OP.moveKinematic, index, position, quaternion)
  }
  /** A command whose arguments are a position (3 numbers) and a quaternion (4). */
  private pose(op: number, index: number, position: ArrayLike<number>, turn: ArrayLike<number>) {
    this.op(op, index)
    this.reserve(7)
    this.floats.set(position, this.length)
    this.floats.set(turn, this.length + 3)
    this.length += 7
  }
  /** Sets the linear velocity, m/s (waking the body). */
  velocity(index: number, linear: ArrayLike<number>) {
    this.op(OP.velocity, index, linear)
  }
  /** Adds an impulse at the centre of mass, in N·s. */
  impulse(index: number, impulse: ArrayLike<number>) {
    this.op(OP.impulse, index, impulse)
  }
  /** Wakes a sleeping body. */
  wake(index: number) {
    this.op(OP.wake, index)
  }
  /** Restores a cooked shape's native binary state under `handle`, for the ADDs that follow. */
  restore(handle: number, bytes: Uint8Array) {
    this.put([OP.restore, handle, bytes.length], NO_FLOATS, bytes)
  }
  /** Drops a restored shape's handle; the bodies built from it keep the shape. */
  release(handle: number) {
    this.op(OP.release, handle)
  }
  /** Replaces a body's flag bits (`FLAG`). */
  flags(index: number, flags: number) {
    this.put([OP.flags, index, flags])
  }
  /** Scales gravity for one body. */
  gravityScale(index: number, scale: number) {
    this.op(OP.gravityScale, index, [scale])
  }
  /** Sets friction and restitution. */
  material(index: number, friction: number, restitution: number) {
    this.op(OP.material, index, [friction, restitution])
  }
  /** Sets the page's view: the eye, the way it faces, the cone's half angle and the range. */
  view(eye: ArrayLike<number>, facing: ArrayLike<number>, halfCone: number, range: number) {
    this.reserve(VIEW_WORDS)
    this.words[this.length] = OP.view
    this.floats.set(eye, this.length + 1)
    this.floats.set(facing, this.length + 4)
    this.floats[this.length + 7] = halfCone
    this.floats[this.length + 8] = range
    this.length += VIEW_WORDS
  }
  /** Sets the world's gravity, m/s². */
  gravity(vector: ArrayLike<number>) {
    this.put([OP.gravity], vector)
  }
  /** Connects two bodies, or a body and the world. */
  joint(j: JointRecord) {
    const { mode, target, maxForce, axis } = j.motor
    const values = [0, 0, 0, 0, 0, 0, ...j.frameA, ...j.frameB, ...j.limits, target, maxForce]
    this.op(OP.joint, j.id, [...values, j.breakForce, j.breakTorque, ...j.extra])
    const at = this.length - JOINT_WORDS - j.extra.length
    this.words.set([j.kind, j.a >>> 0, j.b >>> 0, mode, axis, j.extra.length], at + 2)
  }
  /** Takes a joint out; one that broke or was never made is ignored. */
  unjoint(id: number) {
    this.op(OP.unjoint, id)
  }
  /** Sets a joint's motor. */
  motor(id: number, { mode, target, maxForce, axis }: JointRecord['motor']) {
    this.op(OP.motor, id, [0, 0, target, maxForce])
    this.words.set([mode, axis], this.length - 4)
  }
  /** The words written so far, in a buffer of their own (`SpareBuffers`); the writer emptied. */
  take(): Uint32Array<ArrayBuffer> {
    const out = this.spare.copy(this.words, this.length)
    this.length = 0
    return out
  }
  /** Buffers `take` gave out, handed back once the worker ran them. */
  recycle(buffers: readonly ArrayBuffer[]) {
    this.spare.recycle(buffers)
  }
}
