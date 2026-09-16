import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import type { CompilerEvent } from './contracts.ts';

/** Longest accepted single line on either stream; the compiler emits small JSON lines only. */
export const COMPILER_LINE_LIMIT = 4 * 1024 * 1024;
/** Grace period between a cooperative cancel request on stdin and a hard kill. */
export const CANCEL_GRACE_MS = 5000;
function nativeCompilerPath(explicit?: string) {
  if (explicit) return explicit;
  if (process.env.WEB_GEOMETRY_COMPILER_BIN) return process.env.WEB_GEOMETRY_COMPILER_BIN;
  const ext = process.platform === 'win32' ? '.exe' : '';
  return fileURLToPath(
    new URL(
      `../../packages/asset-compiler-rust/target/release/web-geometry-compiler${ext}`,
      import.meta.url,
    ),
  );
}
/** Line-oriented JSON reader shared by both streams; a line that never ends is a protocol violation. */
function lineReader(onLine: (line: string) => void, onOverflow: () => void) {
  let pending = '';
  return (chunk: string) => {
    pending += chunk;
    if (pending.length > COMPILER_LINE_LIMIT) {
      onOverflow();
      return;
    }
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) onLine(line);
    }
  };
}
/**
 * A batch prints its summary whatever happened to its jobs: exit code 2 only says "not every job is
 * ready", and the summary says which ones were not. Reading the exit code alone turned a `partial`
 * batch — one model prepared, one refused — into an IO error carrying no jobs at all, although the
 * summary had already been decoded. A refusal of the batch itself (`{"status":"error"}`, no `jobs`)
 * is not a summary and still rejects.
 */
function isBatchSummary(output: unknown): boolean {
  const summary = output as { status?: unknown; jobs?: unknown } | null;
  return (
    !!summary &&
    Array.isArray(summary.jobs) &&
    (summary.status === 'ready' || summary.status === 'partial' || summary.status === 'failed')
  );
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
    const child = spawn(nativeCompilerPath(options.executable), args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    let lastError: string | null = null;
    let stdout = '';
    const finish = <V,>(fn: (value: V) => void, value: V) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', onAbort);
      fn(value);
    };
    const fail = (error: unknown) => {
      try {
        child.kill();
      } catch {
        /* Child may already have exited. */
      }
      finish(reject, error);
    };
    const onAbort = () => {
      try {
        child.stdin.write('{"cancel":"*"}\n');
      } catch {
        /* stdin may be closed; the kill below still applies. */
      }
      killTimer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* Already gone. */
        }
      }, CANCEL_GRACE_MS);
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    child.stdin.on('error', () => {
      /* The compiler closed stdin; cancellation falls back to kill. */
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > COMPILER_LINE_LIMIT) fail(new Error('COMPILER_LINE_LIMIT'));
    });
    child.stderr.on(
      'data',
      lineReader(
        (line) => {
          let event: CompilerEvent;
          try {
            event = JSON.parse(line) as CompilerEvent;
          } catch {
            lastError = line;
            return;
          }
          if (event.status === 'error') lastError = event.code ?? line;
          try {
            onEvent?.(event);
          } catch (error) {
            fail(error);
          }
        },
        () => fail(new Error('COMPILER_LINE_LIMIT')),
      ),
    );
    child.on('error', fail);
    child.on('close', (code) => {
      if (options.signal?.aborted) {
        finish(reject, new Error('CANCELLED'));
        return;
      }
      let output: T | null = null;
      try {
        output = JSON.parse(stdout) as T;
      } catch {
        /* Missing or partial pointer: reported below. */
      }
      if (isBatchSummary(output)) {
        finish(resolve, output as T);
        return;
      }
      if (code !== 0) {
        finish(
          reject,
          new Error(
            (output as { code?: string } | null)?.code ?? lastError ?? `COMPILER_EXIT_${code}`,
          ),
        );
        return;
      }
      if (!output) {
        finish(reject, new Error('COMPILER_NO_POINTER'));
        return;
      }
      finish(resolve, output);
    });
  });
}
