import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { reachedFunctions } from '../../../materials/texture/shaderRule.fixture.ts'
import { replayWrites } from '../../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { uniformStride } from '../../../session/memory/pools.ts'
import { pipelinesSettled } from '../../deferred/compileLedger.ts'
import { createVsmResources } from './resources.ts'
import { encodeVsmRender, type VsmRenderScene } from './render/renderPass.ts'
import { VSM_RENDER_PARAMS } from './render/renderParamsWgsl.ts'
import type { VsmBoundLight } from './mapViews.ts'
import { DAG_UNIFORM_BYTES } from '../../../geometry/dag/shader/viewsWgsl.ts'

/** What the shadow views' descent reads of a cut, on the stand-in texture `table`
 *  (`traversal/traversalPass.ts`): one root a view, two levels, its uniform block blank. */
export const descentScene = (table: GPUTextureView): VsmRenderScene['descent'] => ({
  tables: { nodes: table, frames: table, worlds: table, tree: table, cold: table, previous: table },
  info: {
    block: new Uint32Array(DAG_UNIFORM_BYTES / 4),
    levels: 2,
    rootSlots: 1,
    entries: 1,
    blockCount: 1,
    listCap: 16,
  },
})

/** The scene a raster pass of `rowCount` candidates over as many packed pages is encoded over: all its
 *  tables on the one `buffer` and one stand-in texture, the shadow page group `page` names (empty
 *  ones by default), a camera at the origin looking down −z. */
function rasterScene(
  rowCount: number,
  buffer: GPUBuffer,
  page: Pick<VsmRenderScene, 'pageLayout' | 'pageGroup'> = {
    pageLayout: {} as GPUBindGroupLayout,
    pageGroup: {} as GPUBindGroup,
  },
): VsmRenderScene {
  const table = {} as GPUTextureView
  return {
    rowCount,
    recordCapacity: 65536,
    ...{ packedPages: rowCount, pageCount: rowCount },
    descent: descentScene(table),
    ...{ info: buffer, rootWords: buffer, rootBoxes: buffer, casters: buffer },
    decode: () => {},
    world: { cold: table, frames: table, clusters: table, worlds: table },
    ...page,
    tiers: { twoSided: false, voxels: false },
    multipassViews: true,
    camera: {
      eye: [0, 0, 0],
      view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      threshold: 1,
    },
  }
}

/** What `encode` returns once the pipelines it asks are compiled, as in a later frame: `encode`
 *  runs until a call asks none (a stage asks the next), the passes, dispatches, copies and clears
 *  those recorded dropped, then once more. */
export async function compiled<T>(fake: ReturnType<typeof fakeDevice>, encode: () => T) {
  for (;;) {
    encode()
    const pending = pipelinesSettled(fake.device)
    if (!pending) break
    await pending
  }
  for (const record of [fake.passes, fake.computePasses, fake.dispatches, fake.copies, fake.clears])
    record.splice(0)
  return encode()
}

/** What a raster pass of `rowCount` rows under one sun is encoded with, on the kit's `device`: one
 *  of its encoders, the scene on one tiny buffer, and the sun. */
export function recordingRaster(device: GPUDevice, rowCount: number) {
  const buffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const scene = rasterScene(rowCount, buffer)
  const lights = [{ kind: 'directional' as const, firstId: 0, count: 1 }]
  return { encoder: device.createCommandEncoder(), scene, lights }
}

/** A device whose dispatches have 500 rows (`maxComputeWorkgroupsPerDimension`): the cull lists 500
 *  maps a pass at most, so a sun and 200 point lights, 1217 maps, take three passes. */
export const LOW_DISPATCH = { maxComputeWorkgroupsPerDimension: 500 }

const rowResources = new WeakMap<GPUDevice, ReturnType<typeof createVsmResources>>()

/** The raster of 200 000 rows under a sun's 17 levels, `scene` over the recording one, encoded into
 *  `encoder` on `device`: what the encoding returned. */
export function encodeRows(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  scene: Partial<VsmRenderScene> = {},
) {
  // One set a device, as the frames of an engine have: a second call finds the pipelines compiled.
  let res = rowResources.get(device)
  if (!res)
    rowResources.set(
      device,
      (res = createVsmResources(device, {
        coverMode: 'suns',
        fullMapCapacity: 63,
        poolPages: 256,
      })),
    )
  const raster = recordingRaster(device, 200_000)
  const lights = [{ kind: 'directional' as const, firstId: 0, count: 17 }]
  return encodeVsmRender(encoder, res, { device, lights }, { ...raster.scene, ...scene })!
}

/** A sun's 17 clipmap levels, then `points` point lights of six faces, in the order of their ids. */
export function manyLights(points: number) {
  const lights: VsmBoundLight[] = [{ kind: 'directional', firstId: 0, count: 17 }]
  for (let i = 0; i < points; i++) lights.push({ kind: 'point', firstId: 17 + 6 * i, count: 6 })
  return lights
}

/** The parameter slots the raster wrote on the recording device `fake`, as its writes left them:
 *  the words of every slot, and the words a slot is apart. */
export function paramWords(fake: ReturnType<typeof fakeDevice>) {
  const buffer = fake.buffers.find((b) => b.label === 'vsm.render.params')!
  const words = new Uint32Array(buffer.size / 4)
  const writes = fake.writes.filter((w) => w.buffer === (buffer as unknown as GPUBuffer))
  replayWrites(words.buffer, writes)
  return { words, stride: uniformStride(fake.device.limits) / 4 }
}

/** The raster of 20 000 rows under `lights` — `scene` over the recording one, `limits` over the
 *  device's — encoded on a recording device: that device, what the encoding returned and the
 *  parameter slots it wrote, one record a slot (a slot a view pass). */
export async function encodeLights(
  lights: VsmBoundLight[],
  scene: Partial<VsmRenderScene> = {},
  limits: Record<string, number> = {},
) {
  const fake = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 27, maxBufferSize: 1 << 27, ...limits },
  })
  const { device } = fake
  const res = createVsmResources(device, { coverMode: 'suns', fullMapCapacity: 63, poolPages: 256 })
  const raster = recordingRaster(device, 20_000)
  const frame = { device, lights },
    drawn = { ...raster.scene, ...scene }
  const stats = (await compiled(fake, () =>
    encodeVsmRender(device.createCommandEncoder(), res, frame, drawn),
  ))!
  const passes = fake.dispatches.filter((d) => d.entryPoint === 'vsmRenderViews').length
  const { words, stride } = paramWords(fake)
  const slots = Array.from({ length: stats.passes }, (_, k) => {
    const word = (field: keyof typeof VSM_RENDER_PARAMS.at) =>
      words[k * stride + VSM_RENDER_PARAMS.at[field]]
    return {
      viewFirst: word('viewFirst'),
      viewCount: word('viewCount'),
      lightCount: word('lightCount'),
      recordCapacity: word('recordCapacity'),
    }
  })
  return { fake, stats, passes, slots }
}

/** The bindings `entry` of the WGSL `code` reaches, as WebGPU counts them: the module-scope
 *  variables named in the functions its call graph holds, whatever branch a run takes, as
 *  `group:binding`. */
function bindingsReached(code: string, entry: string) {
  const globals = [
    ...code.matchAll(/@group\((\d+)\)\s*@binding\((\d+)\)\s*var(?:<[^>]*>)?\s+(\w+)/g),
  ]
  const reached = reachedFunctions(code, [entry], {})
  return globals
    .filter(([, , , name]) => new RegExp(`\\b${name}\\b`).test(reached))
    .map(([, group, binding]) => `${group}:${binding}`)
}

/** The bindings each compute pipeline `fake` made reaches that its layout does not hold: none on a
 *  device that validates them. */
export function bindingsOutsideLayouts(fake: ReturnType<typeof fakeDevice>) {
  const outside: string[] = []
  for (const { compute, layout } of fake.computePipelines) {
    const groups = (layout as unknown as GPUPipelineLayoutDescriptor)
      .bindGroupLayouts as GPUBindGroupLayoutDescriptor[]
    const held = new Set(
      groups.flatMap((g, k) => [...(g?.entries ?? [])].map((e) => `${k}:${e.binding}`)),
    )
    const code = (compute.module as unknown as { code: string }).code
    for (const at of bindingsReached(code, compute.entryPoint!))
      if (!held.has(at)) outside.push(`${compute.entryPoint} ${at}`)
  }
  return outside
}
