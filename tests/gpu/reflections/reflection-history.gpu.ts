// The rough reflection's sample and history on the GPU: the shipped GGX importance sample
// (`ggxSampleWgsl.ts`) and the f16 history's arithmetic, read back; and the opaque programs that
// read them — the rough trace and resolve, the lit surface with its screen reflections, the
// visibility shading — built into pipelines on a device opened as the engine opens it.
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/reflection-history.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { SHADE_SHADER } from '../../../packages/sdk-browser/src/visibility/shader/shadeWgsl.ts'
import { stochasticReflectionShader } from '../../../packages/sdk-browser/src/reflections/sampleWgsl.ts'
import { GGX_REFLECTION_SAMPLE_WGSL } from '../../../packages/sdk-browser/src/reflections/ggxSampleWgsl.ts'
import { STANDARD_LIGHTING_WGSL } from '../../../packages/sdk-browser/src/lighting/standardLighting.ts'
import { REFLECTION_RESOLVE_WGSL } from '../../../packages/sdk-browser/src/reflections/resolveWgsl.ts'
import { HASH_UNIT_WGSL } from '../../../packages/sdk-browser/src/math/hashUnitWgsl.ts'
import { contractLightingShader } from '../../../packages/sdk-browser/src/lighting/deferred/shaders.ts'
import { withScreenReflections } from '../../../packages/sdk-browser/src/reflections/screenWgsl.ts'
import { shaderErrors } from '../../../packages/sdk-browser/src/gpu/core/shaderModule.ts'
import { computeReadback } from '../kit/computeReadback.ts'
import { runOnDawn } from '../kit/onDawn.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'

// The sample at normal incidence (R = N = z): its direction, its weight against the explicit PDF
// ratio, and the lobe's mean cosine at four roughnesses; then a long f16 history of a constant
// HDR source, a highlight into it, and two replays of one seed.
const SAMPLE_WGSL = `${HASH_UNIT_WGSL}${GGX_REFLECTION_SAMPLE_WGSL}${STANDARD_LIGHTING_WGSL}
@group(0) @binding(0) var<storage,read_write> output:array<vec4f>;
@compute @workgroup_size(1) fn main(){
 let roughs=array<f32,4>(0.05,0.2,0.5,1.0);
 let N=vec3f(0.0,0.0,1.0);
 for(var r=0u;r<4u;r++){
  var lengthError=0.0;var weightError=0.0;var cosine=0.0;var weight=0.0;
  for(var i=0u;i<4096u;i++){
   let xi=min(vec2f(hashUnit(i),hashUnit(i^0x9e3779b9u)),vec2f(0.99999994));
   let s=stochasticReflection(N,N,roughs[r],xi);
   lengthError=max(lengthError,abs(length(s.xyz)-1.0));
   weightError=max(weightError,abs(s.w-max(s.z,0.0)));
   cosine+=s.z*s.w;weight+=s.w;
  }
  output[r]=vec4f(lengthError,weightError,cosine/weight,weight);
 }
 var mean=32000.0;
 for(var i=0u;i<20000u;i++){
  mean=unpack2x16float(pack2x16float(vec2f(mean+(32000.0-mean)/65.0,0.0))).x;
 }
 let highlight=unpack2x16float(pack2x16float(vec2f(mean+(64000.0-mean)/65.0,0.0))).x;
 let a=stochasticReflection(N,N,0.5,vec2f(hashUnit(9u),hashUnit(10u)));
 let b=stochasticReflection(N,N,0.5,vec2f(hashUnit(9u),hashUnit(10u)));
 output[4]=vec4f(mean,highlight,distance(a,b),abs(hashUnit(9u)-hashUnit(11u)));
}`

/** A program built into a render pipeline: its source and fragment entry point, and whether it
 *  is the visibility shading, drawn by `shade_vs` into the surface targets. */
type Program = { code: string; entry: string; visibility?: boolean }
const SURFACE_TARGETS: GPUTextureFormat[] = [
  'rgba16float',
  'rgba16float',
  'rgba16float',
  'r8uint',
  'r32uint',
]

async function run({ sample, programs }: { sample: string; programs: Program[] }) {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('no WebGPU adapter')
  const { device, errors } = gpu
  const compile = async (code: string, label: string) => {
    const module = device.createShaderModule({ code })
    const messages = await shaderErrors(module)
    errors.push(...messages.map((message) => `${label}: ${message.message}`))
    return messages.length ? undefined : module
  }
  // Every program built at once: the device compiles them side by side.
  await Promise.all(
    programs.map(async ({ code, entry, visibility }) => {
      const module = await compile(code, entry)
      if (!module) return
      const targets = visibility ? SURFACE_TARGETS : (['rgba16float'] as GPUTextureFormat[])
      await device
        .createRenderPipelineAsync({
          layout: 'auto',
          vertex: { module, entryPoint: visibility ? 'shade_vs' : 'fullscreen' },
          fragment: {
            module,
            entryPoint: entry,
            targets: targets.map((format) => ({ format })),
            constants: visibility ? { CLASS_KEY: 513 } : {},
          },
        })
        .catch((error: unknown) => errors.push(`${entry}: ${String(error)}`))
    }),
  )
  const module = await compile(sample, 'sample')
  if (!module) {
    await gpu.fermer()
    return { values: [], errors }
  }
  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  })
  const values = await computeReadback(device, pipeline, 80, 1)
  await gpu.fermer()
  return { values, errors }
}

test('the GGX sample weighs by its PDF, the f16 history holds, the opaque programs build', async () => {
  const programs: Program[] = [
    { code: REFLECTION_RESOLVE_WGSL, entry: 'resolveRoughReflection' },
    { code: SHADE_SHADER, entry: 'shade_fs', visibility: true },
  ]
  for (const bounce of [false, true])
    for (const narrow of [false, true]) {
      const shader = contractLightingShader(bounce, { narrow, lobeless: true })
      programs.push({ code: stochasticReflectionShader(shader), entry: 'traceRoughReflection' })
      programs.push({ code: withScreenReflections(shader, true), entry: 'lightSurface' })
    }
  const { values, errors } = await runOnDawn(run, { sample: SAMPLE_WGSL, programs })
  assert.deepEqual(errors, [])
  for (let r = 0; r < 4; r++) {
    assert.ok(values[r * 4] < 1e-5, 'a unit reflected direction')
    assert.ok(values[r * 4 + 1] < 1e-5, 'the explicit PDF cancels to the ratio weight')
    assert.ok(values[r * 4 + 3] > 0, 'a lobe with weight')
    if (r) assert.ok(values[r * 4 + 2] < values[(r - 1) * 4 + 2], 'roughness spreads the lobe')
  }
  assert.equal(values[16], 32000, 'a long history keeps a constant HDR source')
  assert.ok(values[17] > 32000 && values[17] < 64000, 'the f16 history still takes a highlight')
  assert.equal(values[18], 0, 'one seed replays the same sample')
  assert.ok(values[19] > 0, 'another rank draws another sample')
})
