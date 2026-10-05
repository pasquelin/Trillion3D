import { paletteReach } from '../../../sdk-core/src/world/animation/skeleton.ts';
import type { Skeleton } from '../../../sdk-core/src/world/animation/skeleton.ts';
import { keepNumbers } from '../../../sdk-core/src/math/primitives/vector.ts';
import type { Deformed } from './frame.ts';

/** True when the `size` floats at `a` and at `b` of `block` differ. */
export function differs(block: Float32Array, a: number, b: number, size: number) {
  for (let k = 0; k < size; k++) if (block[a + k] !== block[b + k]) return true;
  return false;
}

/** What one placement's palette holds of its inputs and its last write. */
type Held = {
  skeleton: Skeleton | null;
  /** The placement's world as last read. */
  world: Float64Array;
  /** The palette's reach as last measured. */
  reach: number;
  /** Whether the last frame's palette is this one's. */
  settled: boolean;
  /** Whether the last frame held every input. */
  whole: boolean;
  /** Else the input whose change was enough: a bone, the placement's world (-1) or none (-2). */
  last: number;
};

/**
 * The skin palettes of a frame's records (`frame.ts`), each written only when an input it reads
 * changed since it was last written: the palette would otherwise come out the very bits the
 * block holds, and its reach the one measured then. The inputs are the skeleton, the placement's
 * world at the same bits, and each bone's world. A bone, a node of the transform tree, is
 * unchanged while it is the same node at the same `_worldVersion`: the count the tree bumps at
 * every recalculation of a world matrix (`math/transform-tree/update.ts`), the signal its own
 * children are recomputed by. A skeleton's bind (`boneInverses`) is made with it: a new bind is a
 * new skeleton. Each placement holds as many joints as its record.
 */
export function createSkinPalettes(placed: readonly (Deformed | null)[], block: Float32Array) {
  const starts = new Uint32Array(placed.length + 1);
  placed.forEach((entry, i) => (starts[i + 1] = starts[i] + (entry?.shape.joints ?? 0)));
  const joints = starts[placed.length],
    held: Held[] = placed.map(() => ({
      skeleton: null,
      world: new Float64Array(16),
      reach: 0,
      settled: false,
      whole: false,
      last: -2,
    })),
    // Each bone as last read, and its world's count then.
    bones: (object | null)[] = new Array<object | null>(joints).fill(null),
    versions = new Uint32Array(joints);
  /** True when bone `j` of placement `i` is the world held for it, which it is from here on. */
  const holdBone = (i: number, j: number, skeleton: Skeleton) => {
    const at = starts[i] + j,
      bone = skeleton.bones[j],
      version = bone._worldVersion;
    if (bones[at] === bone && versions[at] === version) return true;
    bones[at] = bone;
    versions[at] = version;
    return false;
  };
  /** Whether placement `i`'s palette may differ from the one last written for it: true unless
   *  every input it reads is the one held. While every one is held, the first change found is
   *  enough. The palette is then taken as changed while that input still changes, the others
   *  left unread; once it stands, every input is read and held again, and the palette is written
   *  once more. A moving rig reads one input a frame, a still one all of them. */
  const changed = (i: number, entry: Deformed) => {
    const skeleton = entry.mesh.skeleton!,
      count = skeleton.bones.length;
    const own = held[i];
    // A skeleton grown past the record's joints is not held: the record cannot hold it either.
    if (count > starts[i + 1] - starts[i]) {
      own.whole = false;
      own.last = -2;
      return true;
    }
    const enough = own.whole,
      moving = own.last;
    let changed = !enough || own.skeleton !== skeleton;
    own.skeleton = skeleton;
    if (!enough && moving > -2 && moving < count) {
      const same =
        moving < 0 ? keepNumbers(own.world, entry.world.elements) : holdBone(i, moving, skeleton);
      if (!same) return true;
    }
    own.whole = false;
    own.last = -1;
    if (!keepNumbers(own.world, entry.world.elements)) {
      if (enough) return true;
      changed = true;
    }
    for (let j = 0; j < count; j++) {
      if (holdBone(i, j, skeleton)) continue;
      if (enough) return ((own.last = j), true);
      changed = true;
    }
    own.whole = true;
    return changed;
  };
  return {
    /** Placement `i`'s palette reach, as last measured. */
    reachOf: (i: number) => held[i].reach,
    /** Placement `i`'s palette, `floats` long from `at`, kept as the last frame's beside it. */
    keep(i: number, at: number, floats: number) {
      const own = held[i];
      if (!own.settled) block.copyWithin(at + floats, at, at + floats);
      own.settled = true;
    },
    /** Placement `i`'s palette of this frame from `at` (`keep` first), the last frame's taken for
     *  it when `cold`; returns whether the record moved: `moved`, or the palette did. */
    write(i: number, entry: Deformed, at: number, floats: number, cold: boolean, moved: boolean) {
      if (!changed(i, entry) && !cold) return moved;
      entry.mesh.skeleton!.palette(entry.world.elements, block, at);
      const own = held[i];
      own.reach = paletteReach(block, at, entry.shape.joints, entry.reach.joints);
      if (cold) block.copyWithin(at + floats, at, at + floats);
      else if (moved || differs(block, at, at + floats, floats)) {
        own.settled = false;
        return true;
      }
      return moved;
    },
  };
}
