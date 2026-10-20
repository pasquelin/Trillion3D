// What the screen-error measure (#959) reads INSIDE the page, served under `/runner/` and imported
// by its URL like `series/cutPage.ts`. One world holds each pose until its cut is held, then hands
// back what it drew: the clusters its cut selected (`selectedClusterIds`, decoded in Node by
// `screenError/screenErrorSurface.ts`), through the server's `/capture`.
import type * as SdkBrowser from '../../witnesses/measurement.ts'
import type { CameraPose } from '../../../packages/sdk-core/src/contracts/base.ts'
import { calmPose, HOLD_FRAME_LIMIT, posterCapture } from '../harness/measurePage.ts'
import { alignUp } from '../../../packages/math/src/scalar/integers.ts'

export interface HoldOptions {
  sdkUrl: string
  manifestUrl: string
  pixelError: number
  width: number
  height: number
  dpr: number
  poses: { view: string; pose: CameraPose }[]
  tag: string
}

const capture = (file: string, bytes: Uint8Array) => posterCapture(file, bytes, bytes.length / 4, 1)

/** Holds every pose of `o` and captures the clusters the backend drew, `<tag>-<view>.ids`. */
export async function holdAndCapture(o: HoldOptions) {
  const sdk = (await import(o.sdkUrl)) as typeof SdkBrowser
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const explorer = await sdk.openMeasuredWorld(canvas, {
    manifestUrl: o.manifestUrl,
    scope: 'full',
    width: o.width,
    height: o.height,
    pixelRatio: o.dpr,
    replicaCount: 1,
    detail: 'source',
    pixelError: o.pixelError,
    lodAdaptive: false,
    preload: 'visible',
    engine: sdk.webgpuPagesEngine,
    diagnosticDetail: 'summary',
  })
  explorer.setClearColor(0x2a303c)
  const backend = explorer.engine as SdkBrowser.Engine
  const rows = []
  for (const { view, pose } of o.poses) {
    explorer.setPose(pose)
    const held = (await calmPose(explorer, pose)) ?? HOLD_FRAME_LIMIT
    // Three more frames: the WebGPU readback of the cut is one frame behind the cut.
    for (let i = 0; i < 3; i++) {
      explorer.render(pose)
      await explorer.flush()
    }
    const file = `${o.tag}-${view}`
    const text = new TextEncoder().encode(backend.selectedClusterIds().join('\n'))
    const padded = new Uint8Array(alignUp(text.length, 4) || 4).fill(10)
    padded.set(text)
    await capture(`${file}.ids`, padded)
    rows.push({ view, held, canvas: [canvas.width, canvas.height] })
  }
  explorer.dispose()
  canvas.remove()
  return rows
}
