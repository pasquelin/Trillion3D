import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { CompilerEvent } from './contracts.ts';
import { sourceNewerThan } from './freshness.mts';

/** Longest accepted single line on either stream; the compiler emits small JSON lines only. */
export const COMPILER_LINE_LIMIT = 4 * 1024 * 1024;
/** Grace period between a cooperative cancel request on stdin and a hard kill. */
export const CANCEL_GRACE_MS = 5000;
/** The crate this checkout builds the compiler from; absent from an installed package. */
const CRATE = fileURLToPath(new URL('../../../../packages/asset-compiler-rust/', import.meta.url));
const built = (crate: string, platform: NodeJS.Platform) =>
  join(crate, `target/release/trillion3d-compiler${platform === 'win32' ? '.exe' : ''}`);
/** Finds the native compiler program: the one asked for, else the one built in this checkout. */
export function resolveCompilerExecutable(
  explicit?: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
) {
  return explicit || environment.TRILLION3D_COMPILER_BIN || built(CRATE, platform);
}
const announced = new Set<string>();
/**
 * The program a compile launches. A binary named by the caller or by `TRILLION3D_COMPILER_BIN` is
 * trusted — the variable's one is announced once on stderr; the checkout's own build is refused
 * while a crate source is newer than it, since its products would carry the previous build's key.
 */
export function currentCompilerExecutable(
  explicit?: string,
  environment = process.env,
  crate = CRATE,
) {
  const named = resolveCompilerExecutable(explicit, environment);
  if (explicit) return named;
  if (environment.TRILLION3D_COMPILER_BIN) {
    if (!announced.has(named))
      process.stderr.write(`compiler: ${named} (TRILLION3D_COMPILER_BIN)\n`);
    announced.add(named);
    return named;
  }
  const executable = built(crate, process.platform);
  const newer = sourceNewerThan(executable, crate);
  if (newer)
    throw new Error(
      `COMPILER_STALE: ${executable} is older than ${newer} — run \`pnpm run build:native\``,
    );
  return executable;
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
    const executable = currentCompilerExecutable(options.executable);
    const child = spawn(executable, args, {
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
    child.on('error', (error: NodeJS.ErrnoException) =>
      fail(
        error.code === 'ENOENT'
          ? new Error(`COMPILER_EXECUTABLE_MISSING: ${executable}`, { cause: error })
          : error.code === 'EACCES'
            ? new Error(`COMPILER_EXECUTABLE_NOT_EXECUTABLE: ${executable}`, { cause: error })
            : error,
      ),
    );
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
