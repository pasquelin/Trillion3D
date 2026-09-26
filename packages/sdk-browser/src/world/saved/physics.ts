import type { ObjectPhysics } from '../../../../sdk-core/src/physics/objectPhysics.ts';
import type { PhysicsOption } from '../../../../sdk-core/src/physics/options.ts';

/**
 * The declaration that makes `body` again, as `mesh.physics` takes it: its type, its mass, shape
 * and matter overrides as they stand now, its damping; a soft body's pins, stretch, bend and
 * pressure. What is left at its default is left out, `Infinity` (a soft body's free bend)
 * included, so the declaration is plain JSON.
 */
export function savedPhysics(body: ObjectPhysics): PhysicsOption {
  const { soft } = body;
  const declared = soft
    ? {
        type: soft.type,
        pins: [...soft.pins],
        stretch: soft.stretch,
        bend: Number.isFinite(soft.bend) ? soft.bend : undefined,
        pressure: soft.pressure,
        damping: { linear: body.damping.linear },
      }
    : {
        type: body.type,
        shape: body.shape,
        sensor: body.sensor,
        ccd: body.ccd,
        decorative: body.decorative,
        damping: { ...body.damping },
      };
  const shared = {
    mass: body.mass,
    gravityScale: body.gravityScale,
    friction: body.friction,
    restitution: body.restitution,
  };
  return JSON.parse(JSON.stringify({ ...declared, ...shared })) as PhysicsOption;
}
