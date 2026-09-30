import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CompilerEvent } from './contracts.ts';
import { sourceNewerThan } from './freshness.mts';
import { COMPILER_LINE_LIMIT, lineReader } from './lines.mts';
import {
  compilerFileName,
  compilerPackage,
  installedCompiler,
  requireSupportedPlatform,
} from './platform.mts';

/** Grace period between a cooperative cancel request on stdin and a hard kill. */
export const CANCEL_GRACE_MS = 5000;
/** The crate this checkout builds the compiler from; absent from an installed package. */
const CRATE = fileURLToPath(new URL('../../../../packages/asset-compiler-rust/', import.meta.url));
const built = (crate: string, platform: NodeJS.Platform) =>
  join(crate, 'target/release', compilerFileName(platform));
type Source = { path: string; from: 'explicit' | 'installed' | 'environment' } | null;
/**
 * The compiler named rather than built here, in the order asked: the caller's, the installed
 * platform package's (`platform.mts`, looked up only when the caller named none), then
 * `TRILLION3D_COMPILER_BIN`'s.
 */
function namedCompiler(
  explicit: string | undefined,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  installed: string | null | undefined,
): Source {
  if (explicit) return { path: explicit, from: 'explicit' };
  const found = installed === undefined ? installedCompiler(platform) : installed;
  if (found) return { path: found, from: 'installed' };
  const variable = environment.TRILLION3D_COMPILER_BIN;
  return variable ? { path: variable, from: 'environment' } : null;
}
/**
 * Finds the native compiler program: the one asked for, else the installed platform package's
 * (`platform.mts`), else `TRILLION3D_COMPILER_BIN`'s, else the one built in this checkout.
 */
export function resolveCompilerExecutable(
  explicit?: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  installed?: string | null,
) {
  return namedCompiler(explicit, environment, platform, installed)?.path ?? built(CRATE, platform);
}
const announced = new Set<string>();
/**
 * The program a compile launches. A binary named by the caller, installed with the platform
 * package or named by `TRILLION3D_COMPILER_BIN` is trusted — the variable's one is announced once
 * on stderr; the checkout's own build is refused while a crate source is newer than it, since its
 * products would carry the previous build's key. Outside a checkout, with none of them, a platform
 * no compiler is built for is refused by name, and a built one by its missing package.
 */
export function currentCompilerExecutable(
  explicit?: string,
  environment = process.env,
  crate = CRATE,
  installed?: string | null,
) {
  const named = namedCompiler(explicit, environment, process.platform, installed);
  if (named) {
    if (named.from === 'environment' && !announced.has(named.path)) {
      process.stderr.write(`compiler: ${named.path} (TRILLION3D_COMPILER_BIN)\n`);
      announced.add(named.path);
    }
    return named.path;
  }
  if (!existsSync(join(crate, 'Cargo.toml'))) {
    requireSupportedPlatform();
    throw new Error(
      `COMPILER_EXECUTABLE_MISSING: ${compilerPackage(process.platform, process.arch)} is not ` +
        'installed — install trillion3d with its optional dependencies (none serves a Linux on ' +
        'musl), or name a compiler with TRILLION3D_COMPILER_BIN.',
    );
  }
  const executable = built(crate, process.platform);
  const newer = sourceNewerThan(executable, crate);
  if (newer)
    throw new Error(
      `COMPILER_STALE: ${executable} is older than ${newer} — run \`pnpm run build:native\``,
    );
  return executable;
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
