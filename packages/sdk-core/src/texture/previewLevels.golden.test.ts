import test from 'node:test'
import { assertGolden } from '../../../math/src/golden.fixture.ts'
import { previewFirstLevel, previewLastLevel } from './previewLevels.ts'

test('previewFirstLevel and previewLastLevel return their Rust twins’ levels on every reference case', () => {
  assertGolden('preview_levels', 'preview_levels', ([width, height]) => [
    previewFirstLevel(width, height),
    previewLastLevel(width, height),
  ])
})
