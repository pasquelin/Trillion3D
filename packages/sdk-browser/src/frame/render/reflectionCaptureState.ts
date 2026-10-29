import type { ReflectionCaptures } from '../../lighting/reflectionCapture/capture.ts'
import type { SceneCaptureHost } from '../../modules/sky/skyLight/captureScene.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** What draws the scene aside for the captures of a runtime: its engine (`captureHdrViews`). */
export const reflectionCaptureHosts = new WeakMap<WebgpuPagesRuntime, SceneCaptureHost>()

/** The reflection captures a runtime holds (`encodeReflectionCapture.ts`), apart from the code that draws them: the passes that read them import this alone. */
export const heldReflectionCaptures = new WeakMap<WebgpuPagesRuntime, ReflectionCaptures>()

/** Whether any reflection capture of the scene is made and read (`ContractKey.captureless`). */
export const reflectionCapturesMade = (rt: WebgpuPagesRuntime) =>
  (heldReflectionCaptures.get(rt)?.made ?? 0) > 0
