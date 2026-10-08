// A transparent caster's coloured transmission on the GPU (`transmittanceWgsl.ts`): the shipped
// `blendTransmittance`, `volumeBoundary` and `volumeWorldThickness` run on one known page, their
// arithmetic read back. The two material reads it calls are the proof's: a half alpha, a fixed
// colour.
//
//   node bench/dawn/proofs.ts tests/gpu/shadow/blend-transmittance.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeOnDawn } from '../kit/computeRun.ts'
import { blendTransmittanceWgsl } from '../../../packages/sdk-browser/src/gpu/shadow/transmittanceWgsl.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../../../packages/sdk-browser/src/visibility/shader/pageWgsl.ts'
import { wgslProgram } from '../../../packages/math/src/wgsl/assemble.ts'
import { wgslFn } from '../../../packages/math/src/wgsl/decl.ts'

/** The proof's material reads, the providers the transmittance takes: a half alpha, a fixed
 *  colour. */
const MASK_ALPHA = wgslFn(
  'maskAlpha',
  [],
  'fn maskAlpha(a:u32,b:vec2f,c:vec2f,d:vec2f,e:bool)->f32{return 0.5;}',
)
const COLOR_SAMPLE = wgslFn(
  'colorSample',
  [],
  'fn colorSample(a:u32,b:vec2f,c:vec2f,d:vec2f,e:bool)->vec4f{return vec4f(0.25,0.5,1.0,0.5);}',
)

const SHADER = wgslProgram(
  `@group(0) @binding(0) var<storage,read_write> result:array<vec4f>;
@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id:vec3u){
 var p:PageInfo;p.world=mat4x4f(vec4f(1,0,0,0),vec4f(0,1,0,0),vec4f(0,0,1,0),vec4f(0,0,0,1));
 p.transmission=1.0;p.thickness=2.0;p.blendCoverage=1.0;p.baseColor=vec4f(1.0);
 p.attenuationRG=vec2f(0.5,0.25);p.attenuationB=1.0;p.attenuationDistance=2.0;
 if(id.x==1u){p.flags=12u;}
 if(id.x<2u){result[id.x]=blendTransmittance(p,vec2f(0),vec2f(1,0),vec2f(0,1),vec3f(0,0,1));}
 else{result[id.x]=vec4f(select(0.0,1.0,volumeBoundary(p,true)),select(0.0,1.0,volumeBoundary(p,false)),volumeWorldThickness(p,vec3f(0,0,1)),1.0);}
}`,
  [PAGE_INFO_STRUCT_WGSL, blendTransmittanceWgsl(MASK_ALPHA, COLOR_SAMPLE)],
)

test('a volume tints by its attenuation over its world path, its map by colour and alpha, once', async () => {
  const { values, errors } = await computeOnDawn(SHADER, 48, 3)
  assert.deepEqual(errors, [])
  // The plain page: the attenuation colour over a path equal to its distance, fully covered.
  assert.deepEqual(values.slice(0, 4), [0.5, 0.25, 1, 0])
  // The mapped page: half its alpha covers, its colour tints what the attenuation leaves.
  assert.deepEqual(values.slice(4, 8), [0.5625, 0.5625, 1, 0.5])
  // The front face bounds the volume, the back one does not; the world path is the thickness.
  assert.deepEqual(values.slice(8, 12), [1, 0, 2, 1])
})
