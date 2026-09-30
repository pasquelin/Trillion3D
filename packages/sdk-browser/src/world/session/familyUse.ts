import type { DiagnosticMode } from '../../../../sdk-core/src/index.ts';
import { frameCostAuditEnabled } from '../../frame/costAudit.ts';
import { familiesArriving } from '../../host/families.ts';
import { frameFamilies, type Held } from './frameFamilies.ts';
import type { MeasuredWorldOptions } from './options.ts';

/**
 * What the next frame waits for, as for any resource of its scene: the families it draws with
 * still on their way, started now. `undefined` when none is: the frame draws. A frame that waits
 * is not drawn — neither in the session's own loop nor in a host-led one (`world.render`) —, and
 * nothing steps ahead of it: the first frame drawn is the one `develop` drew first.
 */
export const frameWaits = (held: Held, diagnostic: DiagnosticMode, comparing = false) =>
  familiesArriving(frameFamilies(held, diagnostic, comparing));

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

/**
 * A session without its own loop draws on each `invalidate`, as `develop` did; a frame that waits
 * for a family on its way (`pending`) is drawn instead once it has arrived, once however many
 * invalidations it heard meanwhile, and not at all by a session `closed` by then.
 */
export function drawnOnArrival(
  pending: () => Promise<void> | undefined,
  draw: () => unknown,
  closed: () => boolean,
) {
  let waiting = false;
  return function invalidate() {
    const families = pending();
    if (!families) return void draw();
    if (waiting) return;
    waiting = true;
    void families.then(() => ((waiting = false), closed() || invalidate()));
  };
}
