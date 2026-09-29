import { TRANSMITTANCE_CLEAR_WGSL } from '../../gpu/shadow/transmittance.ts';
import { FRESH_CLEAR } from './freshLayout.ts';

/**
 * THE DRAWS OF THE PAGES THE GPU DRAWS ITSELF (#1275), entries of the shadow depth shader
 * (`../../gpu/shadow/shader.ts`), whose casters' corners they place (`shadowVertexIn`). WebGPU has
 * no indirect viewport: a layer's pass covers the whole layer, and each draw carries its layer in
 * its first vertex (`FRESH_LAYER_SHIFT`, `freshLayout.ts`).
 *
 * - `shadow_fresh_clear_vs`: instance `i` is the layer's `i`-th region, its page's square at far —
 *   the depth cleared, or, with `shadow_fresh_clear_fs`, the transmittance layer's page all light.
 * - `shadow_fresh_vs`, `shadow_fresh_blend_vs`: instance `i` is the `i`-th pair the cull kept
 *   (`freshCullWgsl.ts`), a caster row of a region, drawn by that region's view; a pair of another
 *   layer draws nothing. Its clip square is carried onto the page's square of the layer, after the
 *   sun's snap (`freshPlace`), and the fragment keeps the page's texels alone (`freshInPage`).
 */
export const SHADOW_FRESH_DRAWS_WGSL = `
/** Clip position \`p\` of \`view\`'s clip square, carried onto its page's square of the layer's. */
fn freshPlace(view:ShadowView,p:vec4f)->vec4f{return vec4f(p.xy*view.rect.zw+view.rect.xy*p.w,p.z,p.w);}
/** Whether layer texel \`at\` lies in \`view\`'s page. */
fn freshInPage(view:ShadowView,at:vec2f)->bool{
 let first=round(view.params.xy*view.params.w/view.params.z);let q=at-first;
 return all(q>=vec2f(0.0))&&all(q<vec2f(view.params.w));
}
/** The \`instance\`-th pair's caster at corner \`vertexIndex\`, if its region lies in the draw's layer. */
fn freshCaster(vertexIndex:u32,instance:u32,blended:bool)->ShadowOut{
 var out:ShadowOut;
 out.position=vec4f(0.0,0.0,2.0,1.0);out.instance=0u;out.uv=vec2f(0.0);out.fromEmitter=vec3f(0.0);out.region=0u;
 let layer=vertexIndex>>FRESH_LAYER_SHIFT;let k=freshPairs[2u*instance];
 let first=freshArgs[FRESH_LAYER_STARTS+layer];
 if(k<first||k>=first+freshArgs[freshDraw(layer,${FRESH_CLEAR}u)+1u]){return out;}
 let view=freshFaces[k];
 out=shadowVertexIn(view,vertexIndex&FRESH_CORNER_MASK,freshPairs[2u*instance+1u],blended);
 out.position=freshPlace(view,out.position);out.region=k;
 return out;
}
@vertex fn shadow_fresh_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->ShadowOut{
 return freshCaster(vertexIndex,instanceIndex,false);
}
@vertex fn shadow_fresh_blend_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->ShadowOut{
 return freshCaster(vertexIndex,instanceIndex,true);
}
@vertex fn shadow_fresh_clear_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->@builtin(position) vec4f{
 let layer=vertexIndex>>FRESH_LAYER_SHIFT;let i=vertexIndex&FRESH_CORNER_MASK;
 let rect=freshFaces[freshArgs[FRESH_LAYER_STARTS+layer]+instanceIndex].rect;
 let corner=vec2f(select(-1.0,1.0,((0x32u>>i)&1u)!=0u),select(-1.0,1.0,((0x2cu>>i)&1u)!=0u));
 return vec4f(corner*rect.zw+rect.xy,0.0,1.0);
}
/** A texel of the region's page, as \`shadow_fs\` keeps it. */
@fragment fn shadow_fresh_fs(in:ShadowOut){
 let gx=dpdx(in.uv);let gy=dpdy(in.uv);let view=freshFaces[in.region];
 if(!freshInPage(view,in.position.xy)||!shadowKeepAt(view.emitter,in,gx,gy)){discard;}
}
/** A blended caster's texel of the page, at the transmittance layer's half resolution. */
@fragment fn shadow_fresh_blend_fs(in:ShadowOut)->@location(0) vec4f{
 let gx=dpdx(in.uv);let gy=dpdy(in.uv);let view=freshFaces[in.region];
 if(!freshInPage(view,in.position.xy*2.0)||!shadowKeepAt(view.emitter,in,gx,gy)||shadowHiddenByOpaque(in.position)){discard;}
 return blendTransmittance(pages[in.instance],in.uv,gx,gy);
}
/** A page of the transmittance layer cleared: all the light, and far. */
@fragment fn shadow_fresh_clear_fs()->@location(0) vec4f{return ${TRANSMITTANCE_CLEAR_WGSL};}`;
