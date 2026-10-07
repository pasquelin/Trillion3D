import { depthRestoreWgsl } from '../../gpu/core/depthRestoreWgsl.ts'
import { FULLSCREEN_VERTEX } from '../../lighting/deferred/shaders.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

/** The fullscreen triangle writing each texel's own opaque depth. */
export const WATER_DEPTH_RESTORE_SHADER = wgslModule(FULLSCREEN_VERTEX, depthRestoreWgsl(0))
