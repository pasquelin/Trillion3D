// The projections writing their sixteen slots one by one against their before-forms, which zeroed
// all sixteen first (`projectionBefore.fixture.ts`): on swept parameters, hostile values among
// them, at their thresholds (a centred box, a range of no thickness, a zero half extent of either
// sign), into `Float64Array`, `Float32Array` and plain arrays, every value keeps its bits and
// nothing past the sixteen is written.
import assert from 'node:assert/strict'
import test from 'node:test'
import type { NumberSink } from '../matrix/matrix4.ts'
import { orthographicProjection, perspectiveProjection } from './camera.ts'
import { forwardOrthographicProjection, forwardPerspectiveProjection } from './forwardZ.ts'
import {
  forwardOrthographicProjectionBefore,
  forwardPerspectiveProjectionBefore,
  orthographicProjectionBefore,
  perspectiveProjectionBefore,
} from './projectionBefore.fixture.ts'
import { HALTON_SWEEP } from '../sequence/sweep.fixture.ts'
import { assertSameBits, SENTINELS, sweepInput, typed } from '../sequence/moves.fixture.ts'

type Projection = (out: NumberSink, ...p: number[]) => NumberSink

/** `old` and `now` on the parameters `p`, into each buffer kind (eighteen sentinels, the two past
 *  the sixteen catching a stray write): same values, `out` returned. */
function same(old: Projection, now: Projection, p: number[], label: string) {
  for (let kind = 0; kind < 3; kind++) {
    const oldOut = typed(kind, SENTINELS),
      nowOut = typed(kind, SENTINELS)
    old(oldOut, ...p)
    assert.equal(now(nowOut, ...p), nowOut, `${label}: returns out`)
    assertSameBits(oldOut, nowOut, `${label} kind ${kind} (${p})`)
  }
}

test('perspectiveProjection, orthographicProjection, forwardPerspectiveProjection, forwardOrthographicProjection: sixteen writes keep every bit', () => {
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    // Six parameters of case `i` on `[lo, hi)`, hostile values mixed in.
    const swept = (slot: number, base: number, lo: number, hi: number) =>
      Array.from({ length: 6 }, (_, k) => sweepInput(i, slot + k, base, lo, hi))
    const [fov, aspect, near, zoom] = [
      sweepInput(i, 0, 2, 0, 180),
      sweepInput(i, 1, 3, 0.1, 4),
      sweepInput(i, 2, 5, 1e-4, 10),
      sweepInput(i, 3, 7, 0.1, 8),
    ]
    same(
      perspectiveProjectionBefore,
      perspectiveProjection,
      [fov, aspect, near, zoom],
      `persp ${i}`,
    )
    const box = swept(10, 3, -100, 100)
    same(orthographicProjectionBefore, orthographicProjection, box, `ortho ${i}`)
    // A centred box: the offsets at `+ 0`, never −0, whichever zero the sums give.
    const centred = [-box[1], box[1], -box[3], box[3], box[4], box[5]]
    same(orthographicProjectionBefore, orthographicProjection, centred, `ortho centred ${i}`)
    const [scale, near2, far2, hw, hh, depth] = swept(20, 5, -10, 10)
    same(
      forwardPerspectiveProjectionBefore,
      forwardPerspectiveProjection,
      [scale, near2, i & 1 ? far2 : near2],
      `forward persp ${i}`,
    )
    // A zero half extent, of either sign, one case in four on each axis.
    const zero = (v: number, bit: number) => (i & (3 << bit) ? v : i & (32 << bit) ? -0 : 0)
    same(
      forwardOrthographicProjectionBefore,
      forwardOrthographicProjection,
      [zero(hw, 1), zero(hh, 3), depth, sweepInput(i, 30, 2, -10, 10)],
      `forward ortho ${i}`,
    )
  }
})
