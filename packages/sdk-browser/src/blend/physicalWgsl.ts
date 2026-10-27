import { BLEND_BINDINGS } from '../gpu/bind/bindLayout.ts'
import {
  FLAG_DOUBLE,
  FLAG_HAS_NORMAL,
  FLAG_HAS_TANGENT,
  FLAG_SAMPLED,
} from '../visibility/types.ts'
import { PHYSICAL_TEXEL_WGSL, physicalCoreWgsl } from '../visibility/shader/physicalWgsl.ts'
import { BLEND_TANGENT_FRAME_WGSL } from './tangentFrameWgsl.ts'
import { materialTableWgsl } from '../materials/table/materialWgsl.ts'
import { LOBES_LIGHTING_WGSL } from '../lighting/direct/lobesWgsl.ts'
import { LOBE_AXIS_WGSL } from '../lighting/lobeAxisWgsl.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'

/**
 * The anisotropic, clear-coat and cloth lobes of a blend, in the blend pass's lobed programs alone
 * (`shader.ts`, a key without `lobeless`): the opaque resolve's one implementation
 * (`physicalCoreWgsl`), its lobe extension read from the same table (`materialTableWgsl`), its UV
 * sets the fragment's own — two, the first and the one past it the vertex carries (`vertexWgsl.ts`) —, and the frame's displacements its screen
 * derivatives — the ones the blend's normal map is bent with (`shaderSurface.ts`), framebuffer y
 * running down, hence the side `-1`.
 *
 * The lobes go straight to the lighting (`setLobes`, `../lighting/direct/lobesWgsl.ts`), no
 * target between them: a fragment whose surface carries no lobe, or whose maps leave neither lobe,
 * sets none, and every term then runs the standard lobe operand for operand.
 */
/** The record a lobed fragment reads and the lobes it holds: its lobe extension, its lobes' values,
 *  read once a fragment (`blendLobesRead`) and held in
 *  `blendLobeValues`, and their texel (`blendLobedTexel`) — what a stage that lights nothing reads,
 *  the front stage's (`frontStageWgsl.ts`). */
export const BLEND_PHYSICAL_RECORD_WGSL = wgslBlock(
  'BLEND_PHYSICAL_RECORD_WGSL',
  [
    physicalCoreWgsl('physicalSampled'),
    PHYSICAL_TEXEL_WGSL,
    materialTableWgsl(BLEND_BINDINGS.material),
    BLEND_TANGENT_FRAME_WGSL,
  ],
  `var<private> physicalSampled:bool;
/** The item's lobe extension and the fragment's UV sets, before its tile request
 *  (\`blendRequest\`): none where its surface carries no lobe. */
fn blendPhysicalBegin(in:VSOut,g:BlendGrads){
 let lobes=materialLobesOf(in.ids.w);
 if(lobes==0u){return;}
 physicalOn=true;
 physicalSampled=(in.ids.y&${FLAG_SAMPLED}u)!=0u;
 physicalRecord=physicalAt(lobes);
 physicalCoords[0]=PhysicalCoord(in.uv.xy,g.gradX,g.gradY,g.gradX,g.gradY);
 // The set past the first the vertex carries (\`channelsAlt\`) stands for every one.
 let alt=PhysicalCoord(in.uv.zw,g.uv1X,g.uv1Y,g.uv1X,g.uv1Y);
 physicalCoords[1]=alt;physicalCoords[2]=alt;physicalCoords[3]=alt;
}
/** The lobes of a fragment of surface \`s\` (\`blendSurface\`: its shading and geometric normals)
 *  whose record is read (\`physicalOn\`): the blend's. */
fn blendPhysicalValues(in:VSOut,front:bool,g:BlendGrads,s:BlendSurface)->PhysicalLobes{
 let flags=in.ids.y;
 let coatFace=select(1.0,select(-1.0,1.0,front),(flags&${FLAG_DOUBLE}u)!=0u&&(flags&${FLAG_HAS_NORMAL}u)!=0u);
 // The stored tangents' frame, the one the blend's normal map bends in, where its page has them.
 var v=physicalValues(s.N,s.geometric,g.q0,g.q1,-1.0,coatFace,blendTangentFrame(in),(flags&${FLAG_HAS_TANGENT}u)!=0u);
 v.coatRough=max(v.coatRough,s.curvature);
 return v;
}
/** The lobes of the fragment, read once its surface is (\`blendLobesRead\`). */
var<private> blendLobeValues:PhysicalLobes;
/** The surface \`s\` of a fragment (\`blendSurface\`: its shading and geometric normals), its lobes read here,
 *  once, where its record is read (\`physicalOn\`), and held for its lights and the front stage. */
fn blendLobesRead(in:VSOut,front:bool,g:BlendGrads,s:BlendSurface)->BlendSurface{
 if(physicalOn){blendLobeValues=blendPhysicalValues(in,front,g,s);}
 return s;
}
/** The lobes of a fragment of surface \`s\` as the lobes target holds them, and whether it carries one:
 *  the front stage's texel (\`frontStageWgsl.ts\`), zero and false where it carries neither lobe. */
struct BlendLobed{texel:vec4u,on:bool,}
fn blendLobedTexel(s:BlendSurface)->BlendLobed{
 if(!physicalOn){return BlendLobed(vec4u(0u),false);}
 let v=blendLobeValues;
 if(physicalLobeless(v)){return BlendLobed(vec4u(0u),false);}
 return BlendLobed(physicalTexel(v),true);
}`,
)

/** The lobes set for a fragment's lights (`blendLobes`), on its record (`BLEND_PHYSICAL_RECORD_WGSL`). */
export const BLEND_PHYSICAL_WGSL = wgslBlock(
  'BLEND_PHYSICAL_WGSL',
  [BLEND_PHYSICAL_RECORD_WGSL, LOBES_LIGHTING_WGSL, LOBE_AXIS_WGSL],
  `/** The lobes of a lit fragment of surface \`s\`, seen along \`V\`, set for its lights at its
 *  roughness: those \`blendLobesRead\` read. */
fn blendLobes(in:VSOut,front:bool,g:BlendGrads,s:BlendSurface,V:vec3f,rough:f32){
 if(!physicalOn){return;}
 let v=blendLobeValues;
 if(physicalLobeless(v)){return;}
 let alpha=lobeAlpha(rough);
 setLobes(lobeAxis(v.direction,v.strength,s.N,alpha),v.coat,v.coatRough,v.coatN,s.N,V,lobeAcross(v.strength,alpha));
 setLobeBase(s.rgb,s.metal,rough);
 if(v.cloth>0.0){setCloth(v.fuzz,v.cloth,s.N,V,rough);}
}`,
)

/** A lobeless program's stand-ins (\`BLEND_PHYSICAL_WGSL\`'s): no record is read, no lobe set. */
export const BLEND_LOBELESS_WGSL = wgslBlock(
  'BLEND_LOBELESS_WGSL',
  [],
  `fn blendPhysicalBegin(in:VSOut,g:BlendGrads){}
fn blendLobes(in:VSOut,front:bool,g:BlendGrads,s:BlendSurface,V:vec3f,rough:f32){}`,
)
