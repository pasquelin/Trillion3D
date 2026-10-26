import type {
  CompilerEvent,
  ProgressPointer,
  ProgressStream,
  TerminalProgress,
  TerminalProgressOptions,
} from '../compiler/contracts.ts'
import { messageTally } from './messageTally.mts'
import { describeMessage } from '../messages/catalogue.mts'
import { clamp } from '../../../math/src/scalar/reals.ts'

/**
 * Terminal progress for compiler jobs: one live line per job on a TTY (spinner, bar, phase, elapsed),
 * one plain line per phase change elsewhere. Built on the `ratio` every compiler event carries, so a
 * host needs no knowledge of the phases. Pass `progress.event` as `onProgress` (or `onEvent` for batches).
 */
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const mb = (bytes: unknown) => `${(Number(bytes ?? 0) / 1048576).toFixed(0)} MB`
type PhaseState = { primitives: number; primitivesTotal: number }
const PHASES: Record<string, (event: CompilerEvent, state: PhaseState) => string> = {
  accepted: () => 'starting',
  'import-source': (e) => {
    const steps: Record<string, string> = {
      parse: `reading ${e.file ?? 'source'} ${mb(e.completed)}/${mb(e.total)}`,
      meshes: `converting meshes ${e.completed}/${e.total}`,
      write: `writing glTF ${mb(e.bytes)}`,
      reused: 'import reused',
      complete: 'import done',
    }
    return steps[e.step ?? ''] ?? 'importing'
  },
  import: () => 'source geometry written',
  primitive: (e, s) =>
    `clustering ${s.primitives}${s.primitivesTotal ? `/${s.primitivesTotal}` : ''} primitives`,
  bootstrap: (e) => `root bundles ${e.completed}/${e.total}`,
  // A folder already holding the product is proven, then kept: no clustering line follows.
  reuse: (e) =>
    Number(e.completed ?? 0) > 0
      ? `reused ${e.objects} objects (${mb(e.objectBytes)} proven)`
      : `rebuilding: ${e.reason}`,
  prune: (e) => `pruning cache (${e.removedKeys} keys, ${mb(e.removedBytes)})`,
  complete: () => 'writing pointer',
}
const clip = (text: string, width: number) => {
  const chars = [...text]
  return chars.length > width ? `${chars.slice(0, Math.max(1, width - 1)).join('')}…` : text
}
function summaryOf(pointer?: ProgressPointer) {
  if (!pointer) return 'ready'
  const parts = []
  if (typeof pointer.selectedTriangles === 'number')
    parts.push(`${pointer.selectedTriangles.toLocaleString()} triangles`)
  if (typeof pointer.primitives === 'number') parts.push(`${pointer.primitives} primitives`)
  if (pointer.metrics?.wallMs) parts.push(`${Math.round(pointer.metrics.wallMs)} ms`)
  return parts.join(', ') || 'ready'
}
/** What a job's line shows and keeps between events. */
interface ProgressState extends PhaseState {
  ratio: number
  phase: string
  text: string
  frame: number
  lastKey: string
  timer: ReturnType<typeof setInterval> | null
  finished: boolean
}
const initialState = (): ProgressState => ({
  ratio: 0,
  phase: '',
  text: 'waiting',
  primitives: 0,
  primitivesTotal: 0,
  frame: 0,
  lastKey: '',
  timer: null,
  finished: false,
})
/** The bar for `ratio` over `width` cells, with its percentage. */
const barOf = (ratio: number, width: number) => {
  const filled = Math.round(ratio * width)
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${String(Math.round(ratio * 100)).padStart(3)}%`
}
/** Takes one compiler event into the state: the ratio, the primitive counts, the phase and its text. */
function advance(state: ProgressState, event: CompilerEvent) {
  if (typeof event.ratio === 'number') state.ratio = clamp(event.ratio, state.ratio, 1)
  if (event.phase === 'import' && typeof event.primitives === 'number')
    state.primitivesTotal = event.primitives
  if (event.phase === 'primitive') state.primitives += 1
  state.phase = event.phase ?? event.event ?? ''
  const describe = PHASES[state.phase]
  if (describe) state.text = describe(event, state)
}
const elapsedSince = (started: number) => `${((performance.now() - started) / 1000).toFixed(1)}s`
/** What a job's line is made of besides its state. */
interface LineSpec {
  label: string
  index: number
  total: number
  width: number
  started: number
}
/** The line to draw in `columns` characters. Fixed parts (spinner, index, bar, elapsed) always fit;
 *  only the phase text yields to a narrow terminal. */
function lineOf(state: ProgressState, spec: LineSpec, columns: number) {
  const { label, index, total, width, started } = spec
  const head = `${SPINNER[state.frame++ % SPINNER.length]} ${index + 1}/${total} ${label} ${barOf(state.ratio, width)} `
  const tail = ` ${elapsedSince(started)}`
  return head + clip(state.text, Math.max(1, columns - [...head].length - [...tail].length)) + tail
}
/** Draws the line: over itself on a terminal, a new line on each change of phase elsewhere. */
function drawState(
  state: ProgressState,
  stream: ProgressStream,
  line: (columns: number) => string,
) {
  if (state.finished) return
  if (stream.isTTY) stream.write(`\r\x1b[K${line(Math.max(20, (stream.columns ?? 80) - 1))}`)
  else {
    const key = `${state.phase}:${state.text.split(' ')[0]}`
    if (key !== state.lastKey) {
      stream.write(`${line(Infinity)}\n`)
      state.lastKey = key
    }
  }
}
function stopTimer(state: ProgressState) {
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = null
  }
}
/** A progress bar in the terminal that follows the compiler's events. */
export function createTerminalProgress({
  label = 'job',
  index = 0,
  total = 1,
  stream = process.stderr,
  width = 24,
  interval = 100,
  verbose = false,
}: TerminalProgressOptions = {}): TerminalProgress {
  const tty = Boolean(stream.isTTY)
  const started = performance.now()
  const state = initialState()
  const spec = { label, index, total, width, started }
  const elapsed = () => elapsedSince(started)
  const draw = () => drawState(state, stream, (columns) => lineOf(state, spec, columns))
  // A line that stays: the bar is erased first on a terminal, written as-is elsewhere.
  const persist = (text: string) => stream.write(`${tty ? '\r\x1b[K' : ''}${text}\n`)
  const messages = messageTally(verbose)
  const finish = (mark: string, summary: string) => {
    if (state.finished) return
    stopTimer(state)
    state.finished = true
    persist(`${mark} ${index + 1}/${total} ${label} ${summary} ${elapsed()}`)
  }
  if (tty) {
    state.timer = setInterval(draw, interval)
    state.timer.unref()
  }
  return {
    /** Feed every compiler event here; the line completes or fails by itself. */
    event(event: CompilerEvent) {
      messages.record(event)
      if (event.event === 'complete') {
        for (const line of messages.lines(label)) persist(line)
        finish('✔', summaryOf(event.pointer))
        return
      }
      if (event.event === 'error' || event.event === 'cancelled') {
        finish('✖', describeMessage(event.code ?? 'COMPILER_EXIT', event.message))
        return
      }
      advance(state, event)
      draw()
    },
    /** Host-side step happening before or between compiler events (a manifest check, a copy...). */
    note(text: string) {
      state.text = text
      state.phase = 'host'
      draw()
    },
    fail(message: string) {
      finish('✖', message)
    },
    get warnings() {
      return messages.warnings
    },
  }
}
/** Batch companion for `prepareMany({onEvent})`: one line per job id, in arrival order. */
export function createBatchProgress({ stream = process.stderr }: { stream?: ProgressStream } = {}) {
  const lines = new Map<string, TerminalProgress>()
  let total = 0
  return {
    event(event: CompilerEvent) {
      if (event.event === 'batch') {
        total = event.jobs ?? 0
        return
      }
      if (event.job === '*') return
      let line = lines.get(event.job)
      if (!line) {
        line = createTerminalProgress({
          label: event.job,
          index: lines.size,
          total: total || 1,
          stream,
        })
        lines.set(event.job, line)
      }
      line.event(event)
    },
  }
}
