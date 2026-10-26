import { spawn, type ChildProcess, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import type { CompilerEvent } from './contracts.ts'
import { currentCompilerExecutable } from './executable.mts'
import { compilerError } from '../messages/catalogue.mts'
import { lineReader } from './lines.mts'

/** Grace period between a cooperative cancel request on stdin and a hard kill. */
export const CANCEL_GRACE_MS = 5000
/**
 * A batch prints its summary whatever happened to its jobs: exit code 2 only says "not every job is
 * ready", and the summary says which ones were not. Reading the exit code alone turned a `partial`
 * batch — one model prepared, one refused — into an IO error carrying no jobs at all, although the
 * summary had already been decoded. A refusal of the batch itself (`{"status":"error"}`, no `jobs`)
 * is not a summary and still rejects.
 */
function isBatchSummary(output: unknown): boolean {
  const summary = output as { status?: unknown; jobs?: unknown } | null
  return (
    !!summary &&
    Array.isArray(summary.jobs) &&
    (summary.status === 'ready' || summary.status === 'partial' || summary.status === 'failed')
  )
}
/** Reads the compiler's two streams: stderr's lines are its events, forwarded to `onEvent`, and the
 *  last line of stdout is its answer. */
function readOutput(
  child: ChildProcessByStdio<Writable, Readable, Readable>,
  fail: (error: unknown) => void,
  onEvent?: (event: CompilerEvent) => void,
) {
  let lastError: Error | null = null
  let stdout = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  // The answer is the last line the compiler writes out, read as stderr's events are.
  const answer = lineReader(
    (line) => {
      stdout = line
    },
    () => fail(compilerError('COMPILER_LINE_LIMIT')),
  )
  child.stdout.on('data', answer)
  child.stdout.on('end', answer.end)
  const events = lineReader(
    (line) => {
      let event: CompilerEvent
      try {
        event = JSON.parse(line) as CompilerEvent
      } catch {
        lastError = compilerError('COMPILER_EXIT', line)
        return
      }
      if (event.status === 'error')
        lastError = compilerError(event.code ?? 'COMPILER_EXIT', event.message ?? line)
      try {
        onEvent?.(event)
      } catch (error) {
        fail(error)
      }
    },
    () => fail(compilerError('COMPILER_LINE_LIMIT')),
  )
  child.stderr.on('data', events)
  child.stderr.on('end', events.end)
  return { answer: () => stdout, lastError: () => lastError }
}

/** Kills the child, which may already have exited. */
function killQuietly(child: ChildProcess) {
  try {
    child.kill()
  } catch {
    /* Already gone. */
  }
}

/** The error a failed launch is reported as: a missing or non-executable compiler is named. */
function spawnFailure(error: NodeJS.ErrnoException, executable: string) {
  if (error.code === 'ENOENT')
    return compilerError('COMPILER_EXECUTABLE_MISSING', executable, { cause: error })
  if (error.code === 'EACCES')
    return compilerError('COMPILER_EXECUTABLE_NOT_EXECUTABLE', executable, { cause: error })
  return error
}

/** What the compiler's last stdout line and exit code make of the job: the pointer, or the error. */
function closeOutcome<T>(
  stdout: string,
  code: number | null,
  lastError: Error | null,
): { value: T } | { error: unknown } {
  let output: T | null = null
  try {
    output = JSON.parse(stdout) as T
  } catch {
    /* Missing or partial pointer: reported below. */
  }
  if (isBatchSummary(output)) return { value: output as T }
  if (code !== 0) {
    const refusal = output as { code?: string; message?: string } | null
    return {
      error: refusal?.code
        ? compilerError(refusal.code, refusal.message)
        : (lastError ?? compilerError('COMPILER_EXIT', `exit code ${code}`)),
    }
  }
  if (!output) return { error: compilerError('COMPILER_NO_POINTER') }
  return { value: output }
}

/**
 * Runs the native compiler once. Node only launches it, forwards events and cancellation, and reads
 * the pointer it prints; the compiled manifest is read back from disk, never streamed through here.
 */
export function runCompiler<T>(
  args: string[],
  options: { executable?: string; signal?: AbortSignal },
  onEvent?: (event: CompilerEvent) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const executable = currentCompilerExecutable(options.executable)
    const child = spawn(executable, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let settled = false
    let killTimer: ReturnType<typeof setTimeout> | null = null
    const finish = <V,>(fn: (value: V) => void, value: V) => {
      if (settled) return
      settled = true
      if (killTimer) clearTimeout(killTimer)
      options.signal?.removeEventListener('abort', onAbort)
      fn(value)
    }
    const fail = (error: unknown) => {
      killQuietly(child)
      finish(reject, error)
    }
    const onAbort = () => {
      try {
        child.stdin.write('{"cancel":"*"}\n')
      } catch {
        /* stdin may be closed; the kill below still applies. */
      }
      killTimer = setTimeout(() => killQuietly(child), CANCEL_GRACE_MS)
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted) onAbort()
    child.stdin.on('error', () => {
      /* The compiler closed stdin; cancellation falls back to kill. */
    })
    const output = readOutput(child, fail, onEvent)
    child.on('error', (error: NodeJS.ErrnoException) => fail(spawnFailure(error, executable)))
    child.on('close', (code) => {
      if (options.signal?.aborted) {
        finish(reject, compilerError('CANCELLED'))
        return
      }
      const outcome = closeOutcome<T>(output.answer(), code, output.lastError())
      if ('error' in outcome) finish(reject, outcome.error)
      else finish(resolve, outcome.value)
    })
  })
}
