import type { Object3D } from '../object/object3d.ts';
import type { Clip, Track, TrackKind } from './clip.ts';
import { Mixer } from './mixer.ts';
import { Skeleton } from './skeleton.ts';
import { solveTwoBoneIK } from './ik.ts';
import { windClip } from './wind.ts';

const track =
  (kind: TrackKind) =>
  (path: string, times: number[], values: number[]): Track => ({
    name: path,
    kind,
    times: new Float32Array(times),
    values: new Float32Array(values),
  });

/** The `animation` family: clips of keyed tracks, played by a mixer on a node and its children. */
export const animation = {
  /** A player of clips for a node and its children.
   *  @param root - The node whose children the clips move. */
  createMixer: (root: Object3D) => new Mixer(root),
  /** A named animation made of tracks.
   *  @param name - Its name. @param duration - How long it lasts, in s. @param tracks - What moves. */
  clip: (name: string, duration: number, tracks: Track[]): Clip => ({ name, duration, tracks }),
  /** A track of plain numbers.
   *  @param path - `node.field` it animates. @param times - Key times, in s. @param values - Values. */
  track: track('number'),
  /** A track of single numbers.
   *  @param path - `node.field` it animates. @param times - Key times, in s. @param values - One each. */
  numberTrack: track('number'),
  /** A track of 3D positions or sizes.
   *  @param path - `node.field` it animates. @param times - Key times, in s. @param values - Three each. */
  vectorTrack: track('vector'),
  /** A track of rotations.
   *  @param path - `node.field` it animates. @param times - Key times, in s. @param values - Four each. */
  quaternionTrack: track('quaternion'),
  /** A track of colours.
   *  @param path - `node.field` it animates. @param times - Key times, in s. @param values - RGB each. */
  colorTrack: track('color'),
  /** A track of a mesh's morph weights, all of them at each key.
   *  @param path - `node.morphTargetInfluences`. @param times - Key times, in s.
   *  @param values - One weight per target at each key. */
  weightsTrack: track('weights'),
  /** The bones a skinned mesh bends by: set it on the mesh (`mesh.skeleton`).
   *  @param bones - Its joints, in the order the geometry's `skinIndex` names them.
   *  @param inverseBindMatrices - Sixteen numbers a bone; omitted, the bones' poses now are the bind pose. */
  skeleton: (bones: Object3D[], inverseBindMatrices?: ArrayLike<number>) =>
    new Skeleton(bones, inverseBindMatrices),
  /** Bends a two-bone chain so that its end reaches a point, after the clips of the frame.
   *  @param root - The first bone. @param mid - The second. @param end - What hangs from it.
   *  @param target - The point to reach. @param pole - Where the bend points; omitted, as it does.
   *  @param weight - From 0, the pose as it is, to 1, the chain solved. */
  twoBoneIK: solveTwoBoneIK,
  /** A looping clip of wind in a tree's bones: they lean with it and sway back.
   *  @param bones - Trunk first, tips last. @param options - Direction, largest bend, sways a second. */
  windClip,
};
