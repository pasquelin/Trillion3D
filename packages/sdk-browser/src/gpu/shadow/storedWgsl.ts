import { FLAG_BLEND_CASTER } from '../../visibility/types.ts';
import { MAX_SHADOW_REGIONS } from './recordPack.ts';

/**
 * THE POOL'S CASTERS FROM A STORED LocalToClip (OMB-25, #966, the `shadowLocalToClip` option),
 * entries of the shadow depth shader (`shader.ts`), as Nanite keeps one LocalToClip per instance
 * and view. The bin pass stored each binned caster's `viewProjection*world` after the list's rows
 * (`binShader.ts`, `localToClip`): the same product, in the same order, that `shadowVertexIn` forms
 * per corner; here a corner costs one matrix-vector product. The invariant kept: the clip position
 * is `(viewProjection*world)*corner`, never reassociated, then snapped by `sunSnap` — the
 * difference left is the GPU's own contraction of the product, an ulp, so the option is off by
 * default and its image class 2. The default entries (`shadow_depth_vs` and siblings) are unchanged.
 */
export const SHADOW_STORED_WGSL = `
fn storedColumn(at:u32)->vec4f{return vec4f(bitcast<f32>(instances[at]),bitcast<f32>(instances[at+1u]),bitcast<f32>(instances[at+2u]),bitcast<f32>(instances[at+3u]));}
/** The LocalToClip stored for list place \`place\`, after every region's rows. */
fn storedLocalToClip(place:u32)->mat4x4f{let at=slotOffsets[${MAX_SHADOW_REGIONS}u]+place*16u;return mat4x4f(storedColumn(at),storedColumn(at+4u),storedColumn(at+8u),storedColumn(at+12u));}
/** Corner \`vertexIndex\` of the caster at list place \`place\`, seen by the face the draw binds,
 *  as \`shadowVertexIn\` places a depth caster's. */
fn storedVertex(vertexIndex:u32,place:u32)->ShadowOut{
 var out:ShadowOut;
 let pageIndex=instances[place];let page=pages[pageIndex];
 out.instance=pageIndex;out.uv=vec2f(0.0);out.fromEmitter=vec3f(0.0);out.region=0u;
 if(vertexIndex>=page.indexCount||(page.flags&${FLAG_BLEND_CASTER}u)!=0u){out.position=vec4f(0.0,0.0,2.0,1.0);return out;}
 let h=pageHeader(page);let id=pageCorner(page,h,vertexIndex);let local=vec4f(pagePosition(page,h,id),1.0);
 out.position=sunSnap(shadow,storedLocalToClip(place)*local);
 out.fromEmitter=(page.world*local).xyz-shadow.emitter.xyz;
 if((page.flags&4u)!=0u){out.uv=pageUv(page,h,id);}
 return out;
}
@vertex fn shadow_stored_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->ShadowOut{
 return storedVertex(vertexIndex,slotOffsets[uni.drawSlot]+instanceIndex);
}
@vertex fn shadow_depth_stored_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->@invariant @builtin(position) vec4f{
 return storedVertex(vertexIndex,slotOffsets[uni.drawSlot]+instanceIndex).position;
}
@vertex fn shadow_cutout_stored_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->ShadowOut{
 return storedVertex(vertexIndex,slotOffsets[uni.drawSlot+1u]-1u-instanceIndex);
}`;
