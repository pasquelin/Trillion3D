// Defect this test catches (#831): `pageHeaderFor(page, surface)` named its flag after the
// transparent pass's group-0 texture `surface` (binding 28). The name shadows the global in WGSL
// (valid), but every reader of the text — `wgslStageBindings`, bindBudget — takes the word for a
// read of that binding by the vertex stage, which the layout hides from it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { VIS_SHADER, SHADE_SHADER } from '../buffer.ts'
import { BLEND_SHADER } from '../../gpu/core/shaderTexts.fixture.ts'

test('no parameter of a page-header function takes the name of a group-0 binding', () => {
  for (const [name, shader] of Object.entries({ VIS_SHADER, SHADE_SHADER, BLEND_SHADER })) {
    const globals = new Set(
      Array.from(
        shader.matchAll(/@group\(0\)\s*@binding\(\d+\)\s*var(?:<[^>]*>)?\s*(\w+)/g),
        (m) => m[1],
      ),
    )
    for (const [, fn, params] of shader.matchAll(
      /\bfn (page\w*Header\w*|cluster\w*Header)\(([^)]*)\)/g,
    ))
      for (const [, param] of params.matchAll(/(\w+)\s*:/g))
        assert.ok(
          !globals.has(param),
          `${name}: ${fn} has a parameter named like the binding ${param}`,
        )
  }
})
