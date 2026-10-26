import {
  MODEL_FLAG,
  SURFACE_MODEL,
  SURFACE_MODEL_MASK,
  modelFlag,
} from '../materials/surface/surfaceModelWord.ts'
import { lightsAsMedium } from '../materials/surface/translucencyLighting.ts'
import { translucencyMedium } from '../lighting/translucency/modeWgsl.ts'
import { surfaceReflects } from '../materials/surface/surfaceModel.ts'
import { pixelModelFlag, pixelModelOf, shadingReflects } from '../materials/surface/pixelModel.ts'
import { PHYSICAL_SURFACE_FLAG } from '../materials/surface/physicalLobes.ts'
import { LINE_DASH_WGSL } from '../visibility/shader/lineWgsl.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { REFLECTION_CONSTANTS_WGSL } from '../lighting/reflections/constantsWgsl.ts'
import { FRONT_OUTPUTS, type FrontOutputs } from '../lighting/reflections/frontLayer.ts'
import { fragmentMembers, fragmentZeros } from '../gpu/core/fragmentOutputs.ts'
import type { VisMaterial } from '../visibility/materialType.ts'
import { NO_VERTEX_WORDS } from './cloudVertexText.ts'
import { blendVertexWgsl, cutBlendByPixel } from './vertexWgsl.ts'
import { clipDirective, type Clipping } from '../gpu/core/clipDistances.ts'
import { BLEND_MAPS_WGSL } from './mapsWgsl.ts'
import { blendLit, blendSurfaceWgsl } from './shaderSurface.ts'
import { GRAPH_FLAG, blendGraphs, waterOf } from './graphWgsl.ts'
import { NO_WPO, type WpoSet } from '../materials/graph/wpoProgram.ts'
import type { SurfaceProgram } from '../materials/graph/surfaceProgram.ts'
import { materialTableWgsl } from '../materials/table/materialWgsl.ts'
import { BLEND_BINDINGS } from '../gpu/bind/bindLayout.ts'
import { FACING_MATERIAL_MASK } from './facing.ts'
import { WORDS } from './vertexReadsWgsl.ts'
import { BLEND_LOBELESS_WGSL, BLEND_PHYSICAL_RECORD_WGSL } from './physicalWgsl.ts'

/** How far behind its surface a covering fragment writes its depth into the Hi-Z front layer: a ray leaving
 *  the surface never meets its own pixel's depth. */
const FRONT_BEHIND = 1 - 1 / 1024

/** Whether a blend of material `mat` reflects, the CPU's twin of `frontReflects`: lit, of the physical
 *  model (`modelFlag`), not a hair nor the unlit shading model, and
 *  not lit as a medium (`translucencyMedium`: the blend fragment's `blendMedium`) — what makes a front pass write the reflecting surface. */
export const blendReflects = (
  mat: Pick<VisMaterial, 'lit' | 'model' | 'shadingModel' | 'translucencyLighting'>,
) => {
  const model = (mat.model ?? 0) & SURFACE_MODEL_MASK
  return (
    mat.lit &&
    model === SURFACE_MODEL.standard &&
    shadingReflects(mat.shadingModel) &&
    !lightsAsMedium(mat.translucencyLighting)
  )
}

/**
 * THE FRONT STAGE (`fsFront`), the front pass's fragment (`../lighting/reflections/frontLayer.ts`), in a module
 * of its own (`blendFrontShader`): the blend's vertex stage and material reads, no light. A fragment the
 * blend would keep writes, where it covers its pixel (`REFLECTION_FRONT_COVERAGE`), its depth a step
 * behind into the Hi-Z front layer; with `outputs` past zero, where it reflects — lit, of the physical
 * model —, the surface its lighting would reflect from: the physical model's flag, its normal and
 * roughness as the blend's (`blendSurface`), and, with `outputs` two, the lobes texel of its anisotropic
 * and clear-coat lobes under `PHYSICAL_SURFACE_FLAG` (`blendLobedTexel`). A fragment that does neither discards; of the others, the pass's depth
 * test keeps the nearest. No colour, no feedback.
 */
const frontStageWgsl = (outputs: FrontOutputs, graphs: readonly SurfaceProgram[]) => {
  const lobes = outputs === 2,
    reflects = outputs > 0,
    written = FRONT_OUTPUTS[outputs]
  return wgslBlock(
    `frontStageWgsl(${outputs}${graphs.length ? ', graphs' : ''})`,
    [
      blendSurfaceWgsl(lobes, graphs.length ? blendGraphs(graphs, lobes) : undefined),
      materialTableWgsl(BLEND_BINDINGS.material),
      blendLit,
      modelFlag,
      surfaceReflects,
      pixelModelFlag,
      pixelModelOf,
      translucencyMedium,
      LINE_DASH_WGSL,
      REFLECTION_CONSTANTS_WGSL,
      ...(lobes ? [BLEND_PHYSICAL_RECORD_WGSL] : [BLEND_LOBELESS_WGSL]),
    ],
    `struct FrontOut{${fragmentMembers(written)}}
const FRONT_BEHIND:f32=${wgslF32(FRONT_BEHIND)};
/** Whether a blend of item flags \`flags\` is lit by a lit view, of a model that reflects, and not lit as a medium. */
fn frontReflects(flags:u32)->bool{return blendLit(flags)&&surfaceReflects(modelFlag(flags)|pixelModelFlag(pixelModelOf(flags)))&&!translucencyMedium(flags);}
@fragment fn fsFront(in:VSOut,@builtin(front_facing) front:bool)->FrontOut{
 let g=blendGrads(in);
 let base=blendBase(in,g);
 // A thin translucent layer (a transmissive record) covers its pixel whole, whatever its opacity, and is cut by none.
 let thin=materialAt(in.${WORDS.material}&${FACING_MATERIAL_MASK}u).transmission>0.0;
 let covers=thin||blendAlpha(in,base)>=REFLECTION_FRONT_COVERAGE${waterOf(graphs) ? `||(g.graph.flags&${GRAPH_FLAG.water}u)!=0u` : ''};
 let reflects=${reflects ? `frontReflects(${graphs.length ? 'blendGraphFlags(in.ids.y,g.graph)' : 'in.ids.y'})` : 'false'};
 if(!(thin||blendKeeps(in,base,front))||!lineDash(in.uv.x,in.alphaAo.zw)||!(covers||reflects)){discard;return FrontOut(${fragmentZeros(written)});}
 let depth=vec4f(select(0.0,in.position.z*FRONT_BEHIND,covers),0.0,0.0,0.0);
${
  reflects
    ? ` if(!reflects){return FrontOut(depth,${fragmentZeros(written.slice(1))});}
 blendPhysicalBegin(in,g);
${lobes && graphs.length ? ' blendGraphLobes(g.graph);\n' : ''} let s=blendSurface(in,front,g,base);
${
  lobes
    ? ` let lobed=blendLobedTexel(s);
 return FrontOut(depth,select(${MODEL_FLAG.physical}u,${MODEL_FLAG.physical | PHYSICAL_SURFACE_FLAG}u,lobed.on),vec4f(s.N,s.rough),lobed.texel);`
    : ` return FrontOut(depth,${MODEL_FLAG.physical}u,vec4f(s.N,s.rough));`
}`
    : ' return FrontOut(depth,0u);'
}
}`,
  )
}

/** The front stage's module (`fsFront`) of `outputs`: the blend's vertex stage, its maps, and the stage;
 *  with `graphs`, the programs of the graphs its items wear, `offsets` those that move their vertices. */
export const blendFrontShader = (
  outputs: FrontOutputs,
  clipping?: Clipping,
  graphs: readonly SurfaceProgram[] = [],
  offsets: WpoSet = NO_WPO,
) => {
  const code = wgslModule(
    blendVertexWgsl(outputs === 2, clipping, NO_VERTEX_WORDS, offsets),
    BLEND_MAPS_WGSL,
    frontStageWgsl(outputs, graphs),
    ...clipDirective(clipping),
  )
  return cutBlendByPixel(code, clipping)
}
