// The shipped sphere kernel (`composeSphere`, `placement/gpuComposeWgsl.ts`) run on a device over
// generated worlds and boxes, and its words beside the CPU's (`placement/rowSphere.ts`, the same
// formula in `Math.fround` steps): the centre's two singles and the radius, as the device holds them.
import { runCompute } from '../kit/computeRun.ts'
import { SPHERE_WGSL } from '../../../packages/sdk-browser/src/placement/gpuComposeWgsl.ts'
import { ROW_INPUT_DOUBLES } from '../../../packages/sdk-browser/src/placement/composedRowPack.ts'
import { sphereRadius } from '../../../packages/sdk-browser/src/placement/rowSphere.ts'
import { wgslProgram } from '../../../packages/math/src/wgsl/assemble.ts'
import { random } from '../../../packages/sdk-browser/src/page/cut/cutRuleChecks.fixture.ts'
import { generated } from '../../../packages/sdk-browser/src/placement/composeDoubles.fixture.ts'
import { packDoubles } from '../../../packages/math/src/float/splitDouble.ts'
import { transformAffinePoint } from '../../../packages/sdk-core/src/index.ts'

const CASES = 600

const code = wgslProgram(
  `@group(0) @binding(0) var<storage,read> worlds:array<vec2u>;
@group(0) @binding(1) var<storage,read> inputs:array<vec2u>;
@group(0) @binding(2) var<storage,read_write> spheres:array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u){
 let row=g.x;if(row>=${CASES}u){return;}
 var world:array<vec2u,16>;
 for(var k=0u;k<16u;k++){world[k]=worlds[row*16u+k];}
 composeSphere(row,world);
}`,
  [SPHERE_WGSL],
)

/** The device's words and the CPU's for `CASES` generated rows: how many differ, and by how much. */
export async function runSphere() {
  const next = random(5)
  const worlds = new Uint32Array(CASES * 32),
    inputs = new Uint32Array(CASES * ROW_INPUT_DOUBLES * 2)
  const expected: number[] = []
  const f32 = new Float32Array(1),
    bits = new Uint32Array(f32.buffer)
  const word = (x: number) => ((f32[0] = x), bits[0])
  const c = new Float64Array(3)
  for (let i = 0; i < CASES; i++) {
    const far = [10, 1e3, 1e6][i % 3],
      w = generated(next, far)
    const centre = [0, 1, 2].map(() => (next() - 0.5) * 40),
      half = [0, 1, 2].map(() => 0.001 + next() * 5)
    packDoubles(worlds, i * 32, w)
    packDoubles(inputs, i * ROW_INPUT_DOUBLES * 2, [...centre, ...half])
    transformAffinePoint(c, w, centre[0], centre[1], centre[2], 0)
    const row = new Array(8).fill(0)
    for (let a = 0; a < 3; a++) {
      const high = Math.fround(c[a])
      row[a] = word(high)
      row[4 + a] = word(Math.fround(c[a] - high))
    }
    row[3] = word(sphereRadius(w, centre, half))
    expected.push(...row)
  }
  const run = await runCompute({
    code,
    bytes: CASES * 8 * 4,
    workgroups: Math.ceil(CASES / 64),
    options: { inputs: [worlds, inputs], words: 'u32' },
  })
  if (!run.values.length) return { errors: run.errors, adapter: run.adapter }
  const device = run.values as number[]
  let centreDiffers = 0,
    radiusDiffers = 0,
    radiusUlps = 0,
    below = 0
  for (let i = 0; i < CASES; i++) {
    for (const k of [0, 1, 2, 4, 5, 6])
      if (device[i * 8 + k] !== expected[i * 8 + k]) centreDiffers++
    const d = device[i * 8 + 3],
      e = expected[i * 8 + 3]
    if (d !== e) {
      radiusDiffers++
      radiusUlps = Math.max(radiusUlps, Math.abs(d - e))
    }
  }
  return {
    adapter: run.adapter,
    errors: run.errors,
    centreDiffers,
    radiusDiffers,
    radiusUlps,
    below,
  }
}
