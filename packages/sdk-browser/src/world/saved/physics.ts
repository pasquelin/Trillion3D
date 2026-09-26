import { ObjectPhysics } from '../../../../sdk-core/src/physics/objectPhysics.ts';
import type {
  PhysicsBodyOptions,
  PhysicsOption,
} from '../../../../sdk-core/src/physics/options.ts';
import type { SoftBodyOptions } from '../../../../sdk-core/src/physics/soft.ts';
import { notSavable } from './format.ts';

/** `value`, or `undefined` where it is `fallback`: a default is left out. */
const kept = <T>(value: T, fallback: T) => (value === fallback ? undefined : value);

/** The body a declaration of `type` alone makes, once per type: the defaults it is compared to. */
const unsetBodies = new Map<ObjectPhysics['type'], ObjectPhysics>();
const unsetOf = (type: ObjectPhysics['type']) => {
  let unset = unsetBodies.get(type);
  if (!unset) unsetBodies.set(type, (unset = new ObjectPhysics({ type })));
  return unset;
};

/** Refuses a number JSON cannot hold (`Infinity` would come back `null`: another body), by name. */
function refuseInfinite(value: unknown, name: string) {
  if (typeof value === 'number' && !Number.isFinite(value))
    notSavable(`a body's ${name} of ${value}`, { [name]: value });
  if (value && typeof value === 'object')
    for (const [key, part] of Object.entries(value)) refuseInfinite(part, `${name}.${key}`);
}

/**
 * The declaration that makes `body` again, as `mesh.physics` takes it: its type, its mass, shape
 * and matter overrides as they stand now, its damping; a soft body's pins, stretch, bend and
 * pressure. Each is left out where it is what a body declaring only its type gets — the defaults
 * are the engine's own, read from such a body, never written here again —, a free bend's
 * `Infinity` among them. Any other number JSON cannot hold is refused (`SCENE_NOT_SAVABLE`).
 */
export function savedPhysics(body: ObjectPhysics): PhysicsOption {
  const { type, soft, damping } = body;
  const unset = unsetOf(type);
  const still = unset.damping;
  const common = {
    mass: kept(body.mass, unset.mass),
    gravityScale: kept(body.gravityScale, unset.gravityScale),
    friction: kept(body.friction, unset.friction),
    restitution: kept(body.restitution, unset.restitution),
  };
  let declared: PhysicsOption;
  if (soft) {
    const { stretch, bend, pressure } = unset.soft!;
    declared = {
      type: soft.type,
      pins: soft.pins.length ? soft.pins : undefined,
      stretch: kept(soft.stretch, stretch),
      bend: kept(soft.bend, bend),
      pressure: kept(soft.pressure, pressure),
      damping: damping.linear === still.linear ? undefined : { linear: damping.linear },
      ...common,
    } satisfies SoftBodyOptions;
  } else
    declared = {
      type: type as PhysicsBodyOptions['type'],
      shape: body.shape,
      sensor: kept(body.sensor, unset.sensor),
      ccd: kept(body.ccd, unset.ccd),
      decorative: kept(body.decorative, unset.decorative),
      damping:
        damping.linear === still.linear && damping.angular === still.angular ? undefined : damping,
      ...common,
    } satisfies PhysicsBodyOptions;
  for (const [name, value] of Object.entries(declared)) refuseInfinite(value, name);
  return declared;
}
