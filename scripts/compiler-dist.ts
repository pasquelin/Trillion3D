/**
 * The distributed compiler of this machine's platform (#1352), as the `Compiler` workflow builds
 * it on each of the five: the `dist` profile (`Cargo.toml`: fat LTO, abort, stripped), then
 * profile-guided — a first build instrumented, trained on the reference scenes
 * (`compiler-hashes.ts`), and the build again from what it measured —, fingerprinted on the same
 * scenes, and copied into its platform package (`packages/compiler/<os>-<arch>/bin`).
 * Profile-guided optimisation lays the code out and inlines where the scenes spend their time; it
 * changes no arithmetic, so no cooked byte.
 *
 *   node scripts/compiler-dist.ts <record.json>
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compilerFileName, compilerPackage } from '../packages/sdk-node/src/compiler/platform.mts';
import { compileReferenceScenes, referenceHashes, type HashRecord } from './compiler-hashes.ts';

const ROOT = resolve(import.meta.dirname, '..');
const CRATE = join(ROOT, 'packages/asset-compiler-rust');
const rust = (args: string[]) => execFileSync('rustc', args, { encoding: 'utf8' }).trim();
/** The Rust target of this machine, which the build names so that the flags reach no build script. */
const TARGET = /^host: (\S+)$/m.exec(rust(['-vV']))?.[1] ?? '';
/** A path as the flags carry it: forward slashes, which every platform's toolchain reads. */
const slashed = (path: string) => path.replaceAll('\\', '/');

/**
 * Builds the compiler with `flags` added to this target's own (`.cargo/config.toml`: Cargo joins
 * the two lists) into `target/<folder>` and returns it: a folder per pass, so that each keeps its
 * dependencies built with its own flags, and apart from `pnpm run build:native`.
 */
function build(folder: string, flags: string[]): string {
  const directory = join(CRATE, 'target', folder);
  execFileSync(
    'cargo',
    [
      ...['build', '--profile', 'dist', '--locked', '--bin', 'trillion3d-compiler'],
      ...['--target', TARGET, '--target-dir', directory],
      ...['--manifest-path', join(CRATE, 'Cargo.toml')],
      ...['--config', `target.${TARGET}.rustflags=${JSON.stringify(flags)}`],
    ],
    { stdio: 'inherit' },
  );
  return join(directory, TARGET, 'dist', compilerFileName(process.platform));
}

const [output] = process.argv.slice(2);
const platform = `${process.platform}-${process.arch}`;
if (!output || !compilerPackage(process.platform, process.arch))
  throw new Error(`usage: node scripts/compiler-dist.ts <record.json>, on a built platform`);
const profiles = join(CRATE, 'target', 'pgo', TARGET);
rmSync(profiles, { recursive: true, force: true });
mkdirSync(profiles, { recursive: true });
compileReferenceScenes(build('pgo-generate', [`-Cprofile-generate=${slashed(profiles)}`]));
const merged = join(profiles, 'merged.profdata');
const tools = join(rust(['--print', 'sysroot']), 'lib/rustlib', TARGET, 'bin');
const profdata = join(tools, `llvm-profdata${process.platform === 'win32' ? '.exe' : ''}`);
execFileSync(profdata, ['merge', '-o', merged, profiles], { stdio: 'inherit' });
const compiler = build('dist', [`-Cprofile-use=${slashed(merged)}`]);
const record: HashRecord = {
  compiler: platform,
  bytes: statSync(compiler).size,
  files: referenceHashes(compiler),
};
const shipped = join(ROOT, 'packages/compiler', platform, 'bin');
mkdirSync(shipped, { recursive: true });
copyFileSync(compiler, join(shipped, compilerFileName(process.platform)));
writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
console.log(`${compilerPackage(process.platform, process.arch)}: ${record.bytes} bytes`);
