// The rules the engine runs in more than one language, each written once in TypeScript and printed
// here into the others: the wave model (`packages/sdk-core/src/fluids/waves.ts`, `waveRest.ts`)
// into the GPU deformation's WGSL and the physics module's C++, and the coverage-preserving alpha
// (`packages/sdk-browser/src/texture/coverageMath.ts`) into the mip chains' WGSL and the
// compiler's Rust, and the compiler's cache formats and defaults, the animation tracks' layout and
// the family refusal's public code (`shared-rules/abi.ts`). The physics word layouts
// (`packages/sdk-core/src/physics/layout.ts`) go into the physics module's C++ the same way. The
// page format's constants, the DAG's cluster size and the page encoder's ABI words are written once
// in Rust (`packages/page-codec-wasm`, `dag.rs`) and printed into the TypeScript readers
// (`shared-rules/pageFormat.ts`), from which the WGSL routines are built; so are the versions, magics and
// layout numbers of the manifest's binary, the proxy, the cutout sheet and the impostor section, which the
// compiler writes (`shared-rules/formats.ts`). The printer reads the source's own syntax tree and keeps every operation in its
// order, so each language computes what the source writes, operand for operand. `--check` (a gate
// of `pnpm run validate`) fails when a printed file is not what its source prints today.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import prettier from 'prettier'
import { animationLayoutRust, compilerAbiRust, familyLoadFailedId } from './shared-rules/abi.ts'
import { coverageRust, coverageWgsl } from './shared-rules/coverage.ts'
import { writtenFormatsTs } from './shared-rules/formats.ts'
import { physicsLayoutHeader } from './shared-rules/layout.ts'
import { REPOSITORY_ROOT } from './repository-files.ts'
import { pageEncoderAbiTs, pageFormatTs } from './shared-rules/pageFormat.ts'
import { waveModelHeader, waveTermsWgsl } from './shared-rules/waves.ts'

/** `text` as the repository formats a file of `path`'s kind. */
async function formatted(path: string, text: string) {
  if (path.endsWith('.ts')) {
    const config = await prettier.resolveConfig(join(REPOSITORY_ROOT, path))
    return prettier.format(text, { ...config, filepath: join(REPOSITORY_ROOT, path) })
  }
  if (path.endsWith('.rs')) {
    const done = spawnSync('rustfmt', ['--edition', '2021'], {
      input: text,
      encoding: 'utf8',
      cwd: join(REPOSITORY_ROOT, dirname(path)),
    })
    if (done.status !== 0) throw new Error(`rustfmt refused ${path}:\n${done.stderr}`)
    return done.stdout
  }
  return text
}

const outputs: Record<string, () => string> = {
  'packages/sdk-browser/src/deformation/waveTermsWgsl.ts': waveTermsWgsl,
  'packages/physics-jolt-wasm/src/waveModel.h': waveModelHeader,
  'packages/physics-jolt-wasm/src/layout.h': physicsLayoutHeader,
  'packages/sdk-browser/src/texture/coverageMathWgsl.ts': coverageWgsl,
  'packages/sdk-core/src/page/format.ts': pageFormatTs,
  'packages/sdk-core/src/contracts/writtenFormats.ts': writtenFormatsTs,
  'packages/sdk-browser/src/wasm/encodeAbi.ts': pageEncoderAbiTs,
  'packages/asset-compiler-rust/src/texture_preview/coverage_math.rs': coverageRust,
  'packages/asset-compiler-rust/src/shared_math/abi.rs': compilerAbiRust,
  'packages/page-codec-wasm/src/anim_layout.rs': animationLayoutRust,
  'packages/sdk-browser/src/host/familyLoadFailedId.ts': familyLoadFailedId,
}

const stale: string[] = []
for (const [path, print] of Object.entries(outputs)) {
  const text = await formatted(path, print())
  if (!process.argv.includes('--check')) writeFileSync(join(REPOSITORY_ROOT, path), text)
  else if (readFileSync(join(REPOSITORY_ROOT, path), 'utf8') !== text) stale.push(path)
}
if (stale.length)
  throw new Error(
    `printed from an older source: ${stale.join(', ')}; run \`pnpm run generate:shared-rules\``,
  )
