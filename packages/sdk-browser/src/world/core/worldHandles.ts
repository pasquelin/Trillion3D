import { createWorldNotices } from '../diagnostic/worldNotices.ts'
import { DIAGNOSTICS, type EngineError } from '../../../../sdk-core/src/index.ts'
import type { MeasuredWorld } from '../session/explorer.ts'
import { engineErrorOf } from '../../../../sdk-core/src/contracts/errorCodes.ts'
import { familyRefusals } from '../../host/families.ts'
import { debugMode, setDebugMode } from '../../host/debugMode.ts'

export { worldControlsHandle } from './worldControlsHandle.ts'

/** The modes a page may name: every diagnostic the engine offers, and `triangles`. */
const WORLD_MODES = [
  ...Object.entries(DIAGNOSTICS).flatMap(([name, { available }]) => (available ? [name] : [])),
  'triangles',
]

/**
 * `world.diagnostic`: the view mode, applied to every session the world opens, and the world's
 * own channel, whose notices reach every page channel (`worldNotices.ts`). A mode the engine
 * does not know, or one the session in place refuses, is said once on the console and ignored:
 * the view keeps the mode it had, and a session opening later never inherits it.
 */
export function worldDiagnostic(explorer: () => MeasuredWorld | null, debug?: boolean) {
  if (debug) setDebugMode(true) // `WorldOptions.debug`
  const state: DiagnosticState = {
    explorer,
    mode: 'beauty',
    sessions: 0,
    error: null,
    said: new Set(),
  }
  const notices = createWorldNotices()
  // A family that could not load (`FAMILY_LOAD_FAILED`, `../../host/families.ts`), named here.
  const refused = (cause: EngineError) => {
    state.error = cause
    console.error('[trillion3d] An optional family did not load', cause)
  }
  familyRefusals.add(refused)
  return {
    /** What the page holds: the view mode, read and written; the sessions opened and why the
     *  last one failed, read only. */
    handle: diagnosticHandle(state),
    notices,
    /** The world stopped: its notices close, and it hears no family refusal more. */
    close() {
      familyRefusals.delete(refused)
      notices.close()
    },
    /** Puts the mode on a session just opened; the world's own, never the page's. A mode this
     *  session refuses falls back to `beauty`, so an opening never fails on it. */
    apply(opened: MeasuredWorld) {
      state.sessions++
      if (state.mode !== 'beauty' && !put(state, opened, state.mode)) state.mode = 'beauty'
    },
    /** A session that could not open, or a scene that could not resolve: named on the handle and
     *  said on the console with the error thrown, stack included. An engine error is kept as it
     *  is, and a bare documented code — the `WEBGPU_LOST` of the engine — becomes that
     *  code; anything else is `SESSION_OPEN_FAILED`. */
    failed(cause: unknown) {
      state.error = engineErrorOf(
        cause,
        'SESSION_OPEN_FAILED',
        "The world's session failed to open",
      )
      console.error('World session failed', cause)
    },
    /** A session is about to open, or none is tried: a failure that may no longer hold is no
     *  longer shown. */
    opening() {
      state.error = null
    },
  }
}

/** What `world.diagnostic` holds: the session in place, the mode, the sessions opened, the last
 *  failure, and what was already said on the console. */
type DiagnosticState = {
  explorer: () => MeasuredWorld | null
  mode: string
  sessions: number
  error: EngineError | null
  said: Set<string>
}

function warn({ said }: DiagnosticState, text: string) {
  if (said.has(text)) return
  said.add(text)
  console.warn(`[trillion3d] world.diagnostic.mode: ${text}`)
}

// `triangles` is the page's word for the per-triangle view, which the engine names `wireframe`
// (one colour per submitted triangle).
const engineMode = (name: string) => (name === 'triangles' ? 'wireframe' : name) as never

/** Puts `name` on `session`; false, said on the console, when the session refuses it. */
function put(state: DiagnosticState, session: MeasuredWorld, name: string) {
  try {
    session.setDiagnostic(engineMode(name))
    return true
  } catch (error) {
    warn(state, `'${name}' refused by this session (${(error as Error).message})`)
    return false
  }
}

/** `world.diagnostic` as the page reads and writes it. */
function diagnosticHandle(state: DiagnosticState) {
  return {
    /** The view mode: `'beauty'` for the normal image, or a mode that shows how the engine works. */
    get mode() {
      return state.mode
    },
    set mode(next: string) {
      if (!WORLD_MODES.includes(next)) {
        warn(state, `unknown mode ${JSON.stringify(next)}; one of ${WORLD_MODES.join(', ')}`)
        return
      }
      const session = state.explorer()
      if (!session || put(state, session, next)) state.mode = next
    },
    /** The page's debug mode (`WorldOptions.debug`): the frames are filed into the CPU step
     *  profile and the frame report only in it, from the next frame. */
    get debug() {
      return debugMode()
    },
    set debug(on: boolean) {
      setDebugMode(on)
    },
    /** Sessions the world has opened so far: a change that reopens one shows here. */
    get sessions() {
      return state.sessions
    },
    /** Why the last session could not open, as a named engine error: its `code` is one of those
     *  documented on `EngineError` (`WEBGPU_LOST` when WebGPU lost its device, `FAMILY_LOAD_FAILED`
     *  when an optional family did not load, then too), or `SESSION_OPEN_FAILED` for a reason
     *  without one. An `EngineError` of a documented code is
     *  the one thrown; any other error is converted, and the error thrown is then in
     *  `details.cause`. `null` from the start of each opening, and when nothing is tried. */
    get error() {
      return state.error
    },
    /** Every view mode the engine offers. */
    get modes() {
      const current = state.explorer()
      const modes = current ? Object.keys(current.diagnostics) : ['beauty']
      return modes.includes('wireframe') ? [...modes, 'triangles'] : modes
    },
  }
}
