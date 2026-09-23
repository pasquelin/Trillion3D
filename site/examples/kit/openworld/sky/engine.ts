/**
 * The engine as the sky sees it. A kit module never imports the engine at run time (the page
 * would bundle a second copy): the page passes its own namespace in, and these are only the
 * types of its public entry point, erased from the bundle. Members the engine does not have
 * yet are added here, each marked as waiting on the engine: the API a user would reach for.
 */
import type * as Engine from '../../../../../packages/sdk-browser/src/index.ts';

type Families = typeof Engine;

/** The engine families the sky uses, as the page imports them from `runtime/engine.js`. */
export type SkyEngine = Pick<
  Families,
  'geometry' | 'buffer' | 'material' | 'object' | 'light' | 'math' | 'blending' | 'side' | 'texture'
> & {
  /** Waiting on the engine: post-processing passes (heat haze, bloom). */
  post?: {
    heatHaze(options: { position: readonly number[]; radius: number; strength: number }): unknown;
    bloom(options: { position: readonly number[]; radius: number; threshold: number }): unknown;
  };
};

/** The world the sky lives in: its scene, camera, canvas, exposure and frame hook. */
export type SkyWorld = Pick<
  ReturnType<Families['createWorld']>,
  'scene' | 'camera' | 'canvas' | 'onFrame' | 'invalidate' | 'exposure'
> & {
  /** Waiting on the engine: a post-processing chain on the world. */
  postProcessing?: { add(pass: unknown): unknown };
};

export type NodeLike = Engine.Object3D;
export type MeshLike = Engine.Mesh;
export type MaterialLike = Engine.Material;
export type GeometryLike = Engine.Geometry & {
  /** Waiting on the engine: `setDrawRange` (a pool draws only its live particles). */
  setDrawRange?(start: number, count: number): unknown;
};
export type LightLike = Engine.Light & {
  /** Waiting on the engine: cascaded shadow settings on a directional light. */
  shadow?: { cascades: number; distance: number };
};
export type ColorLike = Engine.Color;

/** Linear RGB, each channel ≥ 0. */
export type Rgb = readonly [number, number, number];
