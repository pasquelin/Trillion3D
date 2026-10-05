import type { PageSurface } from '../../page/surface.ts';

/**
 * True when a blended surface casts at all: asked to (`transparentShadow`; unasked, see-through
 * casts nothing), drawn over what is behind
 * it (normal blending), and stopping some light. Additive stops none; transmissive
 * tints what crosses it on this same layer; fully transparent stops nothing: no caster row.
 */
export const castsBlendShadow = (s: PageSurface) =>
  s.transparentShadow && s.blending === 'normal' && s.opacity > 0;
