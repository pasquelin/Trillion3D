// The rows' diagnostic word (`rowDiagnostic.ts`): the screen-error view writes each row's ratio in
// the row's own words — never in the next row's —, and the first image after gives the rows their
// level back.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ROW_WORDS } from '../../../visibility/types.ts'
import { PAGE_INFO } from '../../../visibility/pageInfo.ts'
import { postPackedBases } from '../../../page/selection/placements.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import type { EngineCamera } from '../../../camera/engineCamera.ts'
import { writeRowDiagnostics } from './rowDiagnostic.ts'

const IDENTITY = Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)

test('the screen-error view writes each row’s own word, then gives the rows their level back', () => {
  // A coarse row whose error is none: its ratio is zero, its level one.
  const rec = { role: 'coarse', lodError: 0, sphere: [0, 0, 0, 1] }
  const roots = [{ pages: [rec], world: { elements: IDENTITY } }]
  // Two rows' room, one packed: the row behind holds a sentinel no write may touch.
  const floats = new Float32Array(2 * ROW_WORDS).fill(7),
    marked: number[] = []
  const rt = {
    run: { diagnostic: 'screen-error', diagnosticPixelError: 1, diagnosticErrorShown: false },
    layout: {
      selectionRoots: roots,
      placement: postPackedBases(roots),
      rows: {
        pageTableFloats: floats,
        packedCount: 1,
        packedRecs: [rec],
        packedPageIndex: [0],
        markRowWords: (row: number) => marked.push(row),
      },
    },
    setup: { viewport: [640, 360] },
  } as unknown as WebgpuPagesRuntime
  const cam = {} as EngineCamera
  const word = (row: number) => floats[row * ROW_WORDS + PAGE_INFO.at.diagnosticWord]
  writeRowDiagnostics(rt, cam)
  assert.equal(word(0), 0, 'its ratio, in its own word')
  assert.ok(
    floats.subarray(ROW_WORDS).every((v) => v === 7),
    'no word of the next row written',
  )
  assert.deepEqual(marked, [0])
  assert.equal(rt.run.diagnosticErrorShown, true, 'the run state holds the ratio shown')
  rt.run.diagnostic = 'lod'
  writeRowDiagnostics(rt, cam)
  assert.equal(word(0), 1, 'its level back')
  assert.deepEqual(marked, [0, 0])
  assert.equal(rt.run.diagnosticErrorShown, false)
  writeRowDiagnostics(rt, cam)
  assert.deepEqual(marked, [0, 0], 'nothing more written')
})
