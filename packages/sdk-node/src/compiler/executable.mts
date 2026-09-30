import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { sourceNewerThan } from './freshness.mts';
import {
  compilerFileName,
  compilerPackage,
  installedCompiler,
  requireSupportedPlatform,
} from './platform.mts';

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
