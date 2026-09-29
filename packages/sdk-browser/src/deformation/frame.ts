import { paletteReach, PALETTE_FLOATS } from '../../../sdk-core/src/world/animation/skeleton.ts';
import type { Skeleton } from '../../../sdk-core/src/world/animation/skeleton.ts';
import type { WaterSurface } from '../../../sdk-core/src/fluids/waterSurface.ts';
import { invertMatrix4 } from '../../../sdk-core/src/math/matrix/matrix4Inverse.ts';
import type { MatrixElements } from '../math/matrixElements.ts';
import {
  KIND_MORPH,
  KIND_SKIN,
  KIND_WAVE,
  recordLayout,
  WAVE_FLOATS,
  type RecordShape,
} from './layout.ts';

/** What a deformed placement is moved by: its mesh's skeleton, morph weights and waves. */
export type DeformedMesh = {
  skeleton?: Skeleton;
  morphTargetInfluences?: number[];
  waves?: WaterSurface | null;
};

/** One deformed placement: where it stands, its mesh, the counts its record holds and how far
 *  each source can move a vertex from its rest pose (`primitives[].deformation`). */
export type Deformed = {
  world: MatrixElements;
  mesh: DeformedMesh;
  shape: RecordShape;
  reach: { joints: ArrayLike<number>; targets: ArrayLike<number> };
};

const inverse = new Float64Array(16);

/** The smallest length a unit vector of the placement's frame takes in the world: a world
 *  distance over it is at least the object distance it came from (no shear in a scene pose). */
function smallestScale(m: ArrayLike<number>) {
  const column = (c: number) => Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]);
  return Math.min(column(0), column(1), column(2));
}

/** The most a joint's linear part stretches a vector, bounded by `√(‖L‖₁·‖L‖∞)` (one at rest,
 *  never below the true norm): how far a morph's displacement moves once
 *  the joints carry it. */
function paletteStretch(palette: Float32Array, at: number, joints: number) {
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

/** True when the `size` floats at `a` and at `b` of `block` differ. */
function differs(block: Float32Array, a: number, b: number, size: number) {
  for (let k = 0; k < size; k++) if (block[a + k] !== block[b + k]) return true;
  return false;
}

/**
 * The deformation records of a session's placements, one block (`layout.ts`): `bases[i]` is
 * placement `i`'s record's first float plus one, zero when it does not deform. Each frame
 * (`update`) keeps the last frame's values beside this one's — the temporal pass reprojects each
 * vertex from where it was — and measures how far each placement can move a vertex (`reach`, in
 * the placement's units), which the cuts grow its bounds by. A placement whose `skipped` says its
 * reach projects below the error drawn is drawn at rest, its reach zero. Nothing is allocated
 * after it is made.
 */
export function createDeformationFrame(placed: readonly (Deformed | null)[]) {
  const bases = new Uint32Array(placed.length),
    reach = new Float64Array(placed.length),
    moving = new Uint8Array(placed.length);
  let floats = 0;
  placed.forEach((entry, i) => {
    if (!entry) return;
    bases[i] = floats + 1;
    floats += recordLayout(entry.shape).floats;
  });
  const block = new Float32Array(Math.max(1, floats)),
    words = new Uint32Array(block.buffer);
  let first = true;
  /** The waves of this frame at `wave`, the world matrix and its inverse at `world`; returns the
   *  most they move a point, in the placement's units, and whether a phase moved. */
  const writeWaves = (entry: Deformed, world: number, wave: number) => {
    const model = entry.mesh.waves!.waveModel;
    block.set(entry.world.elements, world);
    invertMatrix4(inverse, entry.world.elements);
    block.set(inverse, world + 16);
    let crest = 0,
      moved = false;
    for (let w = 0; w < entry.shape.waves; w++) {
      const at = wave + w * WAVE_FLOATS,
        present = w < model.count;
      block[at + 6] = block[at + 5];
      block[at] = present ? model.dirX[w] : 1;
      block[at + 1] = present ? model.dirZ[w] : 0;
      block[at + 2] = present ? model.k[w] : 0;
      block[at + 3] = present ? model.amplitude[w] : 0;
      block[at + 4] = present ? model.lateral[w] : 0;
      block[at + 5] = present ? model.phase[w] : 0;
      if (first) block[at + 6] = block[at + 5];
      moved ||= block[at + 6] !== block[at + 5];
      if (present) crest += model.amplitude[w] + model.lateral[w];
    }
    return { reach: crest / smallestScale(entry.world.elements), moved };
  };
  /** Writes placement `i`'s record for this frame; returns how far it moves a vertex. */
  const write = (i: number, entry: Deformed, skipped: (i: number, reach: number) => boolean) => {
    const at = bases[i] - 1,
      { shape, mesh } = entry,
      layout = recordLayout(shape),
      joints = shape.joints * PALETTE_FLOATS,
      palette = at + layout.palette,
      weights = at + layout.weights;
    block.copyWithin(palette + joints, palette, palette + joints);
    block.copyWithin(weights + shape.targets, weights, weights + shape.targets);
    words[at + 1] = words[at];
    let kinds = 0,
      most = 0,
      moved = false;
    if (shape.joints && mesh.skeleton) {
      mesh.skeleton.palette(entry.world.elements, block, palette);
      most = paletteReach(block, palette, shape.joints, entry.reach.joints);
      if (first) block.copyWithin(palette + joints, palette, palette + joints);
      moved ||= differs(block, palette, palette + joints, joints);
      kinds |= KIND_SKIN;
    }
    if (shape.targets && mesh.morphTargetInfluences) {
      let morphed = 0;
      for (let t = 0; t < shape.targets; t++) {
        const weight = mesh.morphTargetInfluences[t] ?? 0;
        block[weights + t] = weight;
        if (first) block[weights + shape.targets + t] = weight;
        morphed += Math.abs(weight) * (entry.reach.targets[t] ?? 0);
      }
      moved ||= differs(block, weights, weights + shape.targets, shape.targets);
      most += morphed * (kinds & KIND_SKIN ? paletteStretch(block, palette, shape.joints) : 1);
      kinds |= KIND_MORPH;
    }
    if (shape.waves && mesh.waves) {
      const waved = writeWaves(entry, at + layout.world, at + layout.wave);
      most += waved.reach;
      moved ||= waved.moved;
      kinds |= KIND_WAVE;
    }
    if (kinds && skipped(i, most)) [kinds, most] = [0, 0];
    words[at] = kinds;
    if (first) words[at + 1] = kinds;
    words[at + 2] = shape.joints;
    words[at + 3] = shape.targets;
    words[at + 4] = shape.waves;
    moving[i] = moved || words[at] !== words[at + 1] ? 1 : 0;
    return most;
  };
  return {
    block,
    bases,
    reach,
    moving,
    /**
     * This frame's records, the last frame's kept beside them. `skipped(i, reach)` says whether
     * placement `i`, moving a vertex by at most `reach` of its units, projects that below the
     * error the image allows: it is then drawn at rest. Returns whether any record moved.
     */
    update(skipped: (i: number, reach: number) => boolean) {
      let changed = false;
      for (let i = 0; i < placed.length; i++) {
        const entry = placed[i];
        if (!entry) continue;
        reach[i] = write(i, entry, skipped);
        changed ||= moving[i] === 1;
      }
      first = false;
      return changed;
    },
  };
}
