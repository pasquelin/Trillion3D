import {
  paletteReach,
  paletteStretch,
  PALETTE_FLOATS,
} from '../../../sdk-core/src/world/animation/skeleton.ts';
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
  /** The skeleton's bones' world matrices, as the reader of `world` holds them: the engine's. */
  boneWorlds?: readonly MatrixElements[];
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
    // Each record starts on a four-float boundary: the WebGL2 stage reads its palette by texel.
    floats += Math.ceil(recordLayout(entry.shape).floats / 4) * 4;
  });
  const block = new Float32Array(Math.max(1, floats)),
    words = new Uint32Array(block.buffer);
  let first = true,
    /** Whether the last waves written moved a phase: `writeWaves`'s second answer. */
    waveMoved = false;
  /** The waves of this frame at `wave`, the world matrix and its inverse at `world`; returns the
   *  most they move a point, in the placement's units; `waveMoved` says whether a phase moved. */
  const writeWaves = (entry: Deformed, world: number, wave: number) => {
    const model = entry.mesh.waves!.waveModel;
    block.set(entry.world.elements, world);
    invertMatrix4(inverse, entry.world.elements);
    block.set(inverse, world + 16);
    let crest = 0;
    waveMoved = false;
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
      waveMoved ||= block[at + 6] !== block[at + 5];
      if (present) crest += model.amplitude[w] + model.lateral[w];
    }
    return crest / smallestScale(entry.world.elements);
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
      mesh.skeleton.palette(entry.world.elements, block, palette, entry.boneWorlds);
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
      most += writeWaves(entry, at + layout.world, at + layout.wave);
      moved ||= waveMoved;
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
  /** Whether placement `i`'s morph weights or waves moved since its record was written: what a
   *  mixer or a clock changes without moving a node, which no scene revision announces. */
  const stale = (i: number, entry: Deformed) => {
    const layout = recordLayout(entry.shape),
      at = bases[i] - 1;
    const weights = entry.mesh.morphTargetInfluences;
    for (let t = 0; weights && t < entry.shape.targets; t++)
      if (Math.fround(weights[t] ?? 0) !== block[at + layout.weights + t]) return true;
    const model = entry.mesh.waves?.waveModel;
    for (let w = 0; model && w < Math.min(model.count, entry.shape.waves); w++)
      if (Math.fround(model.phase[w]) !== block[at + layout.wave + w * WAVE_FLOATS + 5])
        return true;
    return false;
  };
  return {
    block,
    bases,
    reach,
    moving,
    /** Whether the next frame's records differ from this one's, or this one moved from the last:
     *  a frame that cannot be held, nor count as quiet. */
    pending() {
      for (let i = 0; i < placed.length; i++) {
        const entry = placed[i];
        if (entry && (moving[i] === 1 || stale(i, entry))) return true;
      }
      return false;
    },
    /**
     * This frame's records, the last frame's kept beside them. `skipped(i, reach)` says whether
     * placement `i`, moving a vertex by at most `reach` of its units, projects that below the
     * error the image allows: it is then drawn at rest. Returns whether records need uploading,
     * including the first pose and the previous pose settling after movement stops.
     */
    update(skipped: (i: number, reach: number) => boolean) {
      let changed = first;
      for (let i = 0; i < placed.length; i++) {
        const entry = placed[i];
        if (!entry) continue;
        changed ||= moving[i] === 1;
        reach[i] = write(i, entry, skipped);
        changed ||= moving[i] === 1;
      }
      first = false;
      return changed;
    },
  };
}
