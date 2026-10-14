import * as surfaceModel from '../../scene/surfaceModel.ts'
import { FLAG_DIAGNOSTIC_VIEW, FLAG_LIT, FLAG_UNLIT_VIEW } from '../../visibility/types.ts'
import { PHYSICAL_SURFACE_FLAG } from '../../scene/physicalLobes.ts'
import { PHYSICAL_TEXEL_WGSL } from '../../visibility/shader/physicalWgsl.ts'
import { LINE_DASH_WGSL } from '../../visibility/shader/lineWgsl.ts'
import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { blendSurfaceWgsl } from './shaderSurface.ts'
import { BLEND_LOBELESS_WGSL, BLEND_PHYSICAL_WGSL } from './physicalWgsl.ts'

/** The surface-buffer model flag of a blend of item flags `flags` (`../../scene/surfaceModel.ts`): the
 *  physical one, the diffuse or the toon one, as its model lane says. The blend fragment's lighting and
 *  the front stage's test of a reflecting surface read it here. */
export const blendSurfaceModel = wgslFn(
  'blendSurfaceModel',
  [],
  `fn blendSurfaceModel(flags:u32)->u32{
 let model=(flags>>${surfaceModel.MODEL_SHIFT}u)&7u;
 return select(select(${surfaceModel.MODEL_FLAG.physical}u,${surfaceModel.MODEL_FLAG.diffuse}u,model==${surfaceModel.SURFACE_MODEL.diffuse}u),${surfaceModel.MODEL_FLAG.toon}u,model==${surfaceModel.SURFACE_MODEL.toon}u);
}`,
)

/**
 * THE FRONT STAGE (`fsFront`): one more fragment entry of the blend module, which draws the
 * transparents' front surface the reflection trace reads (`../../reflections/frontLayer.ts`). A
 * fragment the blend would keep and light, of the physical model — the one with a specular lobe —,
 * writes the surface its lighting would reflect from: its normal and roughness as the blend's
 * (`blendSurface`), the physical model's flag, and, in a program with `lobes`, the lobes texel of its
 * anisotropic and clear-coat lobes under `PHYSICAL_SURFACE_FLAG` (`physicalTexel`), as the opaque
 * resolve leaves its own. Any other fragment discards: the nearest reflecting one, whatever its
 * opacity, is the front, the pass's depth test keeping it. No colour, no light, no feedback.
 */
export const frontStageWgsl = (lobes: boolean) =>
  wgslBlock(
    `frontStageWgsl(${lobes})`,
    [
      blendSurfaceWgsl(lobes),
      blendSurfaceModel,
      surfaceModel.surfaceReflects,
      LINE_DASH_WGSL,
      ...(lobes ? [PHYSICAL_TEXEL_WGSL, BLEND_PHYSICAL_WGSL] : [BLEND_LOBELESS_WGSL]),
    ],
    `struct FrontOut{@location(0) normal:vec4f,@location(1) flags:u32,${lobes ? '@location(2) lobes:vec4u,' : ''}}
/** Whether a blend of item flags \`flags\` is lit by a lit view, of a model that reflects. */
fn frontReflects(flags:u32)->bool{
 let lit=(flags&${FLAG_LIT}u)!=0u&&(flags&${FLAG_UNLIT_VIEW | FLAG_DIAGNOSTIC_VIEW}u)==0u;
 return lit&&surfaceReflects(blendSurfaceModel(flags));
}
@fragment fn fsFront(in:VSOut,@builtin(front_facing) front:bool)->FrontOut{
 let g=blendGrads(in);
 let base=blendBase(in,g);
 if(!blendKeeps(in,base,front)||!lineDash(in.uv.x,in.alphaAo.zw)||!frontReflects(in.ids.y)){discard;return FrontOut(vec4f(0.0),0u${lobes ? ',vec4u(0u)' : ''});}
 blendPhysicalBegin(in,g);
 let s=blendSurface(in,front,g,base);
 var flags=${surfaceModel.MODEL_FLAG.physical}u;
${
  lobes
    ? ` var texel=vec4u(0u);
 if(physicalOn){
  let v=blendPhysicalValues(in,front,g,s);
  if(!physicalLobeless(v)){texel=physicalTexel(v);flags|=${PHYSICAL_SURFACE_FLAG}u;}
 }
 return FrontOut(vec4f(s.N,s.rough),flags,texel);`
    : ` return FrontOut(vec4f(s.N,s.rough),flags);`
}
}`,
  )
