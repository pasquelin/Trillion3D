import { ObjectPhysics } from '../../../../sdk-core/src/physics/objectPhysics.ts';
import type {
  PhysicsBodyOptions,
  PhysicsOption,
} from '../../../../sdk-core/src/physics/options.ts';
import type { SoftBodyOptions } from '../../../../sdk-core/src/physics/soft.ts';

/** `value`, or `undefined` where it is `fallback`: a default is left out. */
const kept = <T>(value: T, fallback: T) => (value === fallback ? undefined : value);

/**
 * The declaration that makes `body` again, as `mesh.physics` takes it: its type, its mass, shape
 * and matter overrides as they stand now, its damping; a soft body's pins, stretch, bend and
 * pressure. Each is left out where it is what a body declaring only its type gets — the defaults
 * are the engine's own, read from such a body, never written here again —, a free bend's
 * `Infinity` included, so `plain` makes it JSON.
 */
export function savedPhysics(body: ObjectPhysics): PhysicsOption {
  const { type, soft, damping } = body;
  const unset = new ObjectPhysics({ type });
  const still = unset.damping;
  const common = {
    mass: kept(body.mass, unset.mass),
    gravityScale: kept(body.gravityScale, unset.gravityScale),
    friction: kept(body.friction, unset.friction),
    restitution: kept(body.restitution, unset.restitution),
  };
  if (soft) {
    const { stretch, bend, pressure } = unset.soft!;
    return {
      type: soft.type,
      pins: soft.pins.length ? soft.pins : undefined,
      stretch: kept(soft.stretch, stretch),
      bend: kept(soft.bend, bend),
      pressure: kept(soft.pressure, pressure),
      damping: damping.linear === still.linear ? undefined : { linear: damping.linear },
      ...common,
    } satisfies SoftBodyOptions;
  }
  return {
    type: type as PhysicsBodyOptions['type'],
    shape: body.shape,
    sensor: kept(body.sensor, unset.sensor),
    ccd: kept(body.ccd, unset.ccd),
    decorative: kept(body.decorative, unset.decorative),
    damping:
      damping.linear === still.linear && damping.angular === still.angular ? undefined : damping,
    ...common,
  } satisfies PhysicsBodyOptions;
}
