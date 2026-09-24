import { createWorldNotices } from '../diagnostic/worldNotices.ts';
import { DIAGNOSTICS, type EngineError } from '../../../../sdk-core/src/index.ts';
import type { MeasuredWorld } from '../session/explorer.ts';
import { engineErrorOf } from '../../../../sdk-core/src/contracts/errorCodes.ts';

export { worldControlsHandle } from './worldControlsHandle.ts';

/** The modes a page may name: every diagnostic the engine offers, and `triangles`. */
const WORLD_MODES = [
  ...Object.entries(DIAGNOSTICS).flatMap(([name, { available }]) => (available ? [name] : [])),
  'triangles',
];

/**
 * `world.diagnostic`: the view mode, applied to every session the world opens, and the world's
 * own channel, whose notices reach every page channel (`worldNotices.ts`). A mode the engine
 * does not know, or one the session in place refuses, is said once on the console and ignored:
 * the view keeps the mode it had, and a session opening later never inherits it.
 */
export function worldDiagnostic(explorer: () => MeasuredWorld | null) {
  let mode = 'beauty',
    sessions = 0,
    error: EngineError | null = null;
  const said = new Set<string>();
  const warn = (text: string) => {
    if (said.has(text)) return;
    said.add(text);
    console.warn(`[trillion3d] world.diagnostic.mode: ${text}`);
  };
  // `triangles` is the page's word for the per-triangle view, which the engine names `wireframe`
  // (one colour per submitted triangle, `triangleDiagnostic.ts`).
  const engineMode = (name: string) => (name === 'triangles' ? 'wireframe' : name) as never;
  /** Puts `name` on `session`; false, said on the console, when the session refuses it. */
  const put = (session: MeasuredWorld, name: string) => {
    try {
      session.setDiagnostic(engineMode(name));
      return true;
    } catch (error) {
      warn(`'${name}' refused by this session (${(error as Error).message})`);
      return false;
    }
  };
  const handle = {
    /** The view mode: `'beauty'` for the normal image, or a mode that shows how the engine works. */
    get mode() {
      return mode;
    },
    set mode(next: string) {
      if (!WORLD_MODES.includes(next)) {
        warn(`unknown mode ${JSON.stringify(next)}; one of ${WORLD_MODES.join(', ')}`);
        return;
      }
      const session = explorer();
      if (!session || put(session, next)) mode = next;
    },
    /** Sessions the world has opened so far: a change that reopens one shows here. */
    get sessions() {
      return sessions;
    },
    /** Why the last session could not open, as a named engine error: its `code` is one of those
     *  documented on `EngineError` (`WEBGPU_LOST` when WebGPU lost its device), or
     *  `SESSION_OPEN_FAILED` for a reason without one. An `EngineError` of a documented code is
     *  the one thrown; any other error is converted, and the error thrown is then in
     *  `details.cause`. `null` from the start of each opening, and when nothing is tried. */
    get error() {
      return error;
    },
    /** Every view mode the current renderer offers. */
    get modes() {
      const current = explorer();
      const modes = current ? Object.keys(current.diagnostics) : ['beauty'];
      return modes.includes('wireframe') ? [...modes, 'triangles'] : modes;
    },
  };
  return {
    /** What the page holds: the view mode, read and written; the sessions opened and why the
     *  last one failed, read only. */
    handle,
    notices: createWorldNotices(),
    /** Puts the mode on a session just opened; the world's own, never the page's. A mode this
     *  session refuses falls back to `beauty`, so an opening never fails on it. */
    apply(opened: MeasuredWorld) {
      sessions++;
      if (mode !== 'beauty' && !put(opened, mode)) mode = 'beauty';
    },
    /** A session that could not open, or a scene that could not resolve: named on the handle and
     *  said on the console with the error thrown, stack included. An engine error is kept as it
     *  is, and a bare documented code — the `WEBGPU_LOST` of the WebGPU renderer — becomes that
     *  code; anything else is `SESSION_OPEN_FAILED`. */
    failed(cause: unknown) {
      error = engineErrorOf(cause, 'SESSION_OPEN_FAILED', "The world's session failed to open");
      console.error('World session failed', cause);
    },
    /** A session is about to open, or none is tried: a failure that may no longer hold is no
     *  longer shown. */
    opening() {
      error = null;
    },
  };
}
