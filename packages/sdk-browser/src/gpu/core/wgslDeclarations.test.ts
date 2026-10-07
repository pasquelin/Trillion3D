// The engine's shaders hold the maths library and their shared fragments as declarations their
// programs list (`packages/math/src/wgsl/`): no source writes a library declaration again, and no
// template splices a fragment's text, which would write it once per host that splices it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { ENGINE_SHADERS } from './engineShaders.fixture.ts'
import { unresolvedNames } from './wgslNames.fixture.ts'
import { CLUSTER_DECODING_SHADER } from '../../../../../tests/gpu/cluster/decodingKernel.ts'
import { DAG_SELECTION_SHADER_BEFORE } from '../../../../../bench/oracles/browser/cut-dispatches-wgsl.ts'
import { WGSL_LIBRARY } from '../../../../math/src/wgsl/library.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

/** Every source of the engine, test and fixture files aside, by its path under `src/`. */
function sources() {
  const root = new URL('../../', import.meta.url)
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !/\.(test|fixture)\.ts$/.test(file))
    .map((file) => [file, readFileSync(new URL(file, root), 'utf8')] as const)
}

test('no shader declares a name of the WGSL library outside the library', () => {
  // A shader lists the library's declarations: no source of the engine writes one, and a program
  // holds each library name once, as the library's very text — another text is a second formula.
  const written: string[] = []
  for (const [file, text] of sources())
    for (const decl of WGSL_LIBRARY)
      if (new RegExp(`\\b(?:fn|const|struct)\\s+${decl.name}\\b`).test(text))
        written.push(`${file}: ${decl.name}`)
  assert.deepEqual(written, [])
  const shaders = { ...ENGINE_SHADERS, CLUSTER_DECODING_SHADER, DAG_SELECTION_SHADER_BEFORE }
  const apart: string[] = []
  for (const decl of WGSL_LIBRARY) {
    const declares = new RegExp(`\\b${decl.kind}\\s+${decl.name}\\b`, 'g')
    for (const [name, code] of Object.entries(shaders)) {
      const count = code.match(declares)?.length ?? 0
      if (count > 1 || (count === 1 && !code.includes(decl.text)))
        apart.push(`${name}: ${decl.name}`)
    }
  }
  assert.deepEqual(apart, [])
  // The library on its own declares every name it uses: no shader has to lend it one.
  assert.deepEqual(unresolvedNames(wgslModule(...WGSL_LIBRARY)), [])
})

/** A shared fragment's name: `X_WGSL`, or a factory `xWgsl(…)`; an expression or a statement a
 *  host writes in a body is named otherwise (`FULLSCREEN_XY`, `MIRROR_TERM`). */
const SPLICE =
  /\$\{\s*([A-Za-z_]\w*(?:_WGSL|Wgsl))\b|\b([A-Z][A-Z0-9_]*_WGSL)\s*\+|\+\s*([A-Z][A-Z0-9_]*_WGSL)\b/g

test('a shared fragment is a declaration its hosts list, never text spliced into another shader', () => {
  // A fragment spliced as text is written again by every host that splices it, and two hosts in
  // one program write it twice; a `wgslBlock` refuses the splice (`decl.ts`), a plain string
  // would not: the source holds none.
  const spliced = sources().flatMap(([file, text]) =>
    [...text.matchAll(SPLICE)].map((match) => `${file}: ${match[1] ?? match[2] ?? match[3]}`),
  )
  assert.deepEqual(spliced, [])
})

test('the splice reader finds a fragment spliced or added, and leaves a parameter alone', () => {
  const found = (text: string) => [...text.matchAll(SPLICE)].map((m) => m[1] ?? m[2] ?? m[3])
  assert.deepEqual(found('const A = `${EDGE_WGSL}\nfn f(){}`'), ['EDGE_WGSL'])
  assert.deepEqual(found('const B = `${normalAtlasWgsl(6)}`'), ['normalAtlasWgsl'])
  assert.deepEqual(found('const C = VIS_SHADER + DIAGNOSTIC_VIS_WGSL'), ['DIAGNOSTIC_VIS_WGSL'])
  assert.deepEqual(found('const D = `vec4f(${FULLSCREEN_XY},0.0,1.0)${MIRROR_TERM}`'), [])
})
