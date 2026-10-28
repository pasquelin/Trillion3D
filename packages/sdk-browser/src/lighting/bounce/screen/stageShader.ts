import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import type { WgslDecl } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { spCacheRead } from './cacheReadWgsl.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import type { KernelShape } from './kernels.ts'
import { TRACE_SCENE_PROBES } from './traceSceneWgsl.ts'
import { TRACE_SCENE_BINDINGS } from './traceSceneWgsl.ts'

const C = TRACE_SCENE_BINDINGS.at

/** The program of a stage: the scene stage's group 0 (the probes' parameters, the cascades, the cache's maps) and the cache's read, then the stage's own code. */
export const screenStageShader = (
  shape: Pick<KernelShape, 'side' | 'samples' | 'light'>,
  stage: WgslDecl,
) =>
  wgslProgram(
    `${spParams(C.params)}
${wgslConsts({ SP_TRACE: shape.side })}`,
    [
      bounceBindingsWgsl(0, C.bounceGrid, TRACE_SCENE_PROBES),
      spCommon(shape.samples),
      spCacheRead(C.cacheFinal, C.cacheRaw, C.cacheSky, 'private', shape.light),
      stage,
    ],
  )
