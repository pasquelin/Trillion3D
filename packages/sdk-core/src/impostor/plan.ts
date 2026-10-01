/**
 * THE RUNTIME PLAN of the impostor tier (#1239, "When to switch"). The bake (#817 part 1) gives, per
 * drawn mesh, its three atlas maps and the four numbers the switch reads; this turns them, the
 * placements and the view into the cards to draw and the roots whose clusters the cut suppresses.
 *
 * One card per switched root. A root is identified by its compiled mesh number (`Primitive.mesh`),
 * the same number the compiler keys its `impostors` entries by
 * (`packages/asset-compiler-rust/src/impostor/stage.rs`): there is no second mesh table. The switch is the
 * engine's one oracle (`switch.ts`), never a per-scene constant: `f` is the engine's focal length
 * in pixels (`pixelScaleOf`), `z` the pivot's view distance (as `orderPendingUrls` measures it),
 * `R`, `T`, `c` and `r_f` only from the baked manifest.
 *
 * Suppression and card are one decision: a root whose switch holds yields a card AND is marked in
 * `switched`, so the cut skips its clusters in the same breath. A card without the skip would draw
 * the object twice; the skip without the card would be a hole (CONTRIBUTING, Streaming rule 1).
 */
import { hypot3 } from '../math/primitives/hypot.ts';
import { transformAffinePoint } from '../math/primitives/vector.ts';
import { maxStretch } from '../math/projectionOracles.ts';
import {
  impostorMeshBaked,
  type ImpostorMap,
  type ImpostorMaps,
  type ImpostorMesh,
  type ImpostorSection,
} from '../contracts/impostor.ts';
import { drawsImpostor, impostorRadius, impostorSwitchOf } from './switch.ts';

/** What the plan needs of one root: its compiled mesh number and the world matrix that places it. */
export interface ImpostorRoot {
  /** Compiled mesh number (`Primitive.mesh`); absent on a root no impostor may replace. */
  mesh?: number;
  /** World matrix of the placement, column-major (`MatrixElements`). */
  world: { elements: ArrayLike<number> };
}

/** One camera-facing card the runtime draws in place of a switched root's clusters. */
export interface ImpostorCard {
  /** Rank of the root it replaces in the plan's `roots`. */
  root: number;
  /** Its compiled mesh number. */
  mesh: number;
  /** The root's world matrix, as given. */
  world: ArrayLike<number>;
  /** World-space pivot, the bounding-sphere centre under the root's world. */
  centre: [number, number, number];
  /** World-space radius `R = objectRadius × the root's world scale`. */
  radius: number;
  /** Frames a side. */
  frames: number;
  /** Whether the frames are upper hemi-octahedral. */
  hemi: boolean;
  /** The three maps the card samples: colour+coverage, normal+depth, packed ORM. */
  maps: { colourCoverage: ImpostorMap; normalDepth: ImpostorMap; orm: ImpostorMap };
}

/** The cut's verdict: the cards to draw, and the roots whose clusters it suppresses. */
export interface ImpostorPlan {
  /** One card per switched root, in root order. */
  cards: ImpostorCard[];
  /** Root ranks the cut suppresses: 1 at a switched root, 0 elsewhere. */
  switched: Uint8Array;
}

/** The section's baked meshes, keyed by their compiled mesh number; refused entries are left out. */
export function impostorBakedByMesh(
  section: ImpostorSection | undefined,
): Map<number, ImpostorMesh & { maps: ImpostorMaps; frames: number; frameSide: number }> {
  const byMesh: BakedByMesh = new Map();
  if (section)
    for (const mesh of section.meshes) if (impostorMeshBaked(mesh)) byMesh.set(mesh.mesh, mesh);
  return byMesh;
}

/** Baked meshes by mesh number: each entry holds the maps, frames and frame side the card reads. */
type BakedByMesh = ReturnType<typeof impostorBakedByMesh>;
/** The same, read by a root's mesh number, which a root no impostor may replace lacks. */
type BakedLookup = ReadonlyMap<number | undefined, NonNullable<ReturnType<BakedByMesh['get']>>>;
const EMPTY_MESHES: BakedLookup = new Map();
/** The section's baked meshes, built once per section: the plan runs every frame, the map does not. */
const bakedBySection = new WeakMap<ImpostorSection, BakedLookup>();
function bakedLookup(section: ImpostorSection | undefined): BakedLookup {
  if (!section) return EMPTY_MESHES;
  let byMesh = bakedBySection.get(section);
  if (!byMesh) bakedBySection.set(section, (byMesh = impostorBakedByMesh(section)));
  return byMesh;
}

/**
 * Plans the impostor tier for one view: every root whose mesh has a baked entry and whose switch
 * holds yields a card and is marked suppressed. `view` maps world to view space (column-major) and
 * `focalPixels` is the engine's one focal length in pixels at the image's viewport.
 */
export function planImpostors(
  roots: readonly ImpostorRoot[],
  section: ImpostorSection | undefined,
  view: ArrayLike<number>,
  focalPixels: number,
): ImpostorPlan {
  const switched = new Uint8Array(roots.length),
    cards: ImpostorCard[] = [];
  const byMesh = bakedLookup(section);
  const point = new Float64Array(3);
  for (let rank = 0; rank < roots.length; rank++) {
    const root = roots[rank],
      entry = byMesh.get(root.mesh);
    if (!entry) continue;
    const input = impostorSwitchOf(entry, maxStretch(root.world.elements));
    if (!input) continue;
    const world = root.world.elements,
      centre: [number, number, number] = [world[12], world[13], world[14]];
    transformAffinePoint(point, view, centre[0], centre[1], centre[2]);
    if (!drawsImpostor(input, focalPixels, hypot3(point[0], point[1], point[2]))) continue;
    switched[rank] = 1;
    cards.push({
      root: rank,
      mesh: entry.mesh,
      world,
      centre,
      radius: impostorRadius(input.objectRadius, input.maxWorldScale),
      frames: entry.frames,
      hemi: entry.hemi === true,
      maps: entry.maps,
    });
  }
  return { cards, switched };
}
