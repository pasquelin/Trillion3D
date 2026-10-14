import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { VERDICT_WGSL } from '../blend/verdictLayout.ts'
import { pixelToNdc } from '../../../../math/src/wgsl/projection.ts'

/**
 * THE WATER RECTANGLE'S QUAD, the vertex stage of the depth restore and of the composite: two
 * triangles over the rectangle the GPU wrote (`argsWgsl.ts`), read at binding `binding` of group 0
 * (the verdict, read-only), drawn indirectly with zero instances when no water draws. Its corners
 * are whole pixels of a viewport of the target's size: a pixel centre lies half a pixel from every
 * edge, so the quad covers exactly the pixels the rectangle holds — those a scissor to it admitted
 * from a fullscreen triangle —, each once (the shared diagonal's top-left rule).
 */
export const waterQuadWgsl = (binding: number) =>
  wgslBlock(
    `waterQuadWgsl(${binding})`,
    [VERDICT_WGSL, pixelToNdc],
    `@group(0) @binding(${binding}) var<storage,read> waterRect:array<u32>;
@vertex fn waterQuad(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
 let low=vec2f(f32(waterRect[VERDICT_RECT]),f32(waterRect[VERDICT_RECT+1u]));
 let high=vec2f(f32(waterRect[VERDICT_RECT+2u]),f32(waterRect[VERDICT_RECT+3u]));
 let size=vec2f(f32(waterRect[VERDICT_RECT+4u]),f32(waterRect[VERDICT_RECT+5u]));
 let corner=vec2f(f32((0x32u>>i)&1u),f32((0x2cu>>i)&1u));
 let pixel=mix(low,high,corner);
 return vec4f(pixelToNdc(pixel,size),0.0,1.0);
}`,
  )
