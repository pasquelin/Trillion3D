import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilerError } from '../messages/catalogue.mts';
import { sourceNewerThan } from './freshness.mts';

/** The machines the compiler release targets, as `process.platform`-`process.arch`. */
export const SUPPORTED_PLATFORMS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-x64',
  'linux-arm64',
  'win32-x64',
] as const;
/** The crate this checkout builds the compiler from; absent from an installed package. */
const CRATE = fileURLToPath(new URL('../../../../packages/asset-compiler-rust/', import.meta.url));
const built = (crate: string, platform: string) =>
  join(crate, `target/release/trillion3d-compiler${platform === 'win32' ? '.exe' : ''}`);
/** Finds the native compiler program: the one asked for, else the one built in this checkout. */
export function resolveCompilerExecutable(
  explicit?: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
) {
  return explicit || environment.TRILLION3D_COMPILER_BIN || built(CRATE, platform);
}
/** Where the program is looked for: the crate of a checkout, and the machine. */
interface CompilerHost {
  /** The crate folder; without its `Cargo.toml`, this is an installed package. */ crate: string;
  /** `process.platform`. */ platform: string;
  /** `process.arch`. */ arch: string;
}
const HERE: CompilerHost = { crate: CRATE, platform: process.platform, arch: process.arch };
const announced = new Set<string>();
/**
 * The program a compile launches. A binary named by the caller or by `TRILLION3D_COMPILER_BIN` is
 * trusted — the variable's one is announced once on stderr. Inside a checkout, its own build is
 * refused while a crate source is newer than it (`COMPILER_STALE`), since its products would carry
 * the previous build's key. An installed package names no path of this repository: an unsupported
 * machine is told the supported list, a supported one how to get a program.
 */
export function currentCompilerExecutable(
  explicit?: string,
  environment: NodeJS.ProcessEnv = process.env,
  host: Partial<CompilerHost> = {},
) {
  const { crate, platform, arch } = { ...HERE, ...host };
  if (explicit) return explicit;
  const named = environment.TRILLION3D_COMPILER_BIN;
  if (named) {
    if (!announced.has(named))
      process.stderr.write(`compiler: ${named} (TRILLION3D_COMPILER_BIN)\n`);
    announced.add(named);
    return named;
  }
  if (!existsSync(join(crate, 'Cargo.toml'))) {
    const machine = `${platform}-${arch}`;
    if (!(SUPPORTED_PLATFORMS as readonly string[]).includes(machine))
      throw compilerError(
        'COMPILER_PLATFORM_UNSUPPORTED',
        `${machine}; supported: ${SUPPORTED_PLATFORMS.join(', ')}`,
      );
    throw compilerError('COMPILER_EXECUTABLE_MISSING', `no compiler program for ${machine}`);
  }
  const executable = built(crate, platform);
  const newer = sourceNewerThan(executable, crate);
  if (newer) throw compilerError('COMPILER_STALE', `${executable} is older than ${newer}`);
  return executable;
}
