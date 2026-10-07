import { mkdtemp, mkdir, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compilerFileName } from './platform.mts'

const binaryName = compilerFileName(process.platform)

/** A crate built at `builtAt` from sources dated `editedAt`: seconds since the epoch. */
export async function crate(builtAt: number, editedAt: number) {
  const root = await mkdtemp(join(tmpdir(), 'trillion3d-freshness-'))
  await mkdir(join(root, 'src/nested'), { recursive: true })
  await mkdir(join(root, 'target/release'), { recursive: true })
  const binary = join(root, 'target/release', binaryName)
  const sources = ['Cargo.toml', 'src/lib.rs', 'src/nested/stage.rs'].map((file) =>
    join(root, file),
  )
  for (const file of sources) {
    await writeFile(file, '')
    await utimes(file, editedAt, editedAt)
  }
  await writeFile(binary, '')
  await utimes(binary, builtAt, builtAt)
  return { root, binary, stage: sources[2] }
}

const CRATES = ['asset-compiler-rust', 'page-codec-wasm', 'math/rust']

/** What the compiler's binary answers to `--build-inputs` here: its crate folders, then the
 *  manifests and the libraries, never the test code; counted, to prove it is asked once per
 *  build. */
export function stubBinary() {
  const asked: string[] = []
  const inputs = (binary: string) => {
    asked.push(binary)
    return ['./', '../math/rust/', '../page-codec-wasm/', 'Cargo.toml', 'src/lib.rs']
      .concat(['../page-codec-wasm/Cargo.toml', '../page-codec-wasm/src/lib.rs'])
      .concat(['../math/rust/Cargo.toml', '../math/rust/src/lib.rs'])
  }
  return { asked, inputs }
}

export async function linkedCrates() {
  const packages = await mkdtemp(join(tmpdir(), 'trillion3d-freshness-'))
  const root = join(packages, 'asset-compiler-rust')
  const binary = join(root, 'target/release', binaryName)
  await mkdir(join(root, 'target/release'), { recursive: true })
  await writeFile(binary, '')
  const files = [binary]
  for (const crate of CRATES) {
    await mkdir(join(packages, crate, 'src/golden'), { recursive: true })
    await writeFile(join(packages, crate, 'Cargo.toml'), '[package]\n')
    await writeFile(join(packages, crate, 'src/lib.rs'), '#[cfg(test)]\nmod screen;\n')
    for (const test of ['src/lib_tests.rs', 'src/golden/value.rs', 'src/screen.rs'])
      await writeFile(join(packages, crate, test), '')
    const sources = ['Cargo.toml', 'src/lib.rs', 'src/lib_tests.rs', 'src/golden/value.rs']
    files.push(...[...sources, 'src/screen.rs'].map((file) => join(packages, crate, file)))
  }
  for (const file of files) await utimes(file, 1_000, 1_000)
  await utimes(binary, 2_000, 2_000)
  return { packages, root, binary }
}
