import type { DiagnosticMode } from '../../../../sdk-core/src/index.ts';
import type { FamilyName } from '../../host/families.ts';
import type { MeasuredWorldOptions } from './options.ts';

/** What a session's frame draws with, among its options: they are read live, a world adding a
 *  pool, a pass or a guide to the objects it handed in. */
export type Held = Pick<MeasuredWorldOptions, 'particles' | 'effects' | 'guides'>;

const used: FamilyName[] = [];

/**
 * The optional families (`../../host/families.ts`) the next frame of a session draws with: the
 * particles of its pools, the passes of its effect chain, its guides once one is shown, the
 * diagnostic views outside beauty, and the measurement's compositor for an A/B layout (`comparing`).
 * Those the scene's surfaces use — transmission, deformation, impostors — are its engine's,
 * awaited where it prepares them. Read every frame: nothing is allocated.
 */
export function frameFamilies(
  held: Held,
  diagnostic: DiagnosticMode,
  comparing = false,
): readonly FamilyName[] {
  used.length = 0;
  if (held.particles?.length) used.push('particles');
  if (held.effects?.size) used.push('effects');
  if (held.guides?.visibleInstances()) used.push('guides');
  if (diagnostic !== 'beauty') used.push('diagnostics');
  if (comparing) used.push('measurement');
  return used;
}
