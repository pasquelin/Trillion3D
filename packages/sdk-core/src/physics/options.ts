import { EngineError } from '../contracts/cache.ts';

/** How a body moves: never, by the page (`kinematic`, pushing what it meets), or by the simulation. */
export type PhysicsType = 'static' | 'dynamic' | 'kinematic';

/**
 * A collision shape, when the one inferred from the geometry is not wanted. Sizes are in the
 * object's own frame, before its scale.
 */
export type PhysicsShape =
  | { type: 'box'; halfExtents: readonly [number, number, number] }
  | { type: 'sphere'; radius: number }
  | { type: 'capsule'; halfHeight: number; radius: number }
  | { type: 'cylinder'; halfHeight: number; radius: number }
  | { type: 'triangles' }
  | { type: 'hull' };

/** What `obj.physics` accepts beyond its three words. */
export interface PhysicsBodyOptions {
  /** How the body moves. @defaultValue 'dynamic' */
  type?: PhysicsType;
  /** Mass in kilograms; left out, the material's density times the shape's volume. */
  mass?: number;
  /** The collision shape; left out, inferred from the geometry. */
  shape?: PhysicsShape;
  /** Multiplies the world's gravity for this body; 0 floats. @defaultValue 1 */
  gravityScale?: number;
  /** Reports contacts without colliding: a trigger volume. @defaultValue false */
  sensor?: boolean;
  /** Continuous collision, for fast small bodies that would pass through thin walls. @defaultValue false */
  ccd?: boolean;
  /** Debris: meets the static world only, and is simulated only in range and in view. Capped by
   *  `budget.physics.decorative`. @defaultValue false */
  decorative?: boolean;
  /** Overrides the material's friction, 0 and up. */
  friction?: number;
  /** Overrides the material's restitution (bounciness), 0 to 1. */
  restitution?: number;
}

/** What `obj.physics` may be set to. */
export type PhysicsOption = PhysicsType | PhysicsBodyOptions;

/** Named gravities, in m/s² along −y. */
export const GRAVITY_PRESETS = { earth: 9.81, moon: 1.62, mars: 3.71, none: 0 } as const;
/** A gravity preset's name. */
export type GravityPreset = keyof typeof GRAVITY_PRESETS;

/** The matter a body is made of: density (kg/m³), friction and restitution. */
export interface PhysicsMatter {
  density: number;
  friction: number;
  restitution: number;
}

/** Named matters for `material.physics`, from handbook values rounded. */
export const PHYSICS_MATERIALS = {
  wood: { density: 600, friction: 0.5, restitution: 0.3 },
  metal: { density: 7800, friction: 0.4, restitution: 0.2 },
  rubber: { density: 1100, friction: 0.9, restitution: 0.8 },
  ice: { density: 917, friction: 0.03, restitution: 0.05 },
  stone: { density: 2600, friction: 0.7, restitution: 0.1 },
  glass: { density: 2500, friction: 0.4, restitution: 0.4 },
} as const satisfies Record<string, PhysicsMatter>;
/** A matter preset's name. */
export type PhysicsMaterialPreset = keyof typeof PHYSICS_MATERIALS;

/** Water's density, friction and restitution: what a material that says nothing is made of. */
export const DEFAULT_MATTER: PhysicsMatter = { density: 1000, friction: 0.5, restitution: 0 };

/** The fixed envelopes of a world's physics; never read from the machine. */
export interface PhysicsBudget {
  /** Bodies of every kind at once. */
  bodies: number;
  /** Triangles of every static triangle shape at once. */
  triangles: number;
  /** Decorative bodies at once. */
  decorative: number;
  /** Bytes of the physics module's memory: a hard ceiling, the module cannot grow past it. */
  memoryBytes: number;
}

/** The engine's default physics budgets. */
export const DEFAULT_PHYSICS_BUDGET: Readonly<PhysicsBudget> = Object.freeze({
  bodies: 16384,
  triangles: 2_000_000,
  decorative: 1024,
  memoryBytes: 128 * 1024 * 1024,
});

/** A fixed step of 60 Hz: the simulation's clock, whatever the display's rate. */
export const PHYSICS_STEP = 1 / 60;
/** Steps a late worker may take at once; beyond, the time is dropped (slow motion, never a spiral). */
export const MAX_CATCH_UP_STEPS = 4;

/** Refuses a request past a budget, naming the budget, its limit and the request. */
export function physicsBudgetError(budget: keyof PhysicsBudget, limit: number, requested: number) {
  return new EngineError(
    'PHYSICS_BUDGET',
    `Physics budget "${budget}" exceeded: ${requested} asked, ${limit} allowed (world.budget.physics.${budget}).`,
    { budget, limit, requested },
  );
}
