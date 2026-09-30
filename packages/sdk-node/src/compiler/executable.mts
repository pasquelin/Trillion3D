import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilerError } from '../messages/catalogue.mts';
import { sourceNewerThan } from './freshness.mts';
import {
  COMPILER_PLATFORMS,
  compilerFileName,
  compilerPackage,
  installedCompiler,
} from './platform.mts';

/** The crate this checkout builds the compiler from; absent from an installed package. */
const CRATE = fileURLToPath(new URL('../../../../packages/asset-compiler-rust/', import.meta.url));
const built = (crate: string, platform: NodeJS.Platform) =>
  join(crate, 'target/release', compilerFileName(platform));
/** The installed platform package's compiler, looked up once per machine: an install does not
 *  move under a running process. */
const installedLookups = new Map<string, string | null>();
function installedOnce(platform: NodeJS.Platform, arch: string) {
  const machine = `${platform}-${arch}`;
  if (!installedLookups.has(machine))
    installedLookups.set(machine, installedCompiler(platform, arch));
  return installedLookups.get(machine) ?? null;
}
/** Where the program is looked for: the crate of a checkout, the machine, its installed package. */
interface CompilerHost {
  /** The crate folder; without its `Cargo.toml`, this is an installed package. */ crate: string;
  /** `process.platform`. */ platform: NodeJS.Platform;
  /** `process.arch`. */ arch: string;
  /** The installed package's compiler, null for none; looked up when left out. */
  installed?: string | null;
}
const HERE: CompilerHost = { crate: CRATE, platform: process.platform, arch: process.arch };
type Source = { path: string; from: 'explicit' | 'installed' | 'environment' } | null;
/**
 * The compiler named rather than built here, in the order asked: the caller's, the installed
 * platform package's (`platform.mts`, looked up only when the caller named none), then
 * `TRILLION3D_COMPILER_BIN`'s.
 */
function namedCompiler(
  explicit: string | undefined,
  environment: NodeJS.ProcessEnv,
  { platform, arch, installed }: CompilerHost,
): Source {
  if (explicit) return { path: explicit, from: 'explicit' };
  const found = installed === undefined ? installedOnce(platform, arch) : installed;
  if (found) return { path: found, from: 'installed' };
  const variable = environment.TRILLION3D_COMPILER_BIN;
  return variable ? { path: variable, from: 'environment' } : null;
}
/**
 * Finds the native compiler program: the one asked for, else the one of the installed platform
 * package, else the one `TRILLION3D_COMPILER_BIN` names, else the one built in this checkout.
 */
export function resolveCompilerExecutable(
  explicit?: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
) {
  const host = { ...HERE, platform };
  return namedCompiler(explicit, environment, host)?.path ?? built(CRATE, platform);
}
const announced = new Set<string>();
/**
 * The program a compile launches. A binary named by the caller, installed with the platform
 * package or named by `TRILLION3D_COMPILER_BIN` is trusted — the variable's one is announced once
 * on stderr. Inside a checkout, its own build is refused while a crate source is newer than it
 * (`COMPILER_STALE`), since its products would carry the previous build's key. Outside a checkout,
 * with none of them, a machine no compiler is built for is told the supported list
 * (`COMPILER_PLATFORM_UNSUPPORTED`), a supported one the package it lacks
 * (`COMPILER_EXECUTABLE_MISSING`); neither names a path of this repository.
 */
export function currentCompilerExecutable(
  explicit?: string,
  environment: NodeJS.ProcessEnv = process.env,
  host: Partial<CompilerHost> = {},
) {
  const machine = { ...HERE, ...host };
  const named = namedCompiler(explicit, environment, machine);
  if (named) {
    if (named.from === 'environment' && !announced.has(named.path)) {
      process.stderr.write(`compiler: ${named.path} (TRILLION3D_COMPILER_BIN)\n`);
      announced.add(named.path);
    }
    return named.path;
  }
  const { crate, platform, arch } = machine;
  if (!existsSync(join(crate, 'Cargo.toml'))) {
    const name = compilerPackage(platform, arch);
    if (!name)
      throw compilerError(
        'COMPILER_PLATFORM_UNSUPPORTED',
        `${platform}-${arch}; supported: ${COMPILER_PLATFORMS.join(', ')}`,
      );
    throw compilerError('COMPILER_EXECUTABLE_MISSING', `${name} is not installed`);
  }
  const executable = built(crate, platform);
  const newer = sourceNewerThan(executable, crate);
  if (newer) throw compilerError('COMPILER_STALE', `${executable} is older than ${newer}`);
  return executable;
}
