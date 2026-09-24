#!/usr/bin/env node
// Compiles `packages/physics-jolt-wasm` (Jolt from its pinned submodule plus this repository's
// flat C API) into two standalone WebAssembly modules, single-threaded and threaded (shared
// memory, for cross-origin isolated pages), and deposits them next to their loader, in
// `packages/sdk-browser/src/physics/`. Outside of `pnpm run validate`: emscripten, CMake and Ninja
// are a local setup, and the committed module is authoritative for every other consumer
// (`pnpm install` alone is enough; the tracked-output rule is in CONTRIBUTING.md). Run
// `git submodule update --init` first.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'packages', 'physics-jolt-wasm');
const OUTPUT = join(ROOT, 'packages', 'sdk-browser', 'src', 'physics');

if (!existsSync(join(SOURCE, 'JoltPhysics', 'Jolt', 'Jolt.h')))
  throw new Error('Jolt submodule missing.\nRun: git submodule update --init');

const llvm = execFileSync('em-config', ['LLVM_ROOT'], { encoding: 'utf8' }).trim();
for (const [name, threads] of [
  ['joltPhysics', 'OFF'],
  ['joltPhysicsThreads', 'ON'],
] as const) {
  const build = join(ROOT, 'target', 'physics-jolt-wasm', name);
  execFileSync(
    'emcmake',
    ['cmake', '-G', 'Ninja', '-S', SOURCE, '-B', build, '-DCMAKE_BUILD_TYPE=Distribution'].concat(
      `-DTHREADS=${threads}`,
    ),
    { stdio: 'inherit' },
  );
  execFileSync('cmake', ['--build', build, '--target', name], { stdio: 'inherit' });
  const built = join(build, `${name}.wasm`);
  // emscripten strips the `target_features` section, so the instruction set is read from the
  // code: SIMD instructions must be there, relaxed ones (implementation-defined rounding) must not.
  const code = execFileSync(join(llvm, 'llvm-objdump'), ['-d', built], {
    encoding: 'utf8',
    maxBuffer: 1 << 30,
  });
  if (!/\bf32x4\./.test(code)) throw new Error(`${built}: no SIMD instruction in the module.`);
  if (/\brelaxed_/.test(code)) throw new Error(`${built}: relaxed SIMD instruction in the module.`);
  mkdirSync(OUTPUT, { recursive: true });
  copyFileSync(built, join(OUTPUT, `${name}.wasm`));
  console.log(`${name}.wasm: ${statSync(built).size} bytes`);
}
