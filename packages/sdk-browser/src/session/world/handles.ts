import { createWorldNotices } from '../../diagnostic/world/worldNotices.ts'
import { DIAGNOSTICS, type DiagnosticMode } from '../../../../sdk-core/src/runtime/diagnostics.ts'
import type { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import type { MeasuredWorld } from '../explorer.ts'
import type { FrameInspection } from '../../diagnostic/inspection/types.ts'
import { engineErrorOf } from '../../../../sdk-core/src/contracts/errorCodes.ts'
import { familyRefusals } from '../host/families.ts'
import { debugMode, setDebugMode } from '../host/debugMode.ts'
import { joined } from '../../../../sdk-core/src/runtime/joined.ts'

/** The modes a page may name: every diagnostic the engine offers. */
const WORLD_MODES = Object.entries(DIAGNOSTICS).flatMap(([name, { available }]) =>
  available ? [name] : [],
)

/**
 * `world.diagnostic`: the view mode, applied to every session the world opens, and the world's
 * own channel, whose notices reach every page channel (`worldNotices.ts`). A mode the engine
 * does not know, or one the session in place refuses, is said once on the console and ignored:
 * the view keeps the mode it had, and a session opening later never inherits it.
 */
export function worldDiagnostic(
  explorer: () => MeasuredWorld | null,
  debug?: boolean,
  invalidate: () => void = () => {},
) {
  if (debug) setDebugMode(true) // `WorldOptions.debug`
  const state = newDiagnosticState(explorer, invalidate)
  const notices = createWorldNotices()
  // A family that could not load (`FAMILY_LOAD_FAILED`, `../host/families.ts`), named here.
  const refused = (cause: EngineError) => {
    state.error = cause
    console.error('[trillion3d] An optional family did not load', cause)
  }
  familyRefusals.subscribe(refused)
  return {
    /** What the page holds: the view mode, read and written; the sessions opened and why the
     *  last one failed, read only. */
    handle: diagnosticHandle(state),
    notices,
    /** The world stopped: its notices close, and it hears no family refusal more. */
    close() {
      familyRefusals.unsubscribe(refused)
      notices.close()
      for (const answer of state.awaiting ?? []) answer(null)
      state.awaiting = null
    },
    /** Puts the mode on a session just opened; the world's own, never the page's. A mode this
     *  session refuses falls back to `beauty`, so an opening never fails on it. */
    apply(opened: MeasuredWorld) {
      state.sessions++
      if (state.mode !== 'beauty' && !put(state, opened, state.mode)) state.mode = 'beauty'
      if (state.freeze) opened.freezeCut(true)
      for (const answer of state.awaiting?.splice(0) ?? []) answer(opened.inspectFrame())
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
  /** Asks the world for a frame. */
  invalidate: () => void
  mode: string
  freeze: boolean
  /** The inspections asked before any session opened, answered by the first that opens; `null`
   *  once the world closed. */
  awaiting: ((inspection: Promise<FrameInspection | null> | null) => void)[] | null
  sessions: number
  error: EngineError | null
  said: Set<string>
}

const newDiagnosticState = (
  explorer: () => MeasuredWorld | null,
  invalidate: () => void,
): DiagnosticState => ({
  explorer,
  invalidate,
  mode: 'beauty',
  freeze: false,
  awaiting: [],
  sessions: 0,
  error: null,
  said: new Set(),
})

function warn({ said }: DiagnosticState, text: string) {
  if (said.has(text)) return
  said.add(text)
  console.warn(`[trillion3d] world.diagnostic.mode: ${text}`)
}

/** Puts `name` on `session`; false, said on the console, when the session refuses it. */
function put(state: DiagnosticState, session: MeasuredWorld, name: string) {
  try {
    session.setDiagnostic(name as DiagnosticMode)
    return true
  } catch (error) {
    warn(state, `'${name}' refused by this session (${(error as Error).message})`)
    return false
  }
}

/** `world.diagnostic` as the page reads and writes it. */
function diagnosticHandle(state: DiagnosticState) {
  return joined(
    {
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
      /** Whether the main view's cut is held at the camera it had when frozen: the image follows
       *  the camera, the cut — its levels, its HLOD, its
       *  frustum, its occlusion, its requests — does not (`../../frame/render/cutFreeze.ts`);
       *  the `xray` view then shows from aside what it submitted. Kept for every session the world
       *  opens. */
      get freeze() {
        return state.freeze
      },
      set freeze(frozen: boolean) {
        state.freeze = frozen
        state.explorer()?.freezeCut(frozen)
        state.invalidate()
      },
      /** What the main view's next image computes, and where, in world metres: its cut's clusters
       *  by level and state, the shadow pages each light maps, the reflections' rays, the lights
       *  and both frustums (`FrameInspection`). Read once, after the next image, which it asks
       *  for — asked before the world's session opened, the first image it draws; `null` once the
       *  session closed or the world was disposed before. Nothing is kept or copied by any frame
       *  until asked. */
      inspect(): Promise<FrameInspection | null> {
        const session = state.explorer()
        const { awaiting } = state
        const read = session
          ? session.inspectFrame()
          : awaiting
            ? new Promise<FrameInspection | null>((answer) => awaiting.push(answer))
            : Promise.resolve(null)
        state.invalidate()
        return read
      },
    },
    diagnosticReads(state),
  )
}

/** What `world.diagnostic` shows of the sessions, read only. */
const diagnosticReads = (state: DiagnosticState) => ({
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
    return current ? Object.keys(current.diagnostics) : ['beauty']
  },
})
