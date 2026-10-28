import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { pixelOffset } from './pixelWgsl.ts'

/**
 * THE DEPTH OF A PIXEL OF THE VISIBILITY BUFFER, `depthAt`, read the one way by everything that
 * takes it from there: the export of the identifiers (`exportWgsl.ts`), the scene's depth, and the
 * Hi-Z build (`../hiz/gpu/workDepthSource.ts`). The buffer is bound as `work`. With the 64-bit word
 * (`wide`) a pixel is the pair the visibility write took (`pixelWgsl.ts`), its depth the second
 * component; without it the buffer holds the software raster's depth key and the hardware raster's
 * depth (`hwDepth`, the depth texture it drew) is merged: the nearer, the larger in reverse-Z.
 */
export const workDepthWgsl = (wide: boolean) =>
  wgslBlock(
    `WORK_DEPTH_WGSL(${wide})`,
    [pixelOffset],
    wide
      ? 'fn depthAt(p:vec2u)->f32{return bitcast<f32>(work[pixelOffset(p)].y);}'
      : 'fn depthAt(p:vec2u)->f32{return max(bitcast<f32>(work[pixelOffset(p)]),textureLoad(hwDepth,vec2i(p),0));}',
  )
