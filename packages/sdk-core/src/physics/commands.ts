import {
  ADD_WORDS,
  DAMPING,
  JOINT_WORDS,
  OP,
  PART_WORDS,
  RESTORE_WORDS,
  VIEW_WORDS,
  type SHAPE,
} from './layout.ts';
import type { JointRecord } from './jointRecord.ts';

/** One primitive part of a compound body, placed in the body's frame (`PART_WORDS`). */
export interface CompoundPart {
  shape: (typeof SHAPE)['box' | 'sphere' | 'capsule' | 'cylinder'];
  size: readonly [number, number, number];
  position: ArrayLike<number>;
  quaternion: ArrayLike<number>;
}

/** One body as the ADD command carries it (`layout.ts`). */
export interface BodyRecord {
  /** The body's engine id: its slot and the slot's generation (`BODY_INDEX`). */
  id: number;
  motion: number;
  layer: number;
  shape: (typeof SHAPE)[keyof typeof SHAPE];
  flags: number;
  position: ArrayLike<number>;
  quaternion: ArrayLike<number>;
  /** Primitive sizes, a cooked shape's scale; unused for triangles and hulls. */
  size: readonly [number, number, number];
  /** Kilograms; 0 takes `density × volume`. */ mass: number;
  density: number;
  friction: number;
  restitution: number;
  gravityScale: number;
  /** Speed lost per second, linear then angular; left out, `DAMPING`. */
  damping?: readonly [number, number];
  vertices?: ArrayLike<number>;
  indices?: ArrayLike<number>;
  /** A compound's parts (shape `SHAPE.compound`). */
  parts?: readonly CompoundPart[];
}

/**
 * A growable command buffer: the page writes a frame's commands, then hands the words over in one
 * message; the worker copies them into the module's memory before one step. Nothing allocates per
 * command once the buffer has grown to the frame's size.
 */
export class CommandWriter {
  private words = new Uint32Array(1024);
  private floats = new Float32Array(this.words.buffer);
  /** Words written since the last `take`. */
  length = 0;

  private reserve(count: number) {
    if (this.length + count <= this.words.length) return;
    let size = this.words.length * 2;
    while (size < this.length + count) size *= 2;
    const grown = new Uint32Array(size);
    grown.set(this.words.subarray(0, this.length));
    this.words = grown;
    this.floats = new Float32Array(grown.buffer);
  }
  private op(op: number, index: number, values: ArrayLike<number>) {
    this.put([op, index], values);
  }
  /** A command of whole words, then floats (the vehicles', `vehicleCommands.ts`). */
  put(words: readonly number[], floats: ArrayLike<number>) {
    this.reserve(words.length + floats.length);
    for (const word of words) this.words[this.length++] = word >>> 0;
    for (let i = 0; i < floats.length; i++) this.floats[this.length++] = floats[i];
  }
  /** Creates a body. */
  add(body: BodyRecord) {
    const vertexCount = body.vertices ? body.vertices.length / 3 : 0;
    const indexCount = body.indices?.length ?? (body.parts?.length ?? 0) * PART_WORDS;
    this.reserve(ADD_WORDS + vertexCount * 3 + indexCount);
    const w = this.words,
      f = this.floats,
      at = this.length;
    w.set([OP.add, body.id, body.motion, body.layer, body.shape, body.flags], at);
    f.set(body.position, at + 6);
    f.set(body.quaternion, at + 9);
    f.set(body.size, at + 13);
    f.set([body.mass, body.density, body.friction, body.restitution, body.gravityScale], at + 16);
    f.set(body.damping ?? [DAMPING, DAMPING], at + 21);
    w[at + 23] = vertexCount;
    w[at + 24] = indexCount;
    if (body.vertices) f.set(body.vertices, at + ADD_WORDS);
    if (body.indices) w.set(body.indices, at + ADD_WORDS + vertexCount * 3);
    body.parts?.forEach((part, i) => {
      const p = at + ADD_WORDS + i * PART_WORDS;
      w[p] = part.shape;
      f.set(part.size, p + 1);
      f.set(part.position, p + 4);
      f.set(part.quaternion, p + 7);
    });
    this.length += ADD_WORDS + vertexCount * 3 + indexCount;
  }
  /** Removes a body. */
  remove(index: number) {
    this.op(OP.remove, index, []);
  }
  /** Moves a body at once, velocity kept (`position.set` on a dynamic body). */
  teleport(index: number, position: ArrayLike<number>, quaternion: ArrayLike<number>) {
    this.pose(OP.teleport, index, position, quaternion);
  }
  /** Drives a kinematic body to a pose over the next step, pushing what it meets. */
  moveKinematic(index: number, position: ArrayLike<number>, quaternion: ArrayLike<number>) {
    this.pose(OP.moveKinematic, index, position, quaternion);
  }
  /** A command whose arguments are a position (3 numbers) and a quaternion (4). */
  private pose(op: number, index: number, position: ArrayLike<number>, turn: ArrayLike<number>) {
    this.op(op, index, []);
    this.reserve(7);
    this.floats.set(position, this.length);
    this.floats.set(turn, this.length + 3);
    this.length += 7;
  }
  /** Sets the linear velocity, m/s (waking the body). */
  velocity(index: number, linear: ArrayLike<number>) {
    this.op(OP.velocity, index, linear);
  }
  /** Adds an impulse at the centre of mass, in N·s. */
  impulse(index: number, impulse: ArrayLike<number>) {
    this.op(OP.impulse, index, impulse);
  }
  /** Wakes a sleeping body. */
  wake(index: number) {
    this.op(OP.wake, index, []);
  }
  /** Restores a cooked shape's Jolt binary state under `handle`, for the ADDs that follow. */
  restore(handle: number, bytes: Uint8Array) {
    const words = Math.ceil(bytes.length / 4);
    this.reserve(RESTORE_WORDS + words);
    this.words.set([OP.restore, handle, bytes.length], this.length);
    this.words[this.length + RESTORE_WORDS + words - 1] = 0;
    new Uint8Array(this.words.buffer).set(bytes, (this.length + RESTORE_WORDS) * 4);
    this.length += RESTORE_WORDS + words;
  }
  /** Drops a restored shape's handle; the bodies built from it keep the shape. */
  release(handle: number) {
    this.op(OP.release, handle, []);
  }
  /** Replaces a body's flag bits (`FLAG`). */
  flags(index: number, flags: number) {
    this.put([OP.flags, index, flags], []);
  }
  /** Scales gravity for one body. */
  gravityScale(index: number, scale: number) {
    this.op(OP.gravityScale, index, [scale]);
  }
  /** Sets friction and restitution. */
  material(index: number, friction: number, restitution: number) {
    this.op(OP.material, index, [friction, restitution]);
  }
  /** Sets the page's view: the eye, the way it faces, the cone's half angle and the range. */
  view(eye: ArrayLike<number>, facing: ArrayLike<number>, halfCone: number, range: number) {
    this.reserve(VIEW_WORDS);
    this.words[this.length] = OP.view;
    this.floats.set(eye, this.length + 1);
    this.floats.set(facing, this.length + 4);
    this.floats[this.length + 7] = halfCone;
    this.floats[this.length + 8] = range;
    this.length += VIEW_WORDS;
  }
  /** Sets the world's gravity, m/s². */
  gravity(vector: ArrayLike<number>) {
    this.reserve(4);
    this.words[this.length++] = OP.gravity;
    this.floats.set(vector, this.length);
    this.length += 3;
  }
  /** Connects two bodies, or a body and the world. */
  joint(j: JointRecord) {
    const { mode, target, maxForce, axis } = j.motor;
    const values = [0, 0, 0, 0, 0, 0, ...j.frameA, ...j.frameB, ...j.limits, target, maxForce];
    this.op(OP.joint, j.id, [...values, j.breakForce, ...j.extra]);
    const at = this.length - JOINT_WORDS - j.extra.length;
    this.words.set([j.kind, j.a >>> 0, j.b >>> 0, mode, axis, j.extra.length], at + 2);
  }
  /** Takes a joint out; one that broke or was never made is ignored. */
  unjoint(id: number) {
    this.op(OP.unjoint, id, []);
  }
  /** Sets a joint's motor. */
  motor(id: number, { mode, target, maxForce, axis }: JointRecord['motor']) {
    this.op(OP.motor, id, [0, 0, target, maxForce]);
    this.words.set([mode, axis], this.length - 4);
  }
  /** The words written so far, copied out, and the writer emptied. */
  take(): Uint32Array {
    const out = this.words.slice(0, this.length);
    this.length = 0;
    return out;
  }
}
