import { BLEND_BINDINGS } from '../core/bindLayout.ts'
import {
  FLAG_DOUBLE,
  FLAG_HAS_NORMAL,
  FLAG_SAMPLED,
  PHYSICAL_RECORD_MASK,
} from '../../visibility/types.ts'
import { physicalCoreWgsl, physicalTableWgsl } from '../../visibility/shader/physicalWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * The anisotropic and clear-coat lobes of a blend, in the blend pass's lobed programs alone
 * (`shader.ts`, a key without `lobeless`): the opaque resolve's one implementation
 * (`physicalCoreWgsl`), its record read from the same table, its two UV sets the fragment's own
 * (`vertexWgsl.ts`), and the frame's displacements its screen derivatives — the ones the blend's
 * normal map is bent with (`shaderSurface.ts`), framebuffer y running down, hence the side `-1`.
 *
 * The lobes go straight to the lighting (`setLobes`, `../../lighting/direct/lobesWgsl.ts`), no
 * target between them: a fragment whose item names no record, or whose maps leave neither lobe,
 * sets none, and every term then runs the standard lobe operand for operand.
 */
export const BLEND_PHYSICAL_WGSL = wgslBlock(
  'BLEND_PHYSICAL_WGSL',
  [physicalCoreWgsl('physicalSampled'), physicalTableWgsl(BLEND_BINDINGS.physical)],
  `var<private> physicalSampled:bool;
var<private> physicalOn:bool;
/** The item's record and the fragment's two UV sets, before its tile request (\`blendRequest\`). */
fn blendPhysicalBegin(in:VSOut,g:BlendGrads){
 if(in.ids.w==0u){return;}
 physicalOn=true;
 physicalSampled=(in.ids.y&${FLAG_SAMPLED}u)!=0u;
 physicalRecord=physicalAt((in.ids.w&${PHYSICAL_RECORD_MASK}u)-1u);
 physicalCoord0=PhysicalCoord(in.uv.xy,g.gradX,g.gradY,g.gradX,g.gradY);
 physicalCoord1=PhysicalCoord(in.uv.zw,g.uv1X,g.uv1Y,g.uv1X,g.uv1Y);
}
/** The lobes of a fragment of surface \`s\` (\`blendSurface\`: its shading and geometric normals)
 *  whose record is read (\`physicalOn\`): the blend's and the water surface stage's
 *  (\`../water/surfaceWgsl.ts\`). */
fn blendPhysicalValues(in:VSOut,front:bool,g:BlendGrads,s:BlendSurface)->PhysicalLobes{
 let flags=in.ids.y;
 let coatFace=select(1.0,select(-1.0,1.0,front),(flags&${FLAG_DOUBLE}u)!=0u&&(flags&${FLAG_HAS_NORMAL}u)!=0u);
 return physicalValues(s.N,s.geometric,g.q0,g.q1,-1.0,coatFace);
}
/** The lobes of a lit fragment of surface \`s\`, seen along \`V\`, set for its lights at its
 *  roughness. */
fn blendLobes(in:VSOut,front:bool,g:BlendGrads,s:BlendSurface,V:vec3f,rough:f32){
 if(!physicalOn){return;}
 let v=blendPhysicalValues(in,front,g,s);
 if(physicalLobeless(v)){return;}
 setLobes(v.direction,v.strength,v.coat,v.coatRough,v.coatN,s.N,V,rough);
}`,
)

/** A lobeless program's stand-ins (\`BLEND_PHYSICAL_WGSL\`'s): no record is read, no lobe set. */
export const BLEND_LOBELESS_WGSL = wgslBlock(
  'BLEND_LOBELESS_WGSL',
  [],
  `fn blendPhysicalBegin(in:VSOut,g:BlendGrads){}
fn blendLobes(in:VSOut,front:bool,g:BlendGrads,s:BlendSurface,V:vec3f,rough:f32){}`,
)
