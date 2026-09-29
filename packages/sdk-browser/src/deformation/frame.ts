import {
  paletteReach,
  paletteStretch,
  PALETTE_FLOATS,
} from '../../../sdk-core/src/world/animation/skeleton.ts';
import type { Skeleton } from '../../../sdk-core/src/world/animation/skeleton.ts';
import type { WaterSurface } from '../../../sdk-core/src/fluids/waterSurface.ts';
import { wavesChanged, writeWaves } from './waveFrame.ts';
import { writeSoftSource, type SoftSource } from './softSource.ts';
import type { MatrixElements } from '../math/matrixElements.ts';
import {
  KIND_MORPH,
  KIND_SKIN,
  KIND_WAVE,
  KIND_SOFT,
  recordLayout,
  type RecordShape,
} from './layout.ts';

/** What a deformed placement is moved by: its mesh's skeleton, morph weights and waves. */
export type DeformedMesh = {
  readonly sourceIdentity?: object | null;
  skeleton?: Skeleton;
  morphTargetInfluences?: number[];
  waves?: WaterSurface | null;
  softSource?: SoftSource;
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
    moving = new Uint8Array(placed.length),
    dirty = new Uint8Array(placed.length);
  let floats = 0;
  placed.forEach((entry, i) => {
    if (!entry) return;
    bases[i] = floats + 1;
    // Each record starts on a four-float boundary: the WebGL2 stage reads its palette by texel.
    floats += Math.ceil(recordLayout(entry.shape).floats / 4) * 4;
  });
  const block = new Float32Array(Math.max(1, floats)),
    words = new Uint32Array(block.buffer);
  const owners: (object | null | undefined)[] = new Array(placed.length);
  let first = true,
    revision = 0;
  /** Writes placement `i`'s record for this frame; returns how far it moves a vertex. */
  const write = (i: number, entry: Deformed, skipped: (i: number, reach: number) => boolean) => {
    const cold = first || owners[i] !== entry.mesh.sourceIdentity;
    owners[i] = entry.mesh.sourceIdentity;
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
      moved = !cold && stale(i, entry);
    if (shape.joints && mesh.skeleton) {
      mesh.skeleton.palette(entry.world.elements, block, palette, entry.boneWorlds);
      most = paletteReach(block, palette, shape.joints, entry.reach.joints);
      if (cold) block.copyWithin(palette + joints, palette, palette + joints);
      moved ||= differs(block, palette, palette + joints, joints);
      kinds |= KIND_SKIN;
    }
    if (shape.targets && mesh.morphTargetInfluences) {
      let morphed = 0;
      for (let t = 0; t < shape.targets; t++) {
        const weight = mesh.morphTargetInfluences[t] ?? 0;
        block[weights + t] = weight;
        if (cold) block[weights + shape.targets + t] = weight;
        morphed += Math.abs(weight) * (entry.reach.targets[t] ?? 0);
      }
      moved ||= differs(block, weights, weights + shape.targets, shape.targets);
      most += morphed * (kinds & KIND_SKIN ? paletteStretch(block, palette, shape.joints) : 1);
      kinds |= KIND_MORPH;
    }
    if (shape.waves && mesh.waves) {
      most += writeWaves(block, entry, at + layout.world, at + layout.wave, cold);
      kinds |= KIND_WAVE;
    }
    const soft = mesh.softSource;
    if (shape.soft && soft) {
      writeSoftSource(block, at + layout.simulation, soft, cold || words[at + 6] === 0);
      words[at + 6] = soft.version;
      most += soft.reach;
      kinds |= KIND_SOFT;
    }
    words[at + 5] = shape.soft ?? 0;
    if (kinds && skipped(i, most)) [kinds, most] = [0, 0];
    words[at] = kinds;
    if (cold) words[at + 1] = kinds;
    words[at + 2] = shape.joints;
    words[at + 3] = shape.targets;
    words[at + 4] = shape.waves;
    moving[i] = moved || words[at] !== words[at + 1] ? 1 : 0;
    dirty[i] = cold || moving[i] ? 1 : 0;
    return most;
  };
  /** Whether placement `i`'s morph weights or waves moved since its record was written: what a
   *  mixer or a clock changes without moving a node, which no scene revision announces. */
  const stale = (i: number, entry: Deformed) => {
    const layout = recordLayout(entry.shape),
      at = bases[i] - 1;
    if (owners[i] !== entry.mesh.sourceIdentity) return true;
    if (entry.mesh.softSource && entry.mesh.softSource.version !== words[at + 6]) return true;
    const weights = entry.mesh.morphTargetInfluences;
    for (let t = 0; weights && t < entry.shape.targets; t++)
      if (Math.fround(weights[t] ?? 0) !== block[at + layout.weights + t]) return true;
    return wavesChanged(block, entry, at + layout.world, at + layout.wave);
  };
  return {
    /** Revision of uploaded source poses, including deformation settling. */
    get revision() {
      return revision;
    },
    block,
    bases,
    reach,
    moving,
    dirty,
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
        changed ||= moving[i] === 1 || owners[i] !== entry.mesh.sourceIdentity;
        reach[i] = write(i, entry, skipped);
        changed ||= moving[i] === 1;
      }
      first = false;
      if (changed) revision++;
      return changed;
    },
  };
}
