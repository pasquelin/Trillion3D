// The sky module's tests' shared pieces: a sky word, a runtime that holds the session's settings, an engine.
import {
  mergeModuleParts,
  resolveModuleOption,
} from '../../../../sdk-core/src/modules/descriptor.ts'
import { resolveSky, SKY_MODULE } from '../../../../sdk-core/src/modules/sky/descriptor.ts'
import {
  DEFAULT_SKY_QUALITY,
  type SkyQualityOptions,
} from '../../../../sdk-core/src/modules/sky/quality.ts'
import { createSceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts'
import type { SceneCaptureHost } from '../../modules/sky/skyLight/captureScene.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** The sky module's word with the parts `option` names, resolved. */
export const word = (option: Record<string, boolean>) =>
  resolveSky(
    mergeModuleParts(SKY_MODULE, [resolveModuleOption(SKY_MODULE, option) as never]),
    DEFAULT_SKY_QUALITY,
  )

/** A runtime that holds the session's settings (`context`), an image counter and the image's clocks, over no device. */
export const runtime = (context: SkyQualityOptions) =>
  ({
    run: { frame: 1, graphClocks: { time: 0, realTime: 0 } },
    setup: { localFog: true },
    context,
    gpu: {},
    lights: { store: createSceneLightStore() },
  }) as unknown as WebgpuPagesRuntime

/** The engine that draws the scene aside for a captured sky light: none is asked here. */
export const SCENE = {} as SceneCaptureHost
