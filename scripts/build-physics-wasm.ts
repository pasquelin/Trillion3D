#!/usr/bin/env node
// Compiles `packages/physics-jolt-wasm` (Jolt from its pinned submodule plus this repository's
// flat C API) into one standalone WebAssembly module and deposits it next to its loader, in
// `packages/sdk-browser/src/physics/`. Outside of `pnpm run validate`: emscripten, CMake and Ninja
// are a local setup, and the committed module is authoritative for every other consumer
// (`pnpm install` alone is enough). Run `git submodule update --init` first.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'packages', 'physics-jolt-wasm');
const BUILD = join(ROOT, 'target', 'physics-jolt-wasm');
const NAME = 'joltPhysics.wasm';
const OUTPUTS = [join(ROOT, 'packages', 'sdk-browser', 'src', 'physics')];

if (!existsSync(join(SOURCE, 'JoltPhysics', 'Jolt', 'Jolt.h')))
  throw new Error('Jolt submodule missing.\nRun: git submodule update --init');

execFileSync(
  'emcmake',
  ['cmake', '-G', 'Ninja', '-S', SOURCE, '-B', BUILD, '-DCMAKE_BUILD_TYPE=Distribution'],
  { stdio: 'inherit' },
);
execFileSync('cmake', ['--build', BUILD, '--target', 'joltPhysics'], { stdio: 'inherit' });

const built = join(BUILD, NAME);
// emscripten strips the `target_features` section, so the instruction set is read from the code:
// SIMD instructions must be there, relaxed ones (implementation-defined rounding) must not.
const llvm = execFileSync('em-config', ['LLVM_ROOT'], { encoding: 'utf8' }).trim();
const code = execFileSync(join(llvm, 'llvm-objdump'), ['-d', built], {
  encoding: 'utf8',
  maxBuffer: 1 << 30,
});
if (!/\bf32x4\./.test(code)) throw new Error(`${built}: no SIMD instruction in the module.`);
if (/\brelaxed_/.test(code)) throw new Error(`${built}: relaxed SIMD instruction in the module.`);
for (const folder of OUTPUTS) {
  mkdirSync(folder, { recursive: true });
  copyFileSync(built, join(folder, NAME));
}
console.log(`${NAME}: ${statSync(built).size} bytes`);
