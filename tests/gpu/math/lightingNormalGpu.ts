// Lighting normals as the GPU computes them: `NORMAL_TRANSFORM_WGSL` and `STANDARD_LIGHTING_WGSL` —
// the texts the engine assembles into its shading — run as they are on Dawn. Each case also carries
// the true world normal, in f64: the same lighting formula is evaluated twice on the GPU, with the
// rendered normal then with the true one, so the luminance gap rests on no CPU copy of the BRDF.
import assert from 'node:assert/strict'
import {
  NORMAL_TRANSFORM_WGSL,
  STANDARD_LIGHTING_WGSL,
} from '../../../packages/sdk-browser/src/lighting/standardLighting.ts'
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import { wgslProgram } from '../../../packages/math/src/wgsl/assemble.ts'
import { uniteOuZero } from '../../../packages/math/src/wgsl/inverseTranspose.ts'
import { inverseTransposeBeforeIn } from './substitutionBefore.ts'
import { runOnDawn } from '../kit/onDawn.ts'
import { openGpuModule } from '../kit/webgpuDevice.ts'
import type { GpuRow, LitCase } from './lightingNormalCases.ts'

const WORKGROUP = 64

/**
 * `xformNormal` SUBSTITUTIONS, to put the PROOF itself to the test.
 *
 * A proof that never meets a fault proves nothing, and so it once was here: the gap criterion took
 * the dot product's absolute value and accepted `atan2(0, 0) = 0`, so a flipped or lost normal
 * passed. These expressions change `xformNormal`'s OUTPUT exactly where lighting reads it — the
 * shipped shader compiled and run as it is, only its return value changed. A proof given them must
 * FAIL; if it stays green, its criterion is wrong.
 */
export const SUBSTITUTIONS = {
  /** The shipped shader, untouched: the only one that may leave the proof green. */
  none: 'N',
  /** N → −N: the flipped normal, what a missed inverse-transpose does most often. */
  flipped: '-N',
  /** N → 0: the lost normal, which `normalize` turns into NaN and a zero angle once passed. */
  lost: 'vec3f(0.0,0.0,0.0)',
}

/** A fixed view and albedo: only the normal's orientation changes from case to case. */
const lightingWgsl = (substitution: string) =>
  wgslProgram(
    `
struct Case{world:mat4x4f,normal:vec4f,truth:vec4f,light:vec4f,material:vec4f,}
@group(0) @binding(0) var<storage, read> cases:array<Case>;
@group(0) @binding(1) var<storage, read_write> out:array<vec4f>;
fn probed(N:vec3f)->vec3f{return ${substitution};}
@compute @workgroup_size(${WORKGROUP}) fn normals(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;
 if(i>=arrayLength(&cases)){return;}
 let c=cases[i];
 let N=probed(xformNormal(c.world,c.normal.xyz));
 let V=vec3f(0.0,0.0,1.0);
 let rgb=vec3f(0.8,0.7,0.6);
 let lit=standardLighting(rgb,c.material.x,c.material.y,N,V,c.light);
 let truth=standardLighting(rgb,c.material.x,c.material.y,uniteOuZero(c.truth.xyz),V,c.light);
 out[i*3u]=vec4f(N,0.0);
 out[i*3u+1u]=vec4f(lit,0.0);
 out[i*3u+2u]=vec4f(truth,0.0);
}`,
    [NORMAL_TRANSFORM_WGSL, uniteOuZero, STANDARD_LIGHTING_WGSL],
  )

type Input = { shader: string; data: Float32Array<ArrayBuffer>; count: number }

/** On Dawn: one pipeline, every case at once, the output read back. */
async function run({ shader, data, count }: Input) {
  const opened = await openGpuModule(shader)
  if (!opened.module) throw new Error(JSON.stringify(opened))
  const { gpu, module } = opened
  const { device, errors } = gpu
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'normals' },
  })
  const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  const input = device.createBuffer({ size: data.length * 4, usage: STORAGE })
  device.queue.writeBuffer(input, 0, data)
  const bytes = count * 3 * 16
  const output = device.createBuffer({ size: bytes, usage: STORAGE })
  const group = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [input, output].map((buffer, binding) => ({ binding, resource: { buffer } })),
  })
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroups(Math.ceil(count / WORKGROUP))
  pass.end()
  device.queue.submit([encoder.finish()])
  const values = Array.from(new Float32Array((await readGpuBuffer(device, output, bytes))!.buffer))
  const adapter = (await gpu.fermer()).court
  return { adapter, values, errors }
}

/**
 * The normal the GPU renders for each case, and the two lit colours (`GpuRow`).
 *
 * `before` puts the inverse-transpose from before the fix back into the program
 * (`inverseTransposeBeforeIn`), to run two versions on the same cases;
 * `substitution` changes `xformNormal`'s output without touching the shipped shader, to put the
 * criterion to the test (`SUBSTITUTIONS`). Both are made sure of, not hoped for: the substitution
 * appears once and only once in the assembled text, and `xformNormal` is called once in it — one
 * that did not take would give a green run that exercised nothing.
 */
export async function lightNormals(
  cases: LitCase[],
  { before = false, substitution = SUBSTITUTIONS.none } = {},
): Promise<{ adapter: string; rows: GpuRow[] }> {
  const shipped = lightingWgsl(substitution)
  const shader = before ? inverseTransposeBeforeIn(shipped, 'the lighting normals') : shipped
  const count = (text: string) => shader.split(text).length - 1
  assert.equal(count(`return ${substitution};`), 1, `substitution "${substitution}" not applied`)
  assert.equal(count('probed(xformNormal('), 1, 'xformNormal is no longer the probed output')
  const data = Float32Array.from(
    cases.flatMap((c) => [
      ...c.world,
      ...c.normal,
      0,
      ...c.truth,
      0,
      ...c.light,
      ...[c.metal, c.roughness, 0, 0],
    ]),
  )
  const { adapter, values, errors } = await runOnDawn(run, { shader, data, count: cases.length })
  assert.deepEqual(errors, [], 'WebGPU errors while lighting')
  const rows = cases.map((_, i) => ({
    rendered: values.slice(i * 12, i * 12 + 3),
    litRendered: values.slice(i * 12 + 4, i * 12 + 7),
    litTrue: values.slice(i * 12 + 8, i * 12 + 11),
  }))
  return { adapter, rows }
}
