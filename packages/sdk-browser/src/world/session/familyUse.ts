import { frameCostAuditEnabled } from '../../frame/costAudit.ts'
import { familiesArriving } from '../../host/families.ts'
import { frameFamilies, type Held } from './frameFamilies.ts'
import type { MeasuredWorldOptions } from './options.ts'

/**
 * What the next frame waits for, as for any resource of its scene: the families it draws with
 * still on their way, started now. `undefined` when none is: the frame draws. A frame that waits
 * is not drawn — neither in the session's own loop nor in a host-led one (`world.render`) —, and
 * nothing steps ahead of it: the first frame drawn is the one `develop` drew first.
 */
export const frameWaits = (held: Held) => familiesArriving(frameFamilies(held))

/**
 * The families a session opening on `options` loads with its scene (`prepare.ts`): those its
 * first frame draws with, and the measurement's provenance when a diagnostic channel listens or
 * the frame audit is on. Started at once, awaited before the session opens.
 */
export function sessionFamilies(options: MeasuredWorldOptions, listened: boolean) {
  const names = [...frameFamilies(options)]
  if (listened || frameCostAuditEnabled()) names.push('measurement')
  return familiesArriving(names)
}
