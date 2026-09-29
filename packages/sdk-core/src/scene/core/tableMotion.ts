/**
 * What moves in the prepared scene (#357), as the scene tables carry it
 * (`packages/asset-compiler-rust/src/compiler_tables/motion.rs`): the skins meshes bend by and the
 * animation clips the file plays, every number written out, so the runtime builds its skeletons
 * and clips without reading the scene's binary.
 */

/** A skin: the nodes that are its joints, the root of its skeleton, and each joint's inverse bind
 *  matrix, sixteen numbers column-major, `null` for identities. */
export interface TableSkin {
  /** Its name. */
  name: string;
  /** Its joints, as node ranks; a vertex's joint index is a rank in this list. */
  joints: readonly number[];
  /** The root of its skeleton, when the file names one. */
  skeleton: number | null;
  /** Sixteen numbers a joint: what takes the mesh from its bind pose into the joint's frame. */
  inverseBindMatrices: readonly number[] | null;
}

/** One channel of a clip: the node it moves, what it drives and its keys. */
export interface TableChannel {
  /** The node it moves, as a rank of the node table. */
  node: number;
  /** What it drives: the node's pose parts, or its mesh's morph weights. */
  path: 'translation' | 'rotation' | 'scale' | 'weights';
  /** How the value goes from one key to the next. */
  interpolation: 'LINEAR' | 'STEP' | 'CUBICSPLINE';
  /** When each key happens, in seconds. */
  times: readonly number[];
  /** The value at each key; a cubic spline's is in-tangent, value, out-tangent. */
  values: readonly number[];
}

/** A clip of the file: its name and its channels. */
export interface TableAnimation {
  /** Its name. */
  name: string;
  /** Its channels. */
  channels: readonly TableChannel[];
}
