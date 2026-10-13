import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FRAME_HEAD_WGSL } from '../blend/frameHead.ts'
import { VERDICT_WGSL } from '../blend/verdictLayout.ts'
import { REFLECTION_SIDE } from '../../reflections/constants.ts'

/** The side of the backdrop copy's tiles (`copyWgsl.ts`), and of the front-depth scatter's. */
export const WATER_COPY_TILE = 8
const COPY_SHIFT = Math.log2(WATER_COPY_TILE)
const FRONT_SHIFT = Math.log2(REFLECTION_SIDE)
if (!Number.isInteger(FRONT_SHIFT)) throw new Error('REFLECTION_SIDE is not a power of two')

/**
 * WHAT THE WATER PASS DRAWS, written by one thread once the rectangles are folded
 * (`rectWgsl.ts`): the rectangle — the surfaces' union, or the full target when no surface was
 * folded in, as the CPU's freeze chose —, the backdrop copy over the union of the backdrops and the
 * surfaces (the full target with it), the copy's tiles, the rectangle's quad, drawn by the depth
 * restore and the composite, and the next image's front-depth scatter over the rectangle — each
 * with zero instances or workgroups when no water draws. That is the gate: no CPU reads it. Its
 * host binds \`frame\` and \`verdict\`.
 */
export const WATER_ARGS_WGSL = wgslBlock(
  'WATER_ARGS_WGSL',
  [FRAME_HEAD_WGSL, VERDICT_WGSL],
  `/** Word \`k\` of a union, its minima uncomplemented. */
fn unionWord(at:u32,k:u32)->u32{
 let word=atomicLoad(&verdict[at+k]);
 return select(word,~word,k<2u);
}
fn writeWords(at:u32,v:vec4u){
 atomicStore(&verdict[at],v.x);
 atomicStore(&verdict[at+1u],v.y);
 atomicStore(&verdict[at+2u],v.z);
 atomicStore(&verdict[at+3u],v.w);
}
@compute @workgroup_size(1)
fn writeWaterArgs(){
 let width=frame[FRAME_WIDTH];
 let height=frame[FRAME_HEIGHT];
 let n=select(0u,1u,atomicLoad(&verdict[VERDICT_DRAWN])!=0u);
 let s=vec4u(unionWord(VERDICT_SURFACE,0u),unionWord(VERDICT_SURFACE,1u),unionWord(VERDICT_SURFACE,2u),unionWord(VERDICT_SURFACE,3u));
 let b=vec4u(min(unionWord(VERDICT_BACKDROP,0u),s.x),min(unionWord(VERDICT_BACKDROP,1u),s.y),max(unionWord(VERDICT_BACKDROP,2u),s.z),max(unionWord(VERDICT_BACKDROP,3u),s.w));
 let full=vec4u(0u,0u,width,height);
 let bounded=s.z>s.x;
 let rect=select(full,s,bounded);
 let copied=select(full,b,bounded);
 let size=vec2u(select(0u,copied.z-copied.x,copied.z>copied.x),select(0u,copied.w-copied.y,copied.w>copied.y));
 writeWords(VERDICT_RECT,rect);
 atomicStore(&verdict[VERDICT_RECT+4u],width);
 atomicStore(&verdict[VERDICT_RECT+5u],height);
 writeWords(VERDICT_COPY,vec4u(copied.x,copied.y,size.x,size.y));
 writeWords(VERDICT_COPY_ARGS,vec4u((size.x+${WATER_COPY_TILE - 1}u)>>${COPY_SHIFT}u,(size.y+${WATER_COPY_TILE - 1}u)>>${COPY_SHIFT}u,n,0u));
 writeWords(VERDICT_QUAD_ARGS,vec4u(6u,n,0u,0u));
 let fx=select(0u,(rect.z-rect.x+${REFLECTION_SIDE - 1}u)>>${FRONT_SHIFT}u,rect.z>rect.x);
 let fy=select(0u,(rect.w-rect.y+${REFLECTION_SIDE - 1}u)>>${FRONT_SHIFT}u,rect.w>rect.y);
 writeWords(VERDICT_FRONT_ARGS,vec4u(fx,fy,n,0u));
}
`,
)
