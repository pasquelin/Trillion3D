// What enters the scene after preparation — a resolve class a material changed into, a surface
// that came to emit, a guide shown — has its pipelines asked at the next frame entry, compiled off
// the thread while the frame is held on them, the previous image shown: no frame compiles one, and
// each is the pipeline the frame would have compiled itself, descriptor for descriptor.
import test from 'node:test'
import assert from 'node:assert/strict'
import { holdWebgpuFrame, keepWebgpuFrame } from './hold.ts'
import { settledRt } from './hold.fixture.ts'
import { askFramePipelines } from './framePipelines.ts'
import { deviceAnswer } from './deviceAnswer.ts'
import { preparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { gatedDevice } from '../../lighting/deferred/gatedDevice.fixture.ts'
import { createWebgpuShadePipelines } from '../../visibility/passes/shadePipelines.ts'
import type { ShadeCensus } from '../../visibility/passes/shadeCensus.ts'
import { createGuideSet } from '../../guides/guideSet.ts'
import { families } from '../../session/host/families.ts'
import { PAGE_INFO } from '../../visibility/pageInfo.ts'
import { FLAG_DISPLACED, FLAG_LINE, FLAG_MASK, ROW_WORDS } from '../../visibility/types.ts'

await families.guides.load()

/** A settled runtime on a gated device, its hold armed by two identical frames. */
function armed() {
  const gpu = gatedDevice(),
    rt = settledRt()
  Object.assign(rt.gpu, { device: gpu.device })
  for (let i = 0; i < 2; i++) {
    rt.run.frame++
    keepWebgpuFrame(rt)
  }
  return { ...gpu, rt }
}

/** A census whose classes and emission the test sets, taken anew once moved. */
function census(keys: number[], emits = false) {
  let stale = false
  return {
    keys,
    emits,
    moved: () => void (stale = true),
    retake: () => (stale ? !(stale = false) : false),
  } satisfies ShadeCensus
}

/** The scene's resolve classes, compiled as prepare leaves them: writing the feedback, which their
 *  one module's override `FEEDBACK` says (`feedbackConstants`). */
async function classes(gpu: ReturnType<typeof gatedDevice>, keys: number[], emissiveAo = true) {
  let done = false
  const module = {} as GPUShaderModule
  const made = createWebgpuShadePipelines(
    gpu.device,
    module,
    keys,
    undefined,
    true,
    undefined,
    emissiveAo,
  ).finally(() => (done = true))
  while (!done) await gpu.land()
  return (await made).shadeClasses
}

/** A class's compute stage, as the kit's device makes it: its module, entry point and overrides. */
const stageOf = (pipeline: unknown) => pipeline as GPUProgrammableStage

test('a frame entry holds the image while a pipeline its frame binds compiles, and draws once it landed', async () => {
  const { rt, device, compiled, land } = armed()
  const pipeline = preparedPipeline(device, { layout: 'auto', vertex: {} as never }).ask()
  assert.equal(holdWebgpuFrame(rt, device), true, 'held: the previous image shown')
  assert.equal(rt.run.frameHeld, false, 'on an answer, not as a still frame')
  const answer = deviceAnswer(rt)
  assert.ok(answer, 'the loop waits for the compile')
  await land()
  await answer
  assert.equal(pipeline.ready, true)
  assert.equal(holdWebgpuFrame(rt, device), true)
  assert.equal(rt.run.frameHeld, true, 'landed: a still frame again')
  assert.equal(compiled.sync, 0, 'no frame compiled it')
})

test('a class a material changed into compiles off the frame before the image that draws it', async () => {
  const armedRt = armed(),
    { rt, device, compiled } = armedRt
  const scene = census([5])
  Object.assign(rt.vis, { shadeCensus: scene, shadeClasses: await classes(armedRt, [5]) })
  askFramePipelines(rt)
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
  // A table that holds rows, its cut still being made.
  Object.assign(rt.layout.rows, { casterSlots: 4 })
  askFramePipelines(rt)
  const before = compiled.async
  Object.assign(rt.run, { gpuSelection: {} })
  askFramePipelines(rt)
  assert.equal(compiled.async, before + 1, 'asked once the cut is adopted, not before')
  await armedRt.land()
  assert.equal(compiled.sync, 0)
})

test('a class that draws displaced pixels has its displaced pipeline asked at the frame entry, no other class has one', async () => {
  const armedRt = armed(),
    { rt, device, compiled } = armedRt
  const shade = await classes(armedRt, [3, 5, 7, 8, 9])
  // Rows, each of its class: 5 displaced, the image tessellates it; 7 displaced and skinned, 8
  // displaced and masked — both tessellated too; 3 displaced but a line, which is left as it is;
  // 9 not displaced.
  const ints = new Uint32Array(ROW_WORDS * 5)
  const row = (at: number, key: number, flags: number, deformOutput = 0) => {
    ints[at * ROW_WORDS + PAGE_INFO.at.materialClass] = key
    ints[at * ROW_WORDS + PAGE_INFO.at.flags] = flags
    ints[at * ROW_WORDS + PAGE_INFO.at.deformOutput] = deformOutput
  }
  row(0, 5, FLAG_DISPLACED)
  row(1, 9, 0)
  row(2, 7, FLAG_DISPLACED, 5)
  row(3, 8, FLAG_DISPLACED | FLAG_MASK)
  row(4, 3, FLAG_DISPLACED | FLAG_LINE)
  Object.assign(rt.layout.rows, { pageTableInts: ints, packedCount: 5, rowWrites: 1 })
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
  Object.assign(off.rt.layout.rows, { pageTableInts: ints, packedCount: 5, rowWrites: 1 })
  Object.assign(off.rt.vis, { shadeClasses: await classes(off, [3, 5, 7, 8, 9]) })
  Object.assign(off.rt.vis, { materialTable: { displaced: { count: 0 } } })
  const asked = off.compiled.async
  askFramePipelines(off.rt)
  assert.equal(off.compiled.async, asked, 'no displaced surface: nothing asked')
})
