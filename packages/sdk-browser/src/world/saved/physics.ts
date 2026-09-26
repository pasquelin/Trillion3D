import type { ObjectPhysics } from '../../../../sdk-core/src/physics/objectPhysics.ts';
import { DAMPING } from '../../../../sdk-core/src/physics/layout.ts';
import type { PhysicsOption } from '../../../../sdk-core/src/physics/options.ts';

/**
 * The declaration that makes `body` again, as `mesh.physics` takes it: its type, its mass, shape
 * and matter overrides as they stand now, its damping; a soft body's pins, stretch, bend and
 * pressure. What is left at its default is left out, `Infinity` (a soft body's free bend)
 * included, so the declaration is plain JSON.
 */
export function savedPhysics(body: ObjectPhysics): PhysicsOption {
  const { soft, damping } = body;
  const declared = soft
    ? {
        type: soft.type,
        pins: soft.pins.length ? [...soft.pins] : undefined,
        stretch: soft.stretch || undefined,
        bend: Number.isFinite(soft.bend) ? soft.bend : undefined,
        pressure: soft.type === 'volume' ? soft.pressure : undefined,
        damping: damping.linear === DAMPING ? undefined : { linear: damping.linear },
      }
    : {
        type: body.type,
        shape: body.shape,
        sensor: body.sensor || undefined,
        ccd: body.ccd || undefined,
        decorative: body.decorative || undefined,
        damping:
          damping.linear === DAMPING && damping.angular === DAMPING ? undefined : { ...damping },
      };
  const shared = {
    mass: body.mass,
    gravityScale: body.gravityScale === 1 ? undefined : body.gravityScale,
    friction: body.friction,
    restitution: body.restitution,
  };
  return JSON.parse(JSON.stringify({ ...declared, ...shared })) as PhysicsOption;
}
