import test from 'node:test'
import assert from 'node:assert/strict'
import { LEAPS, segmentSpeed } from './trackSegment.ts'
import type { Track, TrackKind } from './clip.ts'
import { oldSegmentSpeed } from '../../../../../bench/oracles/core/length-rule.ts'
import { halton } from '../../../../math/src/sequence/halton.ts'
import { TAU } from '../../../../math/src/constants.ts'
import { screenErrorBound } from '../../lod/screenErrorBound.ts'

// The length rule moved `segmentSpeed` off `Math.hypot` (a vector's speed, a quaternion's lengths)
// and onto `slerpArc` (fdlibm's arc cosine and sine). The segment speed as it was written before,
// linear segments, is the oracle (`oldSegmentSpeed`). A cubic segment changed only in
// `normalised`'s guard, `|a| > 0 && |b| > 0`: its keys are f32, a nonzero one squares to at least
// 2^-298 in f64, so the root of the summed squares is nonzero exactly when `Math.hypot` is, and NaN
// fails both.

/** A unit quaternion from three numbers of [0, 1) (Shoemake's uniform map). */
const turnOf = (u: number, v: number, w: number) => [
  Math.sqrt(1 - u) * Math.sin(TAU * v),
  Math.sqrt(1 - u) * Math.cos(TAU * v),
  Math.sqrt(u) * Math.sin(TAU * w),
  Math.sqrt(u) * Math.cos(TAU * w),
]

/** Segment `n` of the sweep, its kind by `n mod 4`: a vector, two unit keys, two keys a hair
 *  apart (the line), two keys of other lengths. */
function segment(n: number): [TrackKind, number[]] {
  const h = (base: number, shift = 0) => halton(n + shift, base)
  const a = turnOf(h(2), h(3), h(5)),
    b = turnOf(h(2, 4096), h(3, 4096), h(5, 4096))
  switch (n % 4) {
    case 0:
      return ['vector', [...a.slice(0, 3), ...b.slice(0, 3)].map((x) => 20 * x)]
    case 1:
      return ['quaternion', [...a, ...b]]
    case 2:
      return ['quaternion', [...a, ...a.map((x, c) => x + 1e-7 * (b[c] - 0.5))]]
    default:
      return ['quaternion', [...a.map((x) => x * (0.25 + 2 * h(7))), ...b.map((x) => x * h(7, 99))]]
  }
}

const EDGES: [TrackKind, number[]][] = [
  ['quaternion', [0, 0, 0, 1, 0, 0, 0, 1]],
  ['quaternion', [0, 0, 0, 1, 0, 0, 0, -1]],
  ['quaternion', [0, 0, 0, 1, 1, 0, 0, 0]],
  ['quaternion', [0, 0, 0, 0, 0, 0, 0, 1]],
  ['quaternion', [2 ** -149, 0, 0, 0, 0, 0, 0, 1]],
  ['quaternion', [-0, -0, 0, 1, 0.6, 0, 0, 0.8]],
  ['vector', [0, 0, 0, -0, 0, -0]],
  ['vector', [3, 4, 12, 0, 0, 0]],
]

test('a segment speed under the length rule keeps every decision and the hold verdict of the old one', () => {
  const cases = [...EDGES, ...Array.from({ length: 4096 }, (_, n) => segment(n + 1))]
  for (const [n, [kind, keys]] of cases.entries()) {
    const values = Float32Array.from(keys),
      width = values.length / 2,
      span = Math.fround(0.001 + 2 * halton(n + 1, 7))
    const tr: Track = { name: 'n.x', kind, times: Float32Array.of(0, span), values }
    const now = segmentSpeed(tr, 0, span, width),
      was = oldSegmentSpeed(values, kind, span, width)
    const seen = `segment ${n}: ${keys} → ${now} / ${was}`
    assert.equal(now === LEAPS, was === LEAPS, seen)
    assert.equal(Number.isFinite(now), Number.isFinite(was), seen)
    assert.equal(now > 0, was > 0, seen)
    if (!(was > 0) || !Number.isFinite(was)) continue
    // A rounding apart, relative 2^-46 at most (sixteen units in the last place on this sweep).
    assert.ok(Math.abs(now - was) <= 2 ** -46 * was, seen)
    // The hold verdict (`mixerHold.ts`): the drift this speed bounds over a frame, carried by a
    // lever, as pixels at a view, below half a pixel. The view's focal length puts the old drift
    // between a quarter and three quarters of a pixel, where a verdict could turn.
    const lever = 0.01 + halton(n + 1, 11),
      moved = (speed: number) => speed * lever * (1 / 120),
      depth = 1 + 99 * halton(n + 1, 13),
      focal = ((0.25 + 0.5 * halton(n + 1, 17)) * depth) / moved(was)
    const verdict = (speed: number) =>
      screenErrorBound(moved(speed), 1, 2 * halton(n + 1, 19), depth, 0.5, focal, 0.1) < 0.5
    assert.equal(verdict(now), verdict(was), seen)
  }
})
