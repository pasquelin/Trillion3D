import { ObjectPhysics } from '../../../../sdk-core/src/physics/objectPhysics.ts';
import type { PhysicsOption } from '../../../../sdk-core/src/physics/options.ts';

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
  const { soft, damping } = body;
  const unset = new ObjectPhysics({ type: body.type } as PhysicsOption);
  const still = unset.damping;
  const declared = soft
    ? {
        type: soft.type,
        pins: soft.pins.length ? soft.pins : undefined,
        stretch: kept(soft.stretch, unset.soft!.stretch),
        bend: kept(soft.bend, unset.soft!.bend),
        pressure: kept(soft.pressure, unset.soft!.pressure),
        damping: damping.linear === still.linear ? undefined : { linear: damping.linear },
      }
    : {
        type: body.type,
        shape: body.shape,
        sensor: kept(body.sensor, unset.sensor),
        ccd: kept(body.ccd, unset.ccd),
        decorative: kept(body.decorative, unset.decorative),
        damping:
          damping.linear === still.linear && damping.angular === still.angular
            ? undefined
            : damping,
      };
  return {
    ...declared,
    mass: kept(body.mass, unset.mass),
    gravityScale: kept(body.gravityScale, unset.gravityScale),
    friction: kept(body.friction, unset.friction),
    restitution: kept(body.restitution, unset.restitution),
  } as PhysicsOption;
}
