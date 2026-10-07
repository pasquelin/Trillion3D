// A camera session for bandwidth measurement. It never calls the image-settling barrier:
// only the ordinary, budgeted frames of the observed trajectory request texture levels.
import type * as SdkBrowser from '../../witnesses/measurement.ts'
import type { MeasureViewOptions } from '../harness/measureOptions.ts'
import { explorerOptions } from '../harness/explorerPage.ts'

type SdkNamespace = typeof SdkBrowser & Record<string, SdkBrowser.EngineFactory | undefined>

/** Plays one pose per animation frame. The browser is discarded afterwards, world included. */
export async function runGazeNetwork(options: MeasureViewOptions) {
  const sdk = (await import(options.sdkUrl)) as SdkNamespace
  const factory = options.backend ? sdk[options.backend] : undefined
  if (!factory) throw new Error(`engine missing from dist: ${options.backend}`)
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const world = await sdk.openMeasuredWorld(canvas, explorerOptions(options, factory))
  for (const pose of options.poses!) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    world.render(pose)
  }
}
