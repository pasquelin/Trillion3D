/**
 * What the play layer reads of the engine and of the page. The kit never imports the engine (a
 * second copy would be bundled): the page passes its families in, and these structural types
 * name the members the layer calls.
 */
import type {
  Marker,
  Mover,
  Road,
  Settlement,
  Surface,
  Vec3,
  WorldRuntimeData,
} from '../../../../../scripts/docs/examples/openworld/plan/contract.ts';

export type { Marker, Mover, Road, Settlement, Surface, Vec3 };

interface XYZ {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): unknown;
}

export interface Node3 {
  position: XYZ;
  quaternion: { set(x: number, y: number, z: number, w: number): unknown };
  scale: XYZ;
  visible: boolean;
  add(...nodes: Node3[]): unknown;
  remove(...nodes: Node3[]): unknown;
}

export interface SpotNode extends Node3 {
  intensity: number;
  target: Node3;
}

export interface CameraNode extends Node3 {
  fov: number;
  near: number;
  far: number;
}

type Color = readonly [number, number, number];

/** The engine families the play layer builds with, passed in by the page. */
export interface Engine {
  geometry: {
    box(width: number, height: number, depth: number): unknown;
    cylinder(top: number, bottom: number, height: number, segments?: number): unknown;
    sphere(radius: number, width?: number, height?: number): unknown;
    cone(radius: number, height: number, segments?: number): unknown;
  };
  material: {
    meshStandard(parameters: {
      color?: Color;
      metalness?: number;
      roughness?: number;
      emissive?: Color;
      emissiveIntensity?: number;
      transparent?: boolean;
      opacity?: number;
    }): unknown;
  };
  object: { mesh(geometry: unknown, material: unknown): Node3; group(): Node3 };
  light: {
    spot(parameters: {
      color?: Color;
      intensity?: number;
      distance?: number;
      angle?: number;
      penumbra?: number;
      position?: Vec3;
      target?: Vec3;
      castShadow?: boolean;
    }): SpotNode;
  };
}

/** The world the play layer drives: its canvas for input, its camera, its scene and its loop. */
export interface PlayWorld {
  canvas: HTMLCanvasElement;
  camera: CameraNode;
  scene: Node3;
  onFrame(hook: (frame: { delta: number }) => void): unknown;
  invalidate(): void;
}

/**
 * One part of a model, as the props generator describes it (JSON-able): a primitive `shape` of
 * `size` (box: width, height, depth; cylinder and cone: diameter, height, diameter; sphere:
 * diameter on each axis), placed at `position` and turned by `rotation` (radians, XYZ).
 * Until the props generator ships its `vehicleSpecs`, this is the play layer's own shape of it.
 */
export type ModelPart = {
  shape: 'box' | 'cylinder' | 'cone' | 'sphere';
  size: Vec3;
  position: Vec3;
  rotation?: Vec3;
  surface: Surface;
};

export type Wheel = { position: Vec3; radius: number; width: number; steer: boolean };

/** A model with its anchors: where wheels turn, where the eye sits, where the lamps shine. */
export type ModelSpec = {
  parts: readonly ModelPart[];
  anchors?: {
    wheels?: readonly Wheel[];
    eye?: Vec3;
    headlights?: readonly Vec3[];
    propeller?: { position: Vec3; radius: number };
  };
  /** Kilograms, for a model the physics drives. */
  mass?: number;
  /** Along a path, whether it pitches with the slope (`path`, an aircraft) or stays upright. */
  follow?: 'path' | 'upright';
};

export type Mode = 'foot' | 'car' | 'plane';

export type PlayOptions = {
  world: PlayWorld;
  engine: Engine;
  data: WorldRuntimeData;
  /**
   * Where tile (tx, tz)'s heights are, `{tx}` and `{tz}` replaced by its indices
   * (`tx = floor((x + size / 2) / tile)`), e.g. `'../assets/openworld/heights/{tx}_{tz}.bin'`.
   * Resolved against the page; the worker fetches it.
   */
  heights: string;
  /**
   * Where tile (tx, tz)'s solid placements are, as JSON `ColliderInstance[]`, beside a `props/`
   * folder of their collision meshes (`collision.ts`); none when omitted.
   */
  colliders?: string;
  /** Models by name: `car` and `plane` for the player, `traffic` for the traffic (the car
   * when absent), `boat`, `rotor` and `cabin` for the movers, any mover's `model`. */
  models?: Readonly<Record<string, ModelSpec>>;
  /** Radius of the simulated area around the player, metres (2 500 by default). */
  radius?: number;
  /** Traffic cars and pedestrians kept around the player (40 and 60 by default). */
  traffic?: number;
  pedestrians?: number;
  /** Where the worker and Jolt are served; by default beside this module in `runtime/`. */
  urls?: { worker?: string; jolt?: string };
};
