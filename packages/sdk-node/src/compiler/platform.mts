import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * The platforms the compiler is built for, as Node names them (`process.platform`-`process.arch`):
 * each ships as its own package, `@trillion3d/compiler-<platform>-<arch>`, an optional dependency
 * of `trillion3d`, so an install takes only the one its machine runs (#1352).
 */
export const COMPILER_PLATFORMS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-x64',
] as const;

/** The compiler's file name on `platform`. */
export const compilerFileName = (platform: NodeJS.Platform) =>
  `trillion3d-compiler${platform === 'win32' ? '.exe' : ''}`;

/** The package carrying the compiler built for `platform` and `arch`; null where none is built. */
export function compilerPackage(platform: string, arch: string): string | null {
  const target = `${platform}-${arch}`;
  return (COMPILER_PLATFORMS as readonly string[]).includes(target)
    ? `@trillion3d/compiler-${target}`
    : null;
}

/**
 * The compiler of the platform package installed beside this module — resolved as Node resolves
 * an import from `from` —, or null when that package is not installed or carries no binary.
 */
export function installedCompiler(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  from: string | URL = import.meta.url,
): string | null {
  const name = compilerPackage(platform, arch);
  if (!name) return null;
  let manifest: string;
  try {
    manifest = createRequire(from).resolve(`${name}/package.json`);
  } catch {
    return null;
  }
  const binary = join(dirname(manifest), 'bin', compilerFileName(platform));
  return existsSync(binary) ? binary : null;
}

/**
 * Refuses a platform no compiler package is built for, naming the supported ones; the caller asks
 * only when nothing else names a compiler (no `TRILLION3D_COMPILER_BIN`, no checkout build).
 */
export function requireSupportedPlatform(
  platform: string = process.platform,
  arch: string = process.arch,
): void {
  if (compilerPackage(platform, arch)) return;
  throw new Error(
    `COMPILER_PLATFORM_UNSUPPORTED: no compiler is built for ${platform}-${arch}; supported: ` +
      `${COMPILER_PLATFORMS.join(', ')}. Build one and name it with TRILLION3D_COMPILER_BIN.`,
  );
}
