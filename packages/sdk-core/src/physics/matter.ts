import type { Material } from '../world/material/material.ts';
import { DEFAULT_MATTER, PHYSICS_MATERIALS, type PhysicsMatter } from './options.ts';

/**
 * The matter of a body wearing `material` (the first, for a mesh with several): its preset, then
 * its own `density`, `friction` and `restitution` over it.
 */
export function physicsMatterOf(material: Material | Material[]): PhysicsMatter {
  const m = Array.isArray(material) ? material[0] : material;
  const preset = (m?.physics && PHYSICS_MATERIALS[m.physics]) || DEFAULT_MATTER;
  return {
    density: m?.density ?? preset.density,
    friction: m?.friction ?? preset.friction,
    restitution: m?.restitution ?? preset.restitution,
  };
}
