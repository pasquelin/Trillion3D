import { ADD_WORDS, OP, PART_WORDS, VIEW_WORDS, type SHAPE } from './layout.ts';

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
  /** Primitive sizes; unused for triangles and hulls. */
  size: readonly [number, number, number];
  /** Kilograms; 0 takes `density × volume`. */
  mass: number;
  density: number;
  friction: number;
  restitution: number;
  gravityScale: number;
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
    this.reserve(2 + values.length);
    this.words[this.length++] = op;
    this.words[this.length++] = index;
    for (let i = 0; i < values.length; i++) this.floats[this.length++] = values[i];
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
    w[at + 21] = vertexCount;
    w[at + 22] = indexCount;
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
  /** A command whose one argument is an unsigned word. */
  private word(op: number, index: number, value: number) {
    this.op(op, index, []);
    this.reserve(1);
    this.words[this.length++] = value >>> 0;
  }
  /** Replaces a body's flag bits (`FLAG`). */
  flags(index: number, flags: number) {
    this.word(OP.flags, index, flags);
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
  /** The words written so far, copied out, and the writer emptied. */
  take(): Uint32Array {
    const out = this.words.slice(0, this.length);
    this.length = 0;
    return out;
  }
}
