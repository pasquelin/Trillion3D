/**
 * The contract every part of the open world follows (#332): the world plan, the region modules,
 * the shared props and the runtime data the page reads. Metres, Y up, origin at the map centre,
 * +X east, +Z south. One seed makes the whole world; each part draws from its own sub-seed.
 *
 * The terrain is owned by one module (`plan/`): it builds every tile from one height function,
 * so no seam can appear between regions. A region refines that height inside its own bounds,
 * names the surfaces it wants, and places props, lights, markers and movers.
 */

export type Vec3 = readonly [number, number, number];
export type Rgba = readonly [number, number, number, number];

/** The world's fixed frame; every other number is derived from these or from the plan. */
export const WORLD = {
  size: 8_000,
  tile: 1_000,
  seaLevel: 0,
  peak: 2_000,
  seed: 332,
  /** Published cache envelope, bytes (maintainer's decision, 23 Sept. 2026). */
  cacheBytes: 800 * 1024 * 1024,
} as const;

/**
 * Measured cook costs, 23 Sept. 2026, source.bin excluded: bytes per source triangle (404 MB for
 * the 5.47 M triangle terrain), per placed node (scene tables, 10 k nodes), and per baked ground
 * texel with its mips, lossless and BC7 (3.15 MB for 100 tiles of 164², a 10 km cook).
 */
export const COOK_COST = { bytesPerTriangle: 74, bytesPerNode: 355, bytesPerTexel: 1.17 } as const;

export type RegionName = 'mountains' | 'city' | 'airport' | 'desert' | 'countryside' | 'coast';
export type Biome = RegionName | 'sea';

export type Bounds = { minX: number; minZ: number; maxX: number; maxZ: number };

/** A share of the cache envelope: unique triangles of its own meshes, and placed nodes. */
export type Budget = { triangles: number; nodes: number };

export type RoadClass =
  'highway' | 'secondary' | 'pass' | 'avenue' | 'street' | 'dirt' | 'runway' | 'taxiway';

/** A polyline on the ground (y is the road surface), with a width in metres. */
export type Road = { id: string; class: RoadClass; width: number; points: readonly Vec3[] };
export type River = { id: string; points: readonly Vec3[]; widths: readonly number[] };
export type Bridge = { id: string; road: string; from: Vec3; to: Vec3; width: number };

export type Settlement = {
  id: string;
  kind: 'city' | 'town' | 'village' | 'airport' | 'port' | 'resort';
  region: RegionName;
  centre: Vec3;
  radius: number;
};

/** The seeded, deterministic plan every module reads. Same seed → same plan, same bytes. */
export type WorldPlan = {
  seed: number;
  /** Final ground height at (x, z): global relief, region refinements, road and river cuts. */
  height(x: number, z: number): number;
  /** Which biome owns (x, z), with blend weights inside transition bands (they sum to 1). */
  biome(x: number, z: number): { owner: Biome; weights: Partial<Record<Biome, number>> };
  regions: Record<RegionName, { bounds: Bounds; seed: number; budget: Budget }>;
  roads: readonly Road[];
  rivers: readonly River[];
  bridges: readonly Bridge[];
  settlements: readonly Settlement[];
  /** A stable sub-seed for any named part (`'sky'`, `'traffic'`, `'city/towers'`…). */
  subSeed(name: string): number;
};

/** A surface as glTF carries it: metallic-roughness, optional emission for night lights. */
export type Surface = {
  name: string;
  color: Rgba;
  metalness: number;
  roughness: number;
  emissive?: readonly [number, number, number];
  emissiveStrength?: number;
  alpha?: 'opaque' | 'mask' | 'blend';
  /** Base colour PNG in the source folder, times `color`; covers its mesh once, edge-clamped. */
  texture?: string;
};

/** One material's triangles of a mesh; normals are generated when absent. */
export type MeshPart = {
  surface: Surface;
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array; // TEXCOORD_0, two per vertex
  indices: Uint32Array;
};

/** A mesh written once and placed by many nodes: that is how the engine shares its pages. */
export type PropMesh = { id: string; parts: readonly MeshPart[] };

/** One placed node of a shared mesh. `yaw` in radians about +Y. */
export type Instance = {
  prop: string;
  position: Vec3;
  yaw: number;
  scale?: number | Vec3;
  name?: string;
};

/** A lamp declared on the object that carries it; it reaches the cache's `lights.json`. */
export type LampLight = {
  name: string;
  type: 'point' | 'spot';
  position: Vec3;
  color: readonly [number, number, number];
  /** Candela, as KHR_lights_punctual states it. */
  intensity: number;
  range: number;
  direction?: Vec3;
  cone?: number;
  /** Lit at night only: the page switches it with the day cycle. */
  night: boolean;
};

export type EffectKind =
  | 'sand'
  | 'heat-haze'
  | 'snow-plume'
  | 'waterfall-spray'
  | 'smoke'
  | 'fountain'
  | 'neon-glow'
  | 'jet-exhaust'
  | 'runway-dust'
  | 'birds'
  | 'fireflies'
  | 'road-dust'
  | 'sea-spray'
  | 'lighthouse-beam';

/** On the ground, or on top of a solid prop (roof, gallery, quay) when `deck` says so. */
type Standing = { name: string; position: Vec3; yaw: number; deck?: true };
export type Marker =
  | ({ kind: 'teleport'; pitch?: number } & Standing)
  | ({ kind: 'spawn'; vehicle: 'car' | 'plane' | 'boat' } & Standing)
  | { kind: 'emitter'; effect: EffectKind; name: string; position: Vec3; radius: number };

/** Something the page moves every frame: along a path, or spinning in place. */
export type Mover =
  | {
      kind: 'path';
      name: string;
      model: string;
      points: readonly Vec3[];
      speed: number;
      loop: boolean;
    }
  | { kind: 'spin'; name: string; model: string; position: Vec3; axis: Vec3; rpm: number }
  | { kind: 'beacon'; name: string; position: Vec3; rpm: number; range: number };

/** A region: the relief and ground the plan composes first, then what `generate` places. */
export type RegionModule = {
  name: RegionName;
  /** Added to the global relief inside the region, faded by `plan.biome` weights at borders. */
  refine?(x: number, z: number, base: number): number;
  /** The ground surfaces the terrain paints for this biome, by altitude and slope (0–1). */
  ground: readonly GroundLayer[];
  generate(plan: WorldPlan): RegionOutput;
};

export type GroundLayer = {
  surface: Surface;
  maxSlope?: number;
  minHeight?: number;
  maxHeight?: number;
};

/** What one region places. All positions in world space, inside its bounds. */
export type RegionOutput = {
  props: readonly PropMesh[];
  instances: readonly Instance[];
  lights: readonly LampLight[];
  markers: readonly Marker[];
  movers: readonly Mover[];
  /** Local roads the region adds (streets, taxiways) on top of the plan's network. */
  roads: readonly Road[];
};

/**
 * The data the page reads beside the cache (`world.json`), and the per-tile heights for physics
 * (`heights/<tx>_<tz>.bin`: Float32, `(samples+1)²` values, row-major from the tile's -X,-Z corner).
 */
export type WorldRuntimeData = {
  seed: number;
  size: number;
  tile: number;
  heightSamples: number;
  roads: readonly Road[];
  settlements: readonly Settlement[];
  markers: readonly Marker[];
  movers: readonly Mover[];
  lights: readonly LampLight[];
};
