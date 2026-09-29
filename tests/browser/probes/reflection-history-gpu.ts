// Diagnostic arithmetic/pipeline validation only: no image or frame-time proof.
import test from 'node:test';
import { SHADE_SHADER } from '../../../packages/sdk-browser/src/visibility/shader/shadeWgsl.ts';
import assert from 'node:assert/strict';
import {
  GGX_REFLECTION_SAMPLE_WGSL,
  stochasticReflectionShader,
} from '../../../packages/sdk-browser/src/reflections/sampleWgsl.ts';
import { REFLECTION_RESOLVE_WGSL } from '../../../packages/sdk-browser/src/reflections/resolveWgsl.ts';
import { HASH_UNIT_WGSL } from '../../../packages/sdk-browser/src/math/hashUnitWgsl.ts';
import { contractLightingShader } from '../../../packages/sdk-browser/src/lighting/deferred/shaders.ts';
import { withScreenReflections } from '../../../packages/sdk-browser/src/reflections/screenWgsl.ts';
import { dansPageWebgpu } from './pageWebgpu.ts';

const compute = `${HASH_UNIT_WGSL}${GGX_REFLECTION_SAMPLE_WGSL}
@group(0) @binding(0) var<storage,read_write> output:array<vec4f>;
@compute @workgroup_size(1) fn main(){
 let roughs=array<f32,4>(0.05,0.2,0.5,1.0);
 for(var r=0u;r<4u;r++){
  var lengthError=0.0;var weightError=0.0;var cosine=0.0;var weight=0.0;
  for(var i=0u;i<4096u;i++){
   let xi=min(vec2f(hashUnit(i),hashUnit(i^0x9e3779b9u)),vec2f(0.99999994));
   let s=stochasticReflection(vec3f(0.0,0.0,1.0),roughs[r],xi);
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
 let a=stochasticReflection(vec3f(0.0,0.0,1.0),0.5,vec2f(hashUnit(9u),hashUnit(10u)));
 let b=stochasticReflection(vec3f(0.0,0.0,1.0),0.5,vec2f(hashUnit(9u),hashUnit(10u)));
 output[4]=vec4f(mean,highlight,distance(a,b),abs(hashUnit(9u)-hashUnit(11u)));
}`;

type DiagnosticInput = {
  compute: string;
  renders: { code: string; entry: string; visibility?: boolean }[];
};
async function diagnose(input: DiagnosticInput) {
  const opened = await globalThis.openGpuDevice();
  if (!opened) return { unavailable: true, values: [], errors: [] as string[] };
  const { device, errors } = opened;
  for (const source of input.renders) {
    const made = await opened.compile(source.code);
    errors.push(...made.compilation.map((message) => `${source.entry}: ${message}`));
    if (!made.compilation.length) {
      try {
        await device.createRenderPipelineAsync({
          layout: 'auto',
          vertex: {
            module: made.module,
            entryPoint: source.visibility ? 'shade_vs' : 'fullscreen',
          },
          fragment: {
            module: made.module,
            entryPoint: source.entry,
            targets: source.visibility
              ? ['rgba16float', 'rgba16float', 'rgba16float', 'r8uint', 'r32uint'].map(
                  (format) => ({ format: format as GPUTextureFormat }),
                )
              : [{ format: 'rgba16float' }],
            constants: source.visibility ? { CLASS_KEY: 513 } : {},
          },
        });
      } catch (error) {
        errors.push(`${source.entry}: ${String(error)}`);
      }
    }
  }
  const made = await opened.compile(input.compute);
  errors.push(...made.compilation);
  if (errors.length) {
    await opened.fermer();
    return { unavailable: false, values: [], errors };
  }
  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module: made.module, entryPoint: 'main' },
  });
  const values = await globalThis.computeReadback(device, pipeline, 80, 1);
  await opened.fermer();
  return { unavailable: false, values, errors };
}

if (import.meta.main)
  test('stochastic GGX GPU arithmetic and complete opaque pipelines', async () => {
    const renders: DiagnosticInput['renders'] = [
      { code: REFLECTION_RESOLVE_WGSL, entry: 'resolveRoughReflection' },
      { code: SHADE_SHADER, entry: 'shade_fs', visibility: true },
    ];
    for (const bounce of [false, true])
      for (const narrow of [false, true]) {
        const shader = contractLightingShader(bounce, narrow);
        renders.push({
          code: stochasticReflectionShader(shader, !bounce),
          entry: 'traceRoughReflection',
        });
        renders.push({ code: withScreenReflections(shader, !bounce, true), entry: 'lightSurface' });
      }
    const result = await dansPageWebgpu(
      diagnose,
      { compute, renders },
      { titre: 'Reflection arithmetic diagnostic' },
    );
    assert.equal(result.unavailable, false);
    assert.deepEqual(result.errors, []);
    for (let r = 0; r < 4; r++) {
      assert.ok(result.values[r * 4] < 1e-5, 'unit reflected direction');
      assert.ok(result.values[r * 4 + 1] < 1e-5, 'explicit PDF cancels to the ratio weight');
      assert.ok(result.values[r * 4 + 3] > 0, 'nonempty lobe');
      if (r)
        assert.ok(
          result.values[r * 4 + 2] < result.values[(r - 1) * 4 + 2],
          'roughness spreads the lobe',
        );
    }
    assert.equal(result.values[16], 32000, 'long history preserves a constant HDR source');
    assert.ok(
      result.values[17] > 32000 && result.values[17] < 64000,
      'bounded f16 history still accepts a highlight',
    );
    assert.equal(result.values[18], 0, 'identical seed replays identically');
    assert.ok(result.values[19] > 0, 'a different rank changes the sample');
  });
