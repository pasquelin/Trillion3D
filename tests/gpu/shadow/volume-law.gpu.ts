// The one volume law on the GPU (`volumeLaw.ts`, D10): the shadow's transmittance once took
// `c^(x / d)` per fragment, it now takes the water's `2^(k·x)`, `k = log2(c) / d` computed once in
// f64 and held in the surface's record. Over every 8-bit colour, distances from 10⁻³ to 10⁴ and
// paths from 0 to ten distances, the shipped `volumeTransmittance` is run beside the former form
// on the same device: they differ by far less than half an 8-bit step, and the new one keeps as
// close to the exact power. The edges are equal: a zero path lets all through, a black channel
// nothing past it, a white one all.
//
//   node bench/dawn/proofs.ts tests/gpu/shadow/volume-law.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeOnDawn } from '../kit/computeRun.ts'
import {
  VOLUME_LAW_WGSL,
  volumeAttenuation,
} from '../../../packages/sdk-browser/src/webgpu/transparent/volumeLaw.ts'
import { wgslProgram } from '../../../packages/math/src/wgsl/assemble.ts'

/** The distances, the paths a distance is crossed by (in tenths of ten distances) and the cases:
 *  every 8-bit colour against each. */
const DISTANCES = [1e-3, 1e-2, 0.1, 1, 10, 100, 1e3, 1e4]
const PATHS = 11
const CASES = 256 * DISTANCES.length * PATHS
const GROUP = 64

/** Each case's colour, distance, path and `k` as the record holds it (f64, then f32 once). */
const inputs = new Float32Array(CASES * 4)
for (let c = 0, at = 0; c < 256; c++)
  for (const d of DISTANCES)
    for (let p = 0; p < PATHS; p++, at += 4) {
      const colour = c / 255,
        path = (p / (PATHS - 1)) * 10 * d
      inputs.set([colour, d, path, volumeAttenuation([colour, 0, 0], d)[0]], at)
    }

/** The shipped law, and the former per-fragment form as the shadow wrote it, side by side. */
const SHADER = wgslProgram(
  `@group(0) @binding(0) var<storage,read> cases:array<vec4f>;
@group(0) @binding(1) var<storage,read_write> result:array<vec2f>;
fn formerLaw(colour:f32,distance:f32,path:f32)->f32{
 if(!(distance>0.0)){return 1.0;}
 let c=min(colour,1.0);
 return select(select(1.0,0.0,path!=0.0),pow(c,path/distance),c>0.0);
}
@compute @workgroup_size(${GROUP}) fn main(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=${CASES}u){return;}
 let q=cases[id.x];
 result[id.x]=vec2f(volumeTransmittance(vec3f(q.w),q.z).x,formerLaw(q.x,q.y,q.z));
}`,
  [VOLUME_LAW_WGSL],
)

test('the one law is the former within f32 rounding, the exact power within as much', async () => {
  const { values, errors } = await computeOnDawn(SHADER, CASES * 8, CASES / GROUP, {
    inputs: [inputs],
  })
  assert.deepEqual(errors, [])
  let apart = 0,
    shippedError = 0
  for (let i = 0; i < CASES; i++) {
    const [colour, d, path] = inputs.subarray(i * 4, i * 4 + 3)
    const shipped = values[i * 2],
      former = values[i * 2 + 1],
      exact = path === 0 ? 1 : colour === 0 ? 0 : colour ** (path / d)
    apart = Math.max(apart, Math.abs(shipped - former))
    shippedError = Math.max(shippedError, Math.abs(shipped - exact))
    // The edges, exactly: no path, a white channel, a black one past a zero path.
    if (path === 0 || colour === 1) assert.equal(shipped, 1, `case ${i}`)
    else if (colour === 0) assert.equal(shipped, 0, `case ${i}`)
  }
  // Half an 8-bit step is 1/510: the two forms are one image.
  assert.ok(apart < 1 / 510 / 64, `the forms differ by ${apart}`)
  assert.ok(shippedError < 1 / 510 / 64, `the shipped law is ${shippedError} off`)
})
