import { preparedPipeline, type PreparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { track } from '../../lighting/deferred/compileLedger.ts'
import type { BlendPipelines } from '../blend/stagePipelines.ts'
import { lobedWaterSurfaceDescriptors } from './pipelines.ts'
import type { WaterDepthRestore } from './depthRestore.ts'

/**
 * The surface stage of an image whose transmissive surface carries an anisotropic or clear-coat
 * lobe (`fsWaterLobed`, `surfaceWgsl.ts`): its three culls, of the blend module that holds that
 * entry (`module`, compiled on demand), and the depth restore of its pass, whose targets hold the
 * lobes target too (`restoreFor`). No scene without such a surface compiles it: the pass builds it
 * when one carries a lobe from the start (`prepare`), a scene refresh or a frame that brings one
 * asks for it (`ask`), off the frame, the frames held until it landed (`track`): no image of
 * a lobed transmissive surface is drawn without its lobes. No frame compiles it.
 */
export function createLobedWaterStage(
  device: GPUDevice,
  module: () => Promise<GPUShaderModule | undefined>,
  layout: GPUBindGroupLayout,
  feedback: boolean,
  restore: Pick<WaterDepthRestore, 'restoreFor'>,
) {
  let made: BlendPipelines | undefined,
    preparing: Promise<void> | undefined,
    settled = false
  /** Compiles the stage once, its module and pipelines together. */
  const prepare = () => {
    if (preparing) return preparing
    preparing = (async () => {
      const code = await module()
      if (!code) return
      const pipelines: PreparedPipeline<GPURenderPipeline>[] = [
        ...lobedWaterSurfaceDescriptors(device, code, layout, feedback).map((descriptor) =>
          preparedPipeline(device, descriptor),
        ),
        restore.restoreFor(true),
      ]
      await Promise.all(pipelines.map((pipeline) => pipeline.prepare()))
      const [none, front, back] = pipelines.map((pipeline) => pipeline.get())
      made = [none, front, back]
    })()
    // Landed or refused, no frame waits for it any longer (`ask`).
    const done = () => void (settled = true)
    preparing.then(done, done)
    return preparing
  }
  return {
    prepare,
    /** Starts the stage's compile, off the frame, the frames held until it settles; a refused one
     *  leaves the plain stage drawing. */
    ask() {
      if (!settled) track(device, prepare(), true)
    },
    /** The stage's pipelines once compiled, else none. */
    get: (): BlendPipelines | undefined => made,
  }
}

export type LobedWaterStage = ReturnType<typeof createLobedWaterStage>
