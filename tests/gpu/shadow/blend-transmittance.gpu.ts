// A transparent caster's coloured transmission on the GPU (`transmittanceWgsl.ts`): the shipped
// `blendTransmittance`, `volumeBoundary` and `volumeWorldThickness` run on one known page, its
// surface's record written by the engine's material table (`materialTable.ts`) and bound at the
// number the shadow's page group binds it at, their arithmetic read back. The two material reads it
// calls are the proof's: a half alpha, a fixed colour.
//
//   node bench/dawn/proofs.ts tests/gpu/shadow/blend-transmittance.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeOnDawn } from '../kit/computeRun.ts'
import { blendTransmittanceWgsl } from '../../../packages/sdk-browser/src/gpu/shadow/transmittanceWgsl.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../../../packages/sdk-browser/src/visibility/shader/pageWgsl.ts'
import { createMaterialTable } from '../../../packages/sdk-browser/src/webgpu/material/materialTable.ts'
import { VIS_BINDINGS } from '../../../packages/sdk-browser/src/webgpu/core/bindLayout.ts'
import { declareSurface } from '../../../packages/sdk-browser/src/page/surfaceRecord.ts'
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

/** A white, fully opaque glass two units thick, its volume's colour (0.5, 0.25, 1) over 2. */
const GLASS = declareSurface({
  family: 'physical',
  transmission: 1,
  thickness: 2,
  attenuationColor: { r: 0.5, g: 0.25, b: 1 },
  attenuationDistance: 2,
})

const SHADER = wgslProgram(
  `@group(0) @binding(0) var<storage,read_write> result:array<vec4f>;
@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id:vec3u){
 var p:PageInfo;p.world=mat4x4f(vec4f(1,0,0,0),vec4f(0,1,0,0),vec4f(0,0,1,0),vec4f(0,0,0,1));
 p.material=0u;
 if(id.x==1u){p.flags=12u;}
 if(id.x<2u){result[id.x]=blendTransmittance(p,vec2f(0),vec2f(1,0),vec2f(0,1),vec3f(0,0,1));}
 else{result[id.x]=vec4f(select(0.0,1.0,volumeBoundary(p,true)),select(0.0,1.0,volumeBoundary(p,false)),volumeWorldThickness(p,vec3f(0,0,1)),1.0);}
}`,
  [PAGE_INFO_STRUCT_WGSL, blendTransmittanceWgsl(MASK_ALPHA, COLOR_SAMPLE)],
)

/** The glass's record, the table's first: rank 0, the word the page names. */
function records(device: GPUDevice): GPUBindGroupEntry[] {
  const table = createMaterialTable()
  assert.equal(table.word(GLASS, { mapLayer: new Map(), dataLayer: new Map() }), 0)
  return [{ binding: VIS_BINDINGS.material, resource: table.upload(device) }]
}

/** `values` against `expected`, each within the law's f32 rounding (`volume-law.gpu.ts`). */
const near = (values: number[], expected: number[]) =>
  values.every((value, i) => Math.abs(value - expected[i]) < 1e-6)

test('a volume tints by its attenuation over its world path, its map by colour and alpha, once', async () => {
  const { values, errors } = await computeOnDawn(SHADER, 48, 3, { setupNumbered: records })
  assert.deepEqual(errors, [])
  // The plain page: the attenuation colour over a path equal to its distance, fully covered.
  assert.ok(near(values.slice(0, 4), [0.5, 0.25, 1, 0]), `${values.slice(0, 4)}`)
  // The mapped page: half its alpha covers, its colour tints what the attenuation leaves.
  assert.ok(near(values.slice(4, 8), [0.5625, 0.5625, 1, 0.5]), `${values.slice(4, 8)}`)
  // The front face bounds the volume, the back one does not; the world path is the thickness.
  assert.deepEqual(values.slice(8, 12), [1, 0, 2, 1])
})
