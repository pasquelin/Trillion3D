import { createDiagnosticChannel } from '../../diagnostic/channel.ts';
import type { BackendDiagnostic } from '../../backend/types.ts';
import { effectTargetExcess, type BudgetCanvas } from '../../residency/memoryBudget.ts';

/** The page channels open now (`diagnostic.createChannel`): every world notice reaches each. */
const listeners = new Set<(notice: BackendDiagnostic) => void>();

/** Hands every world notice to `listener` until the returned function is called. */
export function listenWorldNotices(listener: (notice: BackendDiagnostic) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A world's channel (`createWorldNotices`): what its tables folded is said there once. */
export type WorldNotices = ReturnType<typeof createWorldNotices>;

/**
 * A world's diagnostic channel (`createDiagnosticChannel`): what the world itself has to say of
 * the scene a page built, delivered off the frame to the page channels open at the time. A
 * notice is said once per world and kind, never per frame.
 */
export function createWorldNotices() {
  const channel = createDiagnosticChannel(
    (notice) => {
      for (const listener of listeners) listener(notice);
    },
    { enabled: true, detail: 'summary' },
  );
  const said = new Set<string>();
  const say = (kind: string, message: string, context: Record<string, unknown> = {}) =>
    channel.emit({ phase: kind, message, context });
  return {
    /** Says `message` under `kind`: an event the world lives through, each time. */
    say,
    /** Says `message` under `kind`, unless this world already said something of that kind. */
    once(kind: string, message: string, context: Record<string, unknown> = {}) {
      if (said.has(kind)) return;
      said.add(kind);
      say(kind, message, context);
    },
    close: () => channel.close(),
  };
}

/**
 * The tables' notice: `folded` geometry objects or materials of a content another had already
 * brought, each created on its own where one could have been shared. Said once, at the end of the
 * burst that folded them, with the count of that moment.
 */
export function noticeFolds(
  notices: WorldNotices,
  folded: { geometries: number; materials: number },
) {
  for (const [kind, count] of Object.entries(folded))
    if (count > 0)
      notices.once(
        `world-duplicate-${kind}`,
        `${count} ${kind} were created with the content of another — share one: create it ` +
          `once and give it to every mesh that wears it`,
        { kind, count },
      );
}

/**
 * Says on the world's channel by how many bytes the effect chain's targets on the `drawn` canvas
 * pass the reserve of the declared one (`effectTargetExcess`), each time that excess grows. The
 * chain still draws the whole image, at full resolution: nothing is shrunk to fit the budget.
 */
export function noticeEffectBudget(
  budget: { readonly canvas: BudgetCanvas },
  drawn: { readonly width: number; readonly height: number },
  chain: { readonly size: number },
  notices: Pick<WorldNotices, 'say'>,
) {
  let said = 0;
  return () => {
    const { canvas } = budget;
    const excess = chain.size ? effectTargetExcess(drawn.width, drawn.height, canvas) : 0;
    if (excess <= said) {
      if (!excess) said = 0;
      return;
    }
    said = excess;
    const { width, height } = drawn;
    notices.say(
      'effect-targets-over-budget',
      `effect targets over budget: ${excess} bytes past the reserve of the declared ` +
        `${canvas.width} × ${canvas.height} canvas, drawn at ${width} × ${height}`,
      { excess, width, height, declared: canvas },
    );
  };
}
