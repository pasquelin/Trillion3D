import type {
  CompilerEvent,
  ProgressPointer,
  ProgressStream,
  TerminalProgress,
  TerminalProgressOptions,
} from '../compiler/contracts.ts';
import { dagWarningsTally } from './progressDag.mts';

/**
 * Terminal progress for compiler jobs: one live line per job on a TTY (spinner, bar, phase, elapsed),
 * one plain line per phase change elsewhere. Built on the `ratio` every compiler event carries, so a
 * host needs no knowledge of the phases. Pass `progress.event` as `onProgress` (or `onEvent` for batches).
 */
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const mb = (bytes: unknown) => `${(Number(bytes ?? 0) / 1048576).toFixed(0)} MB`;
type PhaseState = { primitives: number; primitivesTotal: number };
const PHASES: Record<string, (event: CompilerEvent, state: PhaseState) => string> = {
  accepted: () => 'starting',
  'import-source': (e) => {
    const steps: Record<string, string> = {
      parse: `reading ${e.file ?? 'source'} ${mb(e.completed)}/${mb(e.total)}`,
      meshes: `converting meshes ${e.completed}/${e.total}`,
      write: `writing glTF ${mb(e.bytes)}`,
      reused: 'import reused',
      complete: 'import done',
    };
    return steps[e.step ?? ''] ?? 'importing';
  },
  import: () => 'source geometry written',
  primitive: (e, s) =>
    `clustering ${s.primitives}${s.primitivesTotal ? `/${s.primitivesTotal}` : ''} primitives`,
  bootstrap: (e) => `root bundles ${e.completed}/${e.total}`,
  // Cutouts are decided by hand, and the questions come at the end of the batch: the line only
  // says there will be some. Nothing to decide is a line too — the answer sheet exists for every
  // model, and it is what says whether a review is due.
  cutouts: (e) =>
    Number(e.pending ?? 0) > 0 ? `${e.pending} cutout(s) to review` : 'cutouts up to date',
  // A folder already holding the product is proven, then kept: no clustering line follows.
  reuse: (e) =>
    Number(e.completed ?? 0) > 0
      ? `reused ${e.objects} objects (${mb(e.objectBytes)} proven)`
      : `rebuilding: ${e.reason}`,
  prune: (e) => `pruning cache (${e.removedKeys} keys, ${mb(e.removedBytes)})`,
  complete: () => 'writing pointer',
};
const clip = (text: string, width: number) => {
  const chars = [...text];
  return chars.length > width ? `${chars.slice(0, Math.max(1, width - 1)).join('')}…` : text;
};
function summaryOf(pointer?: ProgressPointer) {
  if (!pointer) return 'ready';
  const parts = [];
  if (typeof pointer.selectedTriangles === 'number')
    parts.push(`${pointer.selectedTriangles.toLocaleString()} triangles`);
  if (typeof pointer.primitives === 'number') parts.push(`${pointer.primitives} primitives`);
  if (pointer.metrics?.wallMs) parts.push(`${Math.round(pointer.metrics.wallMs)} ms`);
  return parts.join(', ') || 'ready';
}
/** A progress bar in the terminal that follows the compiler's events. */
export function createTerminalProgress({
  label = 'job',
  index = 0,
  total = 1,
  stream = process.stderr,
  width = 24,
  interval = 100,
}: TerminalProgressOptions = {}): TerminalProgress {
  const tty = Boolean(stream.isTTY);
  const started = performance.now();
  const state: PhaseState & {
    ratio: number;
    phase: string;
    text: string;
    frame: number;
    lastKey: string;
    timer: ReturnType<typeof setInterval> | null;
    finished: boolean;
  } = {
    ratio: 0,
    phase: '',
    text: 'waiting',
    primitives: 0,
    primitivesTotal: 0,
    frame: 0,
    lastKey: '',
    timer: null,
    finished: false,
  };
  const elapsed = () => `${((performance.now() - started) / 1000).toFixed(1)}s`;
  const bar = () => {
    const filled = Math.round(state.ratio * width);
    return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${String(Math.round(state.ratio * 100)).padStart(3)}%`;
  };
  // Fixed parts (spinner, index, bar, elapsed) always fit; only the phase text yields to a narrow terminal.
  const line = (width: number) => {
    const head = `${SPINNER[state.frame++ % SPINNER.length]} ${index + 1}/${total} ${label} ${bar()} `;
    const tail = ` ${elapsed()}`;
    return head + clip(state.text, Math.max(1, width - [...head].length - [...tail].length)) + tail;
  };
  const draw = () => {
    if (state.finished) return;
    if (tty) stream.write(`\r\x1b[K${line(Math.max(20, (stream.columns ?? 80) - 1))}`);
    else {
      const key = `${state.phase}:${state.text.split(' ')[0]}`;
      if (key !== state.lastKey) {
        stream.write(`${line(Infinity)}\n`);
        state.lastKey = key;
      }
    }
  };
  const stop = () => {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  };
  // A line that stays: the bar is erased first on a terminal, written as-is elsewhere.
  const persist = (text: string) => stream.write(`${tty ? '\r\x1b[K' : ''}${text}\n`);
  const dag = dagWarningsTally();
  const finish = (mark: string, summary: string) => {
    if (state.finished) return;
    stop();
    state.finished = true;
    persist(`${mark} ${index + 1}/${total} ${label} ${summary} ${elapsed()}`);
  };
  if (tty) {
    state.timer = setInterval(draw, interval);
    state.timer.unref();
  }
  return {
    /** Feed every compiler event here; the line completes or fails by itself. */
    event(event: CompilerEvent) {
      if (event.event === 'complete') {
        if (dag.count) persist(dag.line(label));
        finish('✔', summaryOf(event.pointer));
        return;
      }
      if (event.event === 'error' || event.event === 'cancelled') {
        finish('✖', `${event.code ?? 'error'}${event.message ? ` ${event.message}` : ''}`);
        return;
      }
      if (typeof event.ratio === 'number')
        state.ratio = Math.min(1, Math.max(state.ratio, event.ratio));
      if (event.phase === 'import' && typeof event.primitives === 'number')
        state.primitivesTotal = event.primitives;
      if (event.phase === 'primitive') state.primitives += 1;
      // A DAG the compiler did not raise: counted here, stated in one line at the end.
      for (const warning of event.warnings ?? [])
        dag.record(warning, `${event.mesh}/${event.primitive}`);
      state.phase = event.phase ?? event.event ?? '';
      const describe = PHASES[state.phase];
      if (describe) state.text = describe(event, state);
      draw();
    },
    /** Host-side step happening before or between compiler events (a manifest check, a copy...). */
    note(text: string) {
      state.text = text;
      state.phase = 'host';
      draw();
    },
    fail(message: string) {
      finish('✖', message);
    },
  };
}
/** Batch companion for `prepareMany({onEvent})`: one line per job id, in arrival order. */
export function createBatchProgress({ stream = process.stderr }: { stream?: ProgressStream } = {}) {
  const lines = new Map<string, TerminalProgress>();
  let total = 0;
  return {
    event(event: CompilerEvent) {
      if (event.event === 'batch') {
        total = event.jobs ?? 0;
        return;
      }
      if (event.job === '*') return;
      let line = lines.get(event.job);
      if (!line) {
        line = createTerminalProgress({
          label: event.job,
          index: lines.size,
          total: total || 1,
          stream,
        });
        lines.set(event.job, line);
      }
      line.event(event);
    },
  };
}
