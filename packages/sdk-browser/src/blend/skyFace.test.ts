// The blend stage of the sky meshes' capture: the blends' own fragment stage with each pixel's depth written, compiled when a face asks it, and
// drawing no transmissive nor water rank.
import test from 'node:test'
import assert from 'node:assert/strict'
import { gatedDevice } from '../lighting/deferred/gatedDevice.fixture.ts'
import { blendVariantPipeline } from '../diagnostic/gpuVariant.ts'
import { createSkyFacePipelines } from './skyFace.ts'
import { pipelineBase, transmitBase, WATER_BASE } from './plan/planCull.ts'
import { blendShader } from './shader.ts'
import { FULL_CONTRACT } from '../lighting/deferred/contractCuts.ts'
import { FLAG_FOG_FREE } from '../visibility/types.ts'
import { MATERIAL_FLAG } from '../materials/table/materialLayout.ts'

const RANK = pipelineBase('normal', 'unlit')

function armed() {
  const gpu = gatedDevice()
  const layout = gpu.device.createBindGroupLayout({ entries: [] })
  const stage = createSkyFacePipelines(
    gpu.device,
    {} as GPUShaderModule,
    layout,
    blendVariantPipeline(undefined),
    false,
  )
  return { ...gpu, stage }
}

test('the stage is asked by the draw that reaches a rank, compiled off the frame, and not drawn until it is', async () => {
  const { stage, land, compiled } = armed()
  assert.equal(compiled.async, 0, 'nothing is compiled with the program')
  assert.equal(stage.at(RANK), undefined, 'asked: still compiling')
  assert.ok(compiled.async > 0)
  assert.equal(compiled.sync, 0, 'no frame compiles one')
  await land()
  assert.ok(stage.at(RANK), 'compiled')
})

test('its pipelines write the depth of the pixels they draw', async () => {
  const { stage, land } = armed()
  stage.at(RANK)
  await land()
  const pipeline = stage.at(RANK) as unknown as GPURenderPipelineDescriptor
  assert.equal(pipeline.depthStencil?.depthWriteEnabled, true)
  assert.equal(
    pipeline.depthStencil?.depthCompare,
    'greater-equal',
    'the nearer wins (reversed depth)',
  )
})

test('a transmissive or water rank is left out of the draw', () => {
  const { stage } = armed()
  const ranks = [transmitBase(false, false), WATER_BASE]
  assert.deepEqual(
    ranks.map((rank) => stage.skips?.(rank)),
    [true, true],
  )
  assert.deepEqual(
    ranks.map((rank) => stage.at(rank)),
    [undefined, undefined],
  )
  assert.equal(stage.skips?.(RANK), false)
})

test('a sky surface writes an opaque layer, its cutout alone reading the base alpha', () => {
  const code = blendShader(FULL_CONTRACT)
  const sky = MATERIAL_FLAG.sky
  assert.ok(
    code.includes('let alpha=select(blendAlpha(in,base),1.0,'),
    'the layer the surface writes',
  )
  assert.ok(code.includes('!(blendAlpha(in,base)<in.alphaAo.x'), 'the cutout reads the base alpha')
  assert.ok(
    code.includes(`&${sky}u)!=0u)`),
    'the sky flag is the material fact the triangle word carries',
  )
})

test('a sky surface takes no fog of its own, in the sky pass nor in a face of the capture: the fog opt-out bit is set on its row', () => {
  // The bit a material's fog opt-out sets in an item's flags is the bit of `FLAG_FOG_FREE`, which the fragment reads (`fogFreeFlag`).
  assert.equal(FLAG_FOG_FREE, 1 << 20)
  assert.ok(blendShader(FULL_CONTRACT).includes(`(flags&${FLAG_FOG_FREE}u)!=0u`))
})
