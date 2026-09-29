import { multiplyMatrix4 } from '../../math/matrix/matrix4.ts';
import { invertMatrix4 } from '../../math/matrix/matrix4Inverse.ts';
import type { Object3D } from '../object/object3d.ts';

/** Floats of one joint of a palette: the three rows of its affine matrix. */
export const PALETTE_FLOATS = 12;

const meshInverse = new Float64Array(16),
  joint = new Float64Array(16),
  bind = new Float64Array(16),
  boneWorld = new Float64Array(16);

/**
 * The bones a skinned mesh bends by, and each bone's inverse bind matrix: what takes the mesh from
 * the pose it was modelled in into the bone's frame. A vertex's joint index is a rank in `bones`.
 * Without inverse bind matrices, the bones' poses when the skeleton is made are the bind pose.
 */
export class Skeleton {
  /** Always `true`: tells a skeleton apart. */ readonly isSkeleton = true as const;
  /** The nodes that are its joints, in joint order. */ readonly bones: Object3D[];
  /** Sixteen numbers a bone, column-major: the inverse of its world matrix in the bind pose. */
  readonly boneInverses: Float64Array;
  constructor(bones: Object3D[], boneInverses?: ArrayLike<number> | null) {
    this.bones = bones;
    this.boneInverses = new Float64Array(bones.length * 16);
    if (boneInverses) this.boneInverses.set(Array.from(boneInverses).slice(0, bones.length * 16));
    else
      bones.forEach((bone, j) => {
        bone.updateMatrixWorld(true);
        invertMatrix4(joint, bone.matrixWorld.elements);
        this.boneInverses.set(joint, j * 16);
      });
  }

  /**
   * Writes the palette of a mesh placed at `meshWorld` into `out` from `at`: for each joint, the
   * rows of `meshWorld⁻¹ · boneWorld · boneInverse`, which take a bind-pose vertex of the mesh to
   * where its bone carries it, in the mesh's own frame — so the mesh's placement, applied after,
   * draws it where the bone stands whatever the mesh node's own pose. `boneWorlds`, the bones'
   * world matrices as the reader of the mesh's world holds them; absent, each bone's own.
   */
  palette(
    meshWorld: ArrayLike<number>,
    out: Float32Array,
    at = 0,
    boneWorlds?: readonly { elements: ArrayLike<number> }[],
  ) {
    invertMatrix4(meshInverse, meshWorld);
    this.bones.forEach((bone, j) => {
      bind.set(this.boneInverses.subarray(j * 16, j * 16 + 16));
      boneWorld.set((boneWorlds?.[j] ?? bone.matrixWorld).elements);
      multiplyMatrix4(joint, boneWorld, bind);
      multiplyMatrix4(joint, meshInverse, joint);
      const base = at + j * PALETTE_FLOATS;
      for (let row = 0; row < 3; row++)
        for (let column = 0; column < 4; column++)
          out[base + row * 4 + column] = joint[column * 4 + row];
    });
    return out;
  }
}

/**
 * The most a vertex moves under `palette` (`joints` joints from `at`): a vertex of joint `j`'s
 * rest ball — centre `c`, radius `r`, `reach[4j..4j+4]` — goes to `M·v`, which lies within
 * `|M·c − c| + ‖L − I‖·r` of it (`L` the linear part, its norm bounded by the Frobenius norm),
 * and a blend of joints moves it by at most the largest of them. A joint no vertex leans on
 * (radius 0 at the origin) moves nothing that is drawn.
 */
export function paletteReach(
  palette: Float32Array,
  at: number,
  joints: number,
  reach: ArrayLike<number>,
) {
  let most = 0;
  for (let j = 0; j < joints && j * 4 + 3 < reach.length; j++) {
    const m = at + j * PALETTE_FLOATS,
      cx = reach[j * 4],
      cy = reach[j * 4 + 1],
      cz = reach[j * 4 + 2],
      r = reach[j * 4 + 3];
    if (!(r > 0) && !cx && !cy && !cz) continue;
    let moved = 0,
      frobenius = 0;
    for (let row = 0; row < 3; row++) {
      const x = palette[m + row * 4],
        y = palette[m + row * 4 + 1],
        z = palette[m + row * 4 + 2];
      const d =
        x * cx + y * cy + z * cz + palette[m + row * 4 + 3] - (row ? (row > 1 ? cz : cy) : cx);
      moved += d * d;
      frobenius += (x - +(row === 0)) ** 2 + (y - +(row === 1)) ** 2 + (z - +(row === 2)) ** 2;
    }
    most = Math.max(most, Math.sqrt(moved) + Math.sqrt(frobenius) * r);
  }
  return most;
}

/** The most a joint's linear part stretches a vector, bounded by `√(‖L‖₁·‖L‖∞)` (one at rest,
 *  never below the true norm): how far a morph's displacement moves once
 *  the joints carry it. */
export function paletteStretch(palette: Float32Array, at: number, joints: number) {
  let most = 1;
  for (let j = 0; j < joints; j++) {
    const m = at + j * PALETTE_FLOATS,
      cell = (row: number, c: number) => Math.abs(palette[m + row * 4 + c]);
    let rows = 0,
      columns = 0;
    for (let k = 0; k < 3; k++) {
      rows = Math.max(rows, cell(k, 0) + cell(k, 1) + cell(k, 2));
      columns = Math.max(columns, cell(0, k) + cell(1, k) + cell(2, k));
    }
    most = Math.max(most, Math.sqrt(rows * columns));
  }
  return most;
}
