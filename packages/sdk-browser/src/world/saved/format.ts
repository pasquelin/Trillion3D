import type { SceneFog } from '../../../../sdk-core/src/scene/core/fog.ts';
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts';

/** The name a saved scene carries, and the one version of its layout this runtime reads. */
export const SCENE_FORMAT = 'trillion3d-scene';
export const SCENE_FORMAT_VERSION = 1;

/** A geometry: the family call that built it, or its vertices when no call can build it again. */
export interface SavedGeometry {
  /** The family member and every argument it was built with. */
  recipe?: { type: string; args: (number | boolean)[] };
  /** Each per-vertex list, when no call builds the shape again. */
  attributes?: Record<
    string,
    { itemSize: number; array: number[]; type: string; normalized: boolean }
  >;
  /** Which vertices make each triangle. */
  index?: number[];
  /** Index ranges drawn with one material each. */
  groups?: { start: number; count: number; materialIndex: number }[];
}

/** A material: its kind and every parameter, colours as linear `[r, g, b]`. */
export interface SavedMaterial {
  /** The kind the material was made as: `'meshStandard'`, `'meshBasic'`… */
  kind: string;
  /** Every parameter by name. */
  parameters: Record<string, unknown>;
}

/** A node: its pose and what it is — a group, a mesh, a light or a loaded model — and below it. */
export interface SavedNode {
  /** What the node is. */
  kind: 'object' | 'group' | 'mesh' | 'light' | 'model';
  /** Its name. */
  name: string;
  /** Where it stands, from its parent. */
  position: number[];
  /** How it is turned, as a quaternion. */
  quaternion: number[];
  /** How it is stretched on each axis. */
  scale: number[];
  /** Whether it is drawn. */
  visible: boolean;
  /** Whether it casts shadows. */
  castShadow: boolean;
  /** Whether shadows fall on it. */
  receiveShadow: boolean;
  /** Its drawing order among see-through things. */
  renderOrder: number;
  /** The page's own data, as JSON. */
  userData: Record<string, unknown>;
  /** The nodes below it, in order. */
  children: SavedNode[];
  /** Ranks in `geometries` and `materials`, how the triangles are read, and a sprite's centre. */
  mesh?: {
    geometry: number;
    material: number | number[];
    primitive: string;
    center?: [number, number];
  };
  /** A light's kind, colours, numbers, aim and probe coefficients. */
  light?: {
    kind: string;
    color: [number, number, number];
    groundColor: [number, number, number];
    values: Record<string, number>;
    target: [number, number, number];
    sh: number[] | null;
  };
  /** A compiled model, by the manifest address it was loaded from: never inlined. */
  model?: { url: string };
}

/** The camera a scene was saved with: its pose, projection and optics. */
export interface SavedCamera {
  /** Perspective or orthographic. */
  projection: 'perspective' | 'orthographic';
  /** Where the eye stands. */
  position: number[];
  /** How the eye is turned. */
  quaternion: number[];
  /** Field, near, far, zoom and box, by name. */
  optics: Record<string, number>;
}

/** A scene as `scene.toJSON` writes it and `scene.fromJSON` reads it: plain JSON. */
export interface SavedScene {
  /** Always `'trillion3d-scene'`. */
  format: typeof SCENE_FORMAT;
  /** The version of this layout; another one is refused. */
  formatVersion: number;
  /** The background colour, or `null`. */
  background: [number, number, number] | null;
  /** The fog, its colour in linear components, or `null`. */
  fog: SceneFog | null;
  /** The camera saved with the scene, or `null`. */
  camera: SavedCamera | null;
  /** Every shape, once, however many meshes wear it. */
  geometries: SavedGeometry[];
  /** Every material, once, however many meshes wear it. */
  materials: SavedMaterial[];
  /** The scene's top nodes, in order. */
  children: SavedNode[];
}

/** Refuses what is not a saved scene of the version this runtime reads, by name. */
export function assertSavedScene(value: unknown): asserts value is SavedScene {
  const saved = value as Partial<SavedScene> | null;
  if (saved?.format !== SCENE_FORMAT || saved.formatVersion !== SCENE_FORMAT_VERSION)
    throw new EngineError(
      'UNSUPPORTED_SCENE_FORMAT',
      `Not a saved scene of version ${SCENE_FORMAT_VERSION}`,
      { format: saved?.format, formatVersion: saved?.formatVersion },
    );
}

/** Refuses a scene holding what a saved scene cannot store. */
export function notSavable(what: string, details: Record<string, unknown> = {}): never {
  throw new EngineError('SCENE_NOT_SAVABLE', `A saved scene cannot store ${what}`, details);
}
