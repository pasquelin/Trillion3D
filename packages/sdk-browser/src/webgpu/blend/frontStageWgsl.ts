import * as surfaceModel from '../../scene/surfaceModel.ts'
import { FLAG_DIAGNOSTIC_VIEW, FLAG_LIT, FLAG_UNLIT_VIEW } from '../../visibility/types.ts'
import { PHYSICAL_SURFACE_FLAG } from '../../scene/physicalLobes.ts'
import { LINE_DASH_WGSL } from '../../visibility/shader/lineWgsl.ts'
import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { REFLECTION_CONSTANTS_WGSL } from '../../reflections/constantsWgsl.ts'
import type { FrontOutputs } from '../../reflections/frontLayer.ts'
import type { VisMaterial } from '../../visibility/materialType.ts'
import { blendVertexWgsl } from './vertexWgsl.ts'
import { BLEND_MAPS_WGSL } from './mapsWgsl.ts'
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

/** How far behind its surface a covering fragment writes its depth into the Hi-Z front layer: a ray leaving
 *  the surface never meets its own pixel's depth. */
const FRONT_BEHIND = 1 - 1 / 1024

/** Whether a blend of material `mat` reflects, the CPU's twin of `frontReflects`: lit, of the physical
 *  model (`blendSurfaceModel`) — what makes a front pass write the reflecting surface. */
export const blendReflects = (mat: Pick<VisMaterial, 'lit' | 'model'>) => {
  const model = (mat.model ?? 0) & surfaceModel.SURFACE_MODEL_MASK
  return (
    mat.lit &&
    model !== surfaceModel.SURFACE_MODEL.diffuse &&
    model !== surfaceModel.SURFACE_MODEL.toon
  )
}

/**
 * THE FRONT STAGE (`fsFront`), the front pass's fragment (`../../reflections/frontLayer.ts`), in a module
 * of its own (`blendFrontShader`): the blend's vertex stage and material reads, no light. A fragment the
 * blend would keep writes, where it covers its pixel (`REFLECTION_FRONT_COVERAGE`), its depth a step
 * behind into the Hi-Z front layer; with `outputs` past zero, where it reflects — lit, of the physical
 * model —, the surface its lighting would reflect from: the physical model's flag, its normal and
 * roughness as the blend's (`blendSurface`), and, with `outputs` two, the lobes texel of its anisotropic
 * and clear-coat lobes under `PHYSICAL_SURFACE_FLAG` (`blendLobedTexel`). A fragment that does neither
 * discards; of the others, the pass's depth test keeps the nearest. No colour, no feedback.
 */
export const frontStageWgsl = (outputs: FrontOutputs) => {
  const lobes = outputs === 2,
    reflects = outputs > 0
  const fields = [
    '@location(0) front:vec4f',
    '@location(1) flags:u32',
    ...(reflects ? ['@location(2) normal:vec4f'] : []),
    ...(lobes ? ['@location(3) lobes:vec4u'] : []),
  ]
  const none = [
    'vec4f(0.0)',
    '0u',
    ...(reflects ? ['vec4f(0.0)'] : []),
    ...(lobes ? ['vec4u(0u)'] : []),
  ]
  return wgslBlock(
    `frontStageWgsl(${outputs})`,
    [
      blendSurfaceWgsl(lobes),
      blendSurfaceModel,
      surfaceModel.surfaceReflects,
      LINE_DASH_WGSL,
      REFLECTION_CONSTANTS_WGSL,
      ...(lobes ? [BLEND_PHYSICAL_WGSL] : [BLEND_LOBELESS_WGSL]),
    ],
    `struct FrontOut{${fields.join(',')},}
const FRONT_BEHIND:f32=${wgslF32(FRONT_BEHIND)};
/** Whether a blend of item flags \`flags\` is lit by a lit view, of a model that reflects. */
fn frontReflects(flags:u32)->bool{
 let lit=(flags&${FLAG_LIT}u)!=0u&&(flags&${FLAG_UNLIT_VIEW | FLAG_DIAGNOSTIC_VIEW}u)==0u;
 return lit&&surfaceReflects(blendSurfaceModel(flags));
}
@fragment fn fsFront(in:VSOut,@builtin(front_facing) front:bool)->FrontOut{
 let g=blendGrads(in);
 let base=blendBase(in,g);
 let covers=blendAlpha(in,base)>=REFLECTION_FRONT_COVERAGE;
 let reflects=${reflects ? 'frontReflects(in.ids.y)' : 'false'};
 if(!blendKeeps(in,base,front)||!lineDash(in.uv.x,in.alphaAo.zw)||!(covers||reflects)){discard;return FrontOut(${none.join(',')});}
 let depth=vec4f(select(0.0,in.position.z*FRONT_BEHIND,covers),0.0,0.0,0.0);
${
  reflects
    ? ` if(!reflects){return FrontOut(depth,${none.slice(1).join(',')});}
 blendPhysicalBegin(in,g);
 let s=blendSurface(in,front,g,base);
${
  lobes
    ? ` let lobed=blendLobedTexel(in,front,g,s);
 return FrontOut(depth,select(${surfaceModel.MODEL_FLAG.physical}u,${surfaceModel.MODEL_FLAG.physical | PHYSICAL_SURFACE_FLAG}u,lobed.on),vec4f(s.N,s.rough),lobed.texel);`
    : ` return FrontOut(depth,${surfaceModel.MODEL_FLAG.physical}u,vec4f(s.N,s.rough));`
}`
    : ' return FrontOut(depth,0u);'
}
}`,
  )
}

/** The front stage's module (`fsFront`) of `outputs`: the blend's vertex stage, its maps, and the stage. */
export const blendFrontShader = (outputs: FrontOutputs) =>
  wgslModule(blendVertexWgsl(outputs === 2), BLEND_MAPS_WGSL, frontStageWgsl(outputs))
