import { EngineError } from './cache.ts';

/** Format of the `impostors` section a runtime reads (#817 part 1, baked by the compiler). */
export const IMPOSTOR_VERSION = 1;

/** One stored level of one atlas map: a lossless PNG object, one per content address. */
export interface ImpostorLevel {
  /** Where the level's bytes are read. */
  url: string;
  /** Fingerprint of its bytes. */
  sha256: string;
  /** Its size. */
  bytes: number;
  /** Its width in texels. */
  width: number;
  /** Its height in texels. */
  height: number;
}
/** One map of the atlas and its mip chain, level 0 first. */
export interface ImpostorMap {
  /** `coverage` for the colour chain, `data` for the others. */
  kind: string;
  /** Every level the bake kept. */
  levels: ImpostorLevel[];
}
/** The three maps a card samples: colour and coverage, normal and depth, packed ORM. */
export interface ImpostorMaps {
  /** Base colour (sRGB) and coverage in alpha. */
  colourCoverage: ImpostorMap;
  /** Object normal as `n·½+½` and depth `D` in alpha. */
  normalDepth: ImpostorMap;
  /** Occlusion, roughness and metallic. */
  orm: ImpostorMap;
}
/** The two baked reference distances, in metres at the manifest's `focalPixels` (#817). */
export interface ImpostorSwitchDepth {
  /** `z_tex`: the frame is at most one texel per pixel from here. */
  texel: number;
  /** `z_tri`: the root outnumbers the pixels it covers from here. */
  triangles: number;
}
/** The compiler's verdict on one drawn mesh: baked, with its atlas, or refused, with its reason. */
export interface ImpostorMesh {
  /** Its compiled mesh number. */
  mesh: number;
  /** Its source mesh number. */
  sourceMesh: number;
  /** Its name. */
  name: string;
  /** How many nodes place it. */
  placements: number;
  /** Whether a material of the mesh cuts its coverage to mask. */
  masked: boolean;
  /** The DAG root's triangles, summed over the mesh's primitives. */
  rootTriangles: number;
  /** Its bounding radius in world units (object radius times the largest placement scale). */
  radius: number;
  /** `baked` or `refused`. */
  status: string;
  /** Mean coverage of the frames, on a `baked` entry: `c` of the switch. */
  coverage?: number;
  /** Whether the frames are upper hemi-octahedral. */
  hemi?: boolean;
  /** Frames a side. */
  frames?: number;
  /** Frame side in texels: `r_f` of the switch. */
  frameSide?: number;
  /** Atlas side in texels (`frames · frameSide`). */
  atlasSide?: number;
  /** Object-space pivot, the bounding-sphere centre. */
  centre?: number[];
  /** Object-space bounding radius, before the placement scale. */
  objectRadius?: number;
  /** Bytes of every stored level. */
  bytes?: number;
  /** The three maps, on a `baked` entry. */
  maps?: ImpostorMaps;
  /** The baked reference distances. */
  switchDepth?: ImpostorSwitchDepth;
  /** Why a mesh was refused: its code. */
  reason?: string;
  /** A sentence giving the numbers that decided a refusal. */
  detail?: string;
}
/** The manifest's `impostors` section: the compiler's verdict on every drawn mesh. */
export interface ImpostorSection {
  /** Format version. */
  version: number;
  /** Frames a side every atlas of the section was baked at. */
  frames: number;
  /** The focal length in pixels the bake judged distances with. */
  focalPixels: number;
  /** Largest atlas side any card holds. */
  textureLimit: number;
  /** How many meshes were baked. */
  baked: number;
  /** How many were refused. */
  refused: number;
  /** Every mesh's verdict, in source order. */
  meshes: ImpostorMesh[];
}

/** Whether a mesh entry carries a drawable atlas: `baked` with its three maps and a frame side. */
export function impostorMeshBaked(
  mesh: ImpostorMesh,
): mesh is ImpostorMesh & { maps: ImpostorMaps; frames: number; frameSide: number } {
  return (
    mesh.status === 'baked' &&
    !!mesh.maps &&
    Number.isInteger(mesh.frames) &&
    (mesh.frames ?? 0) >= 2 &&
    Number.isInteger(mesh.frameSide) &&
    (mesh.frameSide ?? 0) > 0
  );
}

const LEVEL_FIELDS = ['url', 'sha256', 'bytes', 'width', 'height'] as const;
function validLevel(level: unknown): boolean {
  if (!level || typeof level !== 'object' || Array.isArray(level)) return false;
  const value = level as Record<string, unknown>;
  return LEVEL_FIELDS.every((field) => {
    if (field === 'url' || field === 'sha256')
      return typeof value[field] === 'string' && !!value[field];
    return Number.isSafeInteger(value[field]) && (value[field] as number) >= 0;
  });
}
/** A finite number above zero: the switch's `R`, `T` and `c` are positive by construction. */
const positive = (value: unknown): boolean => Number.isFinite(value) && (value as number) > 0;
function validMap(map: unknown): boolean {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return false;
  const value = map as Record<string, unknown>;
  return (
    typeof value.kind === 'string' && Array.isArray(value.levels) && value.levels.every(validLevel)
  );
}
function validMaps(maps: unknown): boolean {
  if (!maps || typeof maps !== 'object' || Array.isArray(maps)) return false;
  const value = maps as Record<string, unknown>;
  return validMap(value.colourCoverage) && validMap(value.normalDepth) && validMap(value.orm);
}

/**
 * A short reason the section cannot be used, or `null`. An absent section is not an error: a cache
 * that predates it draws every mesh in full, as before. A present one is refused as a whole when
 * its version is unknown or a `baked` entry misses the numbers its switch and its card need.
 */
export function validateImpostorSection(section: unknown): string | null {
  if (section === undefined || section === null) return null;
  if (typeof section !== 'object' || Array.isArray(section))
    return 'the impostors section is not an object';
  const value = section as Record<string, unknown>;
  if (value.version !== IMPOSTOR_VERSION)
    return `impostor version ${String(value.version)} where ${IMPOSTOR_VERSION} is expected`;
  if (!Number.isInteger(value.frames) || (value.frames as number) < 2)
    return 'the impostors section has no frame count';
  if (!Array.isArray(value.meshes)) return 'the impostors section has no mesh list';
  for (const entry of value.meshes as ImpostorMesh[]) {
    if (entry.status !== 'baked') continue;
    if (!validMaps(entry.maps)) return `mesh ${entry.mesh} baked without its three maps`;
    if (!Number.isInteger(entry.frames) || (entry.frames as number) < 2)
      return `mesh ${entry.mesh} baked without a frame count`;
    if (!Number.isInteger(entry.frameSide) || (entry.frameSide as number) <= 0)
      return `mesh ${entry.mesh} baked without a frame side`;
    if (!positive(entry.objectRadius)) return `mesh ${entry.mesh} baked without its object radius`;
    if (!positive(entry.rootTriangles))
      return `mesh ${entry.mesh} baked without a root triangle count`;
    if (!positive(entry.coverage)) return `mesh ${entry.mesh} baked without its coverage`;
  }
  return null;
}

/** Throws the named cache refusal the section carries, or returns it unchanged. */
export function assertImpostorSection(section: unknown): ImpostorSection | undefined {
  const problem = validateImpostorSection(section);
  if (problem) throw new EngineError('UNSUPPORTED_FORMAT', `Cannot read impostors: ${problem}`, {});
  return section as ImpostorSection | undefined;
}
