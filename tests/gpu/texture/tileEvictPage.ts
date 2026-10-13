// The tile pools' eviction on Dawn (`webgpu/tile/stampWgsl.ts`, `evictSortWgsl.ts`): the feedback
// reduction stamps the places its pixels read, the sort ranks a full pool's places on those stamps,
// and the queue comes back in the feedback readback to the pool.
import { createWebgpuTileAtlas } from '../../../packages/sdk-browser/src/webgpu/tile/atlas.ts'
import { createWebgpuTileFeedback } from '../../../packages/sdk-browser/src/webgpu/tile/feedback.ts'
import { createTilePublish } from '../../../packages/sdk-browser/src/webgpu/tile/publish.ts'
import { stampedPlace } from '../../../packages/sdk-browser/src/webgpu/tile/stamp.fixture.ts'
import { poolEncoding } from '../../../packages/sdk-browser/src/texture/blockFormats.ts'
import { tileLayout } from '../../../packages/sdk-browser/src/texture/tiles.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'

/** A target of `width × height` pixels: the first `read` ask a level-0 tile each, the others the
 *  missing child its ancestor stands in for; `frames` images, every pixel speaking. */
export type TileEvictCase = { width: number; height: number; read: number; frames: number }

const empty = { levels: [], blocks: { bc7: [], astc: [], etc2: [] } }

export async function run(kase: TileEvictCase) {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('no WebGPU adapter')
  const { device, errors } = gpu
  const raw = (size: number) => ({
    layout: tileLayout(size, size),
    lane: 'lossless' as const,
    source: { kind: 'bytes' as const, tail: empty },
  })
  const clock = () => published.clock
  const atlas = (kind: 'color' | 'data', layers: number, offset: number, size: number) =>
    createWebgpuTileAtlas(device, {
      kind,
      encoding: poolEncoding(undefined),
      layers: { lossless: layers, rgba: 0, 'two-channel': 0 },
      feedbackOffset: offset,
      textures: [raw(size)],
      clock,
    })
  const color = atlas('color', 1, 0, 4096)
  const data = atlas('data', 0, color.pages.entries, 1)
  const feedback = createWebgpuTileFeedback(device, color.pages.entries + data.pages.entries)
  const published = createTilePublish(device, feedback, [color, data])
  for (const each of [color, data]) each.pinTails(device.queue, () => {})
  const level0 = (i: number) => ({ slot: 0, level: 0, tx: i % 32, ty: Math.floor(i / 32) })
  const ancestor = { slot: 0, level: 1, tx: 0, ty: 0 },
    child = level0(0)
  color.place(ancestor)
  const pool = color.pools[0]
  for (let i = 1; pool.resident < pool.tiles; i++) color.place(level0(i))
  const { width, height } = kase
  const rankOf = (n: number) => color.pages.feedbackIndexOf(n < kase.read ? level0(1 + n) : child)
  const target = device.createTexture({
    size: [width, height],
    format: 'r32uint',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  device.queue.writeTexture(
    { texture: target },
    Uint32Array.from({ length: width * height }, (_, n) => rankOf(n) + 1),
    { bytesPerRow: width * 4 },
    [width, height],
  )
  const view = target.createView()
  for (let frame = 0; frame < kase.frames; frame++) {
    for (const each of [color, data]) each.flush(device)
    const encoder = device.createCommandEncoder()
    published.publish(encoder, view, [width, height], true)
    device.queue.submit([encoder.finish()])
    feedback.submitted()
    await feedback.settled()
  }
  // What the pixels read, by the stamp's own mirror on the table the GPU read.
  const kept = new Set<number>()
  for (let n = 0; n < width * height; n++)
    kept.add(stampedPlace(color.pages.words, rankOf(n))!.index)
  const victims: number[] = []
  for (let index = pool.victim(); index !== undefined; index = pool.victim()) {
    victims.push(index)
    pool.release(index)
  }
  const tiles = pool.tiles
  published.destroy()
  feedback.destroy()
  color.destroy()
  data.destroy()
  target.destroy()
  const info = await gpu.fermer()
  return { adapter: info.court, errors, victims, kept: [...kept], tiles }
}
