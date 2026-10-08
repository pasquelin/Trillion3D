import test from 'node:test'
import { assertGolden } from '../../../../math/src/golden.fixture.ts'
import type { Track, TrackBinding } from './clip.ts'
import { sample } from './sample.ts'

test("a rotation track's sample returns the bits of the WebAssembly sampler on every reference case", () => {
  // Two linear keys at times 0 and 1, sampled once at t from a fresh binding: the Rust twin's
  // track (`page-codec-wasm/src/golden_tests.rs`).
  assertGolden('quaternion_slerp', 'quaternion_slerp', (v) => {
    const track: Track = {
      name: 'joint.quaternion',
      kind: 'quaternion',
      times: new Float32Array([0, 1]),
      values: new Float32Array(v.slice(0, 8)),
      interpolation: 'linear',
    }
    const bound: TrackBinding = {
      owner: {},
      field: 'quaternion',
      key: 0,
      value: new Float64Array(4),
    }
    return sample(track, v[8], bound)
  })
})
