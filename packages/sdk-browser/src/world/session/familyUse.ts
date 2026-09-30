import type { DiagnosticMode } from '../../../../sdk-core/src/index.ts';
import { frameCostAuditEnabled } from '../../frame/costAudit.ts';
import { familiesArriving, type FamilyName } from '../../host/families.ts';
import type { MeasuredWorldOptions } from './options.ts';

/** What a session's frame draws with, among its options: they are read live, a world adding a
 *  pool, a pass or a guide to the objects it handed in. */
type Held = Pick<MeasuredWorldOptions, 'particles' | 'effects' | 'guides'>;

const used: FamilyName[] = [];

/**
 * The optional families (`../../host/families.ts`) the next frame of a session draws with: the
 * particles of its pools, the passes of its effect chain, its guides once one is shown, and the
 * diagnostic views outside beauty. Those the scene's surfaces use — transmission, deformation —
 * are its engine's, awaited where it prepares them. Read every frame: nothing is allocated.
 */
export function frameFamilies(held: Held, diagnostic: DiagnosticMode): readonly FamilyName[] {
  used.length = 0;
  if (held.particles?.length) used.push('particles');
  if (held.effects?.size) used.push('effects');
  if (held.guides?.visibleInstances()) used.push('guides');
  if (diagnostic !== 'beauty') used.push('diagnostics');
  return used;
}

/**
 * What the next frame waits for, as for any resource of its scene: the families it draws with
 * still on their way, started now. `undefined` when none is: the frame draws. A frame that waits
 * is not drawn — neither in the session's own loop nor in a host-led one (`world.render`) —, and
 * nothing steps ahead of it: the first frame drawn is the one `develop` drew first.
 */
export const frameWaits = (held: Held, diagnostic: DiagnosticMode) =>
  familiesArriving(frameFamilies(held, diagnostic));

/**
 * The families a session opening on `options` loads with its scene (`prepare.ts`): those its
 * first frame draws with, and the measurement's provenance when a diagnostic channel listens or
 * the frame audit is on. Started at once, awaited before the session opens.
 */
export function sessionFamilies(options: MeasuredWorldOptions, listened: boolean) {
  const names = [...frameFamilies(options, 'beauty')];
  if (listened || frameCostAuditEnabled()) names.push('measurement');
  return familiesArriving(names);
}
