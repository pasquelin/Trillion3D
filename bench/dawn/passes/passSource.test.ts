import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findPassSources, labelStem } from './passSource.ts'

const SOURCES: [string, string][] = [
  ['a/labels.ts', "export const TAA_PASS = 'Trillion3D temporal antialiasing'\n"],
  [
    'a/taa.ts',
    "import { TAA_SHADER } from './taaWgsl.ts'\nimport { TAA_PASS } from './labels.ts'\n\nexport function encodeTaa(encoder) {\n  const pass = encoder.beginRenderPass({ label: TAA_PASS })\n  pass.end()\n}\n",
  ],
  [
    'b/raster.ts',
    "import { SHADER } from './rasterWgsl.ts'\nclass Raster {\n  encode(encoder, k) {\n    encoder.beginRenderPass({ label: `vsm.render.raster ${k}` })\n  }\n}\n",
  ],
]

test('a label constant leads to the file that begins the pass, its function and its shaders', () => {
  const found = findPassSources(SOURCES, ['temporal antialiasing'])
  const taa = found.get('temporal antialiasing')!
  assert.equal(taa.file, 'a/taa.ts')
  assert.equal(taa.fn, 'encodeTaa')
  assert.equal(taa.line, 5)
  assert.deepEqual(taa.shaders, ['./taaWgsl.ts'])
})

test('a batch label with a number finds its templated label, a name nothing holds finds nothing', () => {
  const found = findPassSources(SOURCES, ['vsm.render.raster *', 'no such pass'])
  assert.equal(found.get('vsm.render.raster *')?.file, 'b/raster.ts')
  assert.equal(found.get('vsm.render.raster *')?.fn, 'encode')
  assert.equal(found.has('no such pass'), false)
  assert.equal(labelStem('Trillion3D vsm.render.raster 12'), 'vsm.render.raster')
})
