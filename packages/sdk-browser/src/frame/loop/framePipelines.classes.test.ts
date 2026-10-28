// The pipelines of the classes, surfaces and guides that enter the scene after preparation, asked at the frame entry.
import test from 'node:test'
import assert from 'node:assert/strict'
import { holdWebgpuFrame } from './hold.ts'
import { askFramePipelines } from './framePipelines.ts'
import { ensureGpuRaster } from '../render/encodeVisSetup.ts'
import { createGuideSet } from '../../guides/guideSet.ts'
import { noteClass } from '../../gpu/core/presentClasses.ts'
import { NO_RASTERS, graphRastersOf } from '../../materials/graph/graphRasters.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { families } from '../../session/host/families.ts'
import { drawFinalImage } from './hold.fixture.ts'
import { armed, census, classes, stageOf } from './framePipelines.fixture.ts'

await families.guides.load()

test('a class a material changed into compiles off the frame before the image that draws it', async () => {
  const armedRt = armed(),
    { rt, device, compiled } = armedRt
  const scene = census([5])
  Object.assign(rt.vis, { shadeCensus: scene, shadeClasses: await classes(armedRt, [5]) })
  askFramePipelines(rt)
  drawFinalImage(rt, device)
  assert.equal(holdWebgpuFrame(rt, device), true)
  assert.equal(rt.run.frameHeld, true, 'nothing moved: nothing asked')
  scene.keys = [5, 9]
  scene.moved()
  askFramePipelines(rt)
  assert.equal(holdWebgpuFrame(rt, device), true, 'the image is held on class 9')
  assert.equal(rt.run.frameHeld, false)
  await armedRt.land()
  const nine = rt.vis.shadeClasses!.of(9)
  assert.equal(nine.ready, true)
  assert.deepEqual(
    stageOf(nine.get()).constants,
    { CLASS_KEY: 9, FEEDBACK: 1 },
    'the class of before',
  )
  assert.equal(compiled.sync, 0, 'no frame compiled a class')
})

test('a graph whose mask or offset joined the session joins the set the modules hold, which are made again while the frame is held', async () => {
  const armedRt = armed(),
    { rt, device } = armedRt
  const told: string[] = []
  Object.assign(rt.diag, { engineDiagnostic: (code: string) => told.push(code) })
  const modules: string[] = []
  const make = device.createShaderModule.bind(device)
  device.createShaderModule = (d) => (modules.push(d.code), make(d))
  const scene = census([5])
  const shadeClasses = await classes(armedRt, [5])
  const masked = material.graph('surface')
  masked.output('baseColor', masked.constant(1, 0, 0))
  masked.output('opacityMask', masked.componentMask(masked.texCoord(0), 'r'))
  const swaying = material.graph('surface')
  swaying.output('worldPositionOffset', swaying.multiply(swaying.time(), swaying.constant(1, 0, 0)))
  Object.assign(rt.vis, {
    shadeCensus: scene,
    shadeClasses,
    rasters: NO_RASTERS,
    visBindGroupLayout: {},
  })
  scene.surfaces.push({ graph: masked }, { graph: swaying })
  scene.moved()
  askFramePipelines(rt)
  // The set holds both at once; the session is not opened again, the frame waits for the modules.
  const joined = graphRastersOf([{ graph: masked }, { graph: swaying }])
  assert.deepEqual(rt.vis.rasters.pixelPrograms, joined.pixelPrograms)
  assert.deepEqual(rt.vis.rasters.offsets, joined.offsets)
  assert.deepEqual([joined.pixelPrograms.length, joined.offsets.length], [1, 1])
  assert.deepEqual(told, ['material-graph-rasters-late'])
  assert.equal(holdWebgpuFrame(rt, device), true, 'held while the modules are made again')
  // Each compile it asks lands when the test says: the rebuild asks them one after the other.
  for (let round = 0; round < 20 && rt.vis.rasterRebuild; round++) await armedRt.land()
  assert.equal(rt.vis.rasterRebuild, undefined)
  const visModule = modules.find((code) => code.includes('fn vis_vs('))!
  assert.match(visModule, /fn mgOpacityMask\w*\(/, 'the visibility raster cuts by the graph')
  assert.match(visModule, /fn mgWorldPositionOffset\w*\(/, 'and moves its vertices')
  scene.moved()
  askFramePipelines(rt)
  assert.equal(told.length, 1, 'joined once')
})

test('a surface that came to emit switches the classes once those writing the layer compiled', async () => {
  const armedRt = armed(),
    { rt, device, compiled } = armedRt
  const scene = census([5, 9])
  const before = await classes(armedRt, [5, 9], false)
  assert.deepEqual(stageOf(before.of(5).get()).constants, {
    CLASS_KEY: 5,
    EMISSIVE_AO: 0,
    FEEDBACK: 1,
  })
  Object.assign(rt.vis, { shadeCensus: scene, shadeClasses: before, writesEmissiveAo: false })
  scene.emits = true
  scene.moved()
  askFramePipelines(rt)
  assert.equal(holdWebgpuFrame(rt, device), true, 'held on the classes writing the layer')
  assert.equal(rt.vis.shadeClasses, before, 'the set in place until they compiled')
  assert.equal(rt.vis.writesEmissiveAo, false)
  await armedRt.land()
  askFramePipelines(rt)
  const after = rt.vis.shadeClasses!
  assert.notEqual(after, before)
  assert.equal(rt.vis.writesEmissiveAo, true)
  for (const key of [5, 9])
    assert.deepEqual(
      stageOf(after.of(key).get()).constants,
      { CLASS_KEY: key, FEEDBACK: 1 },
      'the layer written',
    )
  assert.equal(compiled.sync, 0)
})

test('the guide pass is made by the frame entry that first shows a guide, its pipeline compiled off it', async () => {
  const { rt, device, compiled, land } = armed()
  const guides = createGuideSet()
  rt.context.guides = guides
  askFramePipelines(rt)
  assert.equal(rt.gpu.guides, undefined, 'no guide shown: no pass')
  guides.lines({ positions: [0, 0, 0, 1, 0, 0] })
  askFramePipelines(rt)
  assert.equal(holdWebgpuFrame(rt, device), true, 'held on the guide pipeline')
  assert.ok(rt.gpu.guides)
  await land()
  assert.equal(holdWebgpuFrame(rt, device), false, 'then drawn, the guide with it')
  assert.equal(compiled.sync, 0)
})

test('the passes beside the cut are asked once it is adopted, never queued ahead of its compiles', async () => {
  const armedRt = armed(),
    { rt, compiled } = armedRt
  askFramePipelines(rt)
  const before = compiled.async
  assert.equal(rt.vis.gpuDecode, undefined, 'no cut yet: no decode')
  Object.assign(rt.run, { gpuSelection: {} })
  askFramePipelines(rt)
  assert.ok(rt.vis.gpuDecode && rt.vis.binStages, 'the decode and the bins of its clusters')
  assert.ok(compiled.async > before, 'asked once the cut is adopted, not before')
  await armedRt.land()
  assert.equal(compiled.sync, 0)
})

test('a class that draws displaced pixels has its displaced pipeline asked at the frame entry, no other class has one', async () => {
  const armedRt = armed(),
    { rt, device, compiled } = armedRt
  const shade = await classes(armedRt, [3, 5, 7, 8, 9])
  // The classes the resident clusters wear that the image tessellates (`displacedClasses`): 5 displaced,
  // 7 displaced and skinned, 8 displaced and masked; 3, displaced but a line, and 9 are left as they are.
  for (const key of [5, 7, 8]) noteClass(rt.vis.displacedClasses, key, 1)
  Object.assign(rt.vis, { shadeClasses: shade, materialTable: { displaced: { count: 1 } } })
  const before = compiled.async
  askFramePipelines(rt)
  assert.equal(holdWebgpuFrame(rt, device), true, 'held on the displaced pipelines')
  assert.equal(compiled.async, before + 3, 'classes 5, 7 and 8 alone')
  await armedRt.land()
  for (const key of [5, 7, 8]) assert.equal(shade.displaced(key).ready, true, `class ${key}`)
  for (const key of [3, 9]) assert.equal(shade.displaced(key).ready, false, `class ${key}`)
  assert.equal(compiled.sync, 0, 'no frame compiled it')
  // The setting off, or no displaced surface: none is asked.
  const off = armed()
  for (const key of [5, 7, 8]) noteClass(off.rt.vis.displacedClasses, key, 1)
  Object.assign(off.rt.vis, { shadeClasses: await classes(off, [3, 5, 7, 8, 9]) })
  Object.assign(off.rt.vis, { materialTable: { displaced: { count: 0 } } })
  const asked = off.compiled.async
  askFramePipelines(off.rt)
  assert.equal(off.compiled.async, asked, 'no displaced surface: nothing asked')
})

test('the software raster is kept while the set it was made over stands, and made again when a graph joins', () => {
  const { rt, device } = armed()
  Object.assign(rt.gpu, { allocatedSize: [8, 8] })
  Object.assign(rt.layout, { rasterCapacity: 64 })
  Object.assign(rt, { setup: {} })
  ensureGpuRaster(rt, device)
  const first = rt.vis.gpuRaster!
  ensureGpuRaster(rt, device)
  assert.equal(rt.vis.gpuRaster, first, 'the same set')
  rt.vis.rasters = { ...NO_RASTERS }
  ensureGpuRaster(rt, device)
  assert.notEqual(rt.vis.gpuRaster, first, 'another set')
  assert.equal(rt.vis.gpuRaster!.rasters, rt.vis.rasters)
})
