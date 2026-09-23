import type { ModelSpec, ModelPart, Surface } from './types.ts';

/**
 * The play layer's own models, used until the props generator's `vehicleSpecs` reach
 * `world.json` (a page's `models` replace these by name). Plain data in the shape the props
 * generator writes: parts of primitives with surfaces, and anchors. Nose to local -Z.
 */
const paint = (
  name: string,
  color: [number, number, number],
  metalness = 0.4,
  roughness = 0.35,
): Surface => ({
  name,
  color: [...color, 1],
  metalness,
  roughness,
});
const glass = paint('glass', [0.05, 0.07, 0.09], 0.1, 0.05);
const rubber = paint('rubber', [0.03, 0.03, 0.03], 0, 0.9);
const white = paint('white', [0.85, 0.85, 0.82], 0.1, 0.5);
const lamp = {
  ...paint('lamp', [1, 0.95, 0.8], 0, 0.3),
  emissive: [1, 0.9, 0.7] as const,
  emissiveStrength: 4,
};

const part = (
  shape: ModelPart['shape'],
  size: ModelPart['size'],
  position: ModelPart['position'],
  surface: Surface,
  rotation?: ModelPart['rotation'],
): ModelPart =>
  rotation ? { shape, size, position, surface, rotation } : { shape, size, position, surface };

const wheel = (x: number, z: number, steer: boolean) => ({
  position: [x, -0.1, z] as const,
  radius: 0.35,
  width: 0.25,
  steer,
});

const CAR_SPEC: ModelSpec = {
  parts: [
    part('box', [1.8, 0.6, 4.4], [0, -0.05, 0], paint('paint', [0.55, 0.05, 0.04])),
    part('box', [1.6, 0.55, 2.2], [0, 0.5, 0.25], paint('paint', [0.55, 0.05, 0.04])),
    part('box', [1.62, 0.4, 2.0], [0, 0.52, 0.25], glass),
    part('box', [0.3, 0.12, 0.05], [-0.6, 0.05, -2.2], lamp),
    part('box', [0.3, 0.12, 0.05], [0.6, 0.05, -2.2], lamp),
  ],
  anchors: {
    wheels: [
      wheel(-0.8, -1.3, true),
      wheel(0.8, -1.3, true),
      wheel(-0.8, 1.3, false),
      wheel(0.8, 1.3, false),
    ],
    eye: [-0.35, 0.75, 0.2],
    headlights: [
      [-0.6, 0.05, -2.25],
      [0.6, 0.05, -2.25],
    ],
  },
  mass: 1400,
};

const PLANE_SPEC: ModelSpec = {
  parts: [
    part('box', [1.2, 1.3, 8], [0, 0, 0], white),
    part('box', [11, 0.15, 1.6], [0, 0.5, -0.6], white),
    part('box', [3.6, 0.1, 1], [0, 0.2, 3.6], white),
    part('box', [0.1, 1.5, 1.2], [0, 1, 3.6], paint('stripe', [0.05, 0.2, 0.6])),
    part('box', [1, 0.6, 1.6], [0, 0.8, -1.2], glass),
    part('cylinder', [0.08, 1.2, 0.08], [-1.2, -0.8, -0.8], rubber),
    part('cylinder', [0.08, 1.2, 0.08], [1.2, -0.8, -0.8], rubber),
  ],
  anchors: {
    wheels: [
      { position: [-1.2, -1.3, -0.8], radius: 0.3, width: 0.2, steer: false },
      { position: [1.2, -1.3, -0.8], radius: 0.3, width: 0.2, steer: false },
      { position: [0, -1.3, 3.2], radius: 0.2, width: 0.15, steer: true },
    ],
    eye: [0, 0.9, -1],
    propeller: { position: [0, 0, -4.1], radius: 1 },
  },
  follow: 'path',
};

const BOAT_SPEC: ModelSpec = {
  parts: [
    part('box', [3, 1.2, 9], [0, 0.2, 0], white),
    part('box', [2, 1.2, 3], [0, 1.3, 0.8], white),
    part('cylinder', [0.15, 10, 0.15], [0, 5.5, -0.8], paint('mast', [0.4, 0.4, 0.42], 0.8)),
    part('box', [0.05, 7, 3.5], [0, 5.5, 0.9], paint('sail', [0.95, 0.94, 0.9], 0, 0.8)),
  ],
};

/** A wind turbine's rotor: hub and three blades in the plane across its local +Z axis. */
const ROTOR_SPEC: ModelSpec = {
  parts: [
    part('sphere', [2, 2, 2], [0, 0, 0], white),
    ...[0, 1, 2].map((i) => {
      const angle = (i * 2 * Math.PI) / 3;
      return part(
        'box',
        [1.2, 20, 0.3],
        [-Math.sin(angle) * 10.5, Math.cos(angle) * 10.5, 0],
        white,
        [0, 0, angle],
      );
    }),
  ],
};

const CABIN_SPEC: ModelSpec = {
  parts: [
    part('box', [2.4, 2.2, 3], [0, -3, 0], paint('cabin', [0.8, 0.12, 0.1])),
    part('box', [2.45, 0.9, 2.6], [0, -2.6, 0], glass),
    part('cylinder', [0.12, 2.5, 0.12], [0, -0.9, 0], paint('hanger', [0.3, 0.3, 0.3], 0.9)),
  ],
};

export const DEFAULT_MODELS: Readonly<Record<string, ModelSpec>> = {
  car: CAR_SPEC,
  plane: PLANE_SPEC,
  boat: BOAT_SPEC,
  rotor: ROTOR_SPEC,
  cabin: CABIN_SPEC,
};
