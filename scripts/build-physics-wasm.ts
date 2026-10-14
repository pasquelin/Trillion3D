#!/usr/bin/env node
// Compiles `packages/physics-jolt-wasm` (Jolt from its pinned submodule plus this repository's
// flat C API) into two standalone WebAssembly modules, single-threaded and threaded (shared
// memory, for cross-origin isolated pages), and deposits them next to their loader, in
// `packages/sdk-browser/src/physics/`. Outside of `pnpm run validate`: emscripten, CMake and Ninja
// are a local setup, and the committed module is authoritative for every other consumer
// (`pnpm install` alone is enough; the tracked-output rule is in CONTRIBUTING.md). Run
// `git submodule update --init` first.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { checkInstructionSet } from './build-wasm.ts'
import { REPOSITORY_ROOT } from './repository-files.ts'
import { runChecked } from './run.ts'

const SOURCE = join(REPOSITORY_ROOT, 'packages', 'physics-jolt-wasm')
const OUTPUT = join(REPOSITORY_ROOT, 'packages', 'sdk-browser', 'src', 'physics')

if (!existsSync(join(SOURCE, 'JoltPhysics', 'Jolt', 'Jolt.h')))
  throw new Error('Jolt submodule missing.\nRun: git submodule update --init')

const llvm = runChecked('em-config', ['LLVM_ROOT'], { shell: false }).trim()
for (const [name, threads] of [
  ['joltPhysics', 'OFF'],
  ['joltPhysicsThreads', 'ON'],
] as const) {
  const build = join(REPOSITORY_ROOT, 'target', 'physics-jolt-wasm', name)
  runChecked(
    'emcmake',
    ['cmake', '-G', 'Ninja', '-S', SOURCE, '-B', build, '-DCMAKE_BUILD_TYPE=Distribution'].concat(
      `-DTHREADS=${threads}`,
    ),
    { stdio: 'inherit', shell: false },
  )
  runChecked('cmake', ['--build', build, '--target', name], { stdio: 'inherit', shell: false })
  const built = join(build, `${name}.wasm`)
  // emscripten strips the `target_features` section: the instruction set is read from the code.
  checkInstructionSet(built, (path) =>
    runChecked(join(llvm, 'llvm-objdump'), ['-d', path], { shell: false }),
  )
  mkdirSync(OUTPUT, { recursive: true })
  copyFileSync(built, join(OUTPUT, `${name}.wasm`))
  console.log(`${name}.wasm: ${statSync(built).size} bytes`)
}
