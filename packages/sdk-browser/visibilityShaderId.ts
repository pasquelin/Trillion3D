export const VIS_SHADER = `struct PageInfo{world:mat4x4f,baseColor:vec4f,metalness:f32,roughness:f32,mapIndex:u32,flags:u32,pageOffset:u32,indexCount:u32,vertexBase:u32,packedBase:u32,uvScale:vec2f,clusterHash:u32,hizSlot:u32,roughnessIndex:u32,metalnessIndex:u32,normalIndex:u32,normalScale:f32,roughUvScale:vec2f,metalUvScale:vec2f,normalUvScale:vec2f,aoIndex:u32,aoIntensity:f32,aoUvScale:vec2f,emissiveIndex:u32,selectionIndex:u32,emissive:vec4f,emissiveUvScale:vec2f,normalScaleY:f32,pad1:f32,pad4:vec4f,pad5:vec4f,}
struct Uniforms{viewProj:mat4x4f,viewport:vec2f,smallThreshold:f32,pad:f32,drawSlot:u32,indirect:u32,selectionOffset:u32,selectionEnabled:u32,}
@group(0) @binding(0) var<storage, read> indices:array<u32>;
@group(0) @binding(1) var<storage, read> positions:array<f32>;
@group(0) @binding(2) var<storage, read> pages:array<PageInfo>;
@group(0) @binding(3) var<storage, read> hizFlags:array<u32>;
@group(0) @binding(4) var<uniform> uni:Uniforms;
@group(0) @binding(5) var<storage, read> uvs:array<f32>;
@group(0) @binding(6) var maps:texture_2d_array<f32>;
@group(0) @binding(7) var mapsSampler:sampler;
@group(0) @binding(8) var<storage, read> instances:array<u32>;
@group(0) @binding(9) var<storage, read> slotOffsets:array<u32>;
fn drawPage(instanceIndex:u32)->u32{
 if(uni.indirect!=0u){return instances[slotOffsets[uni.drawSlot]+instanceIndex];}
 return instanceIndex;
}
struct VSOut{@builtin(position) position:vec4f,@location(0) @interpolate(flat) id:u32,@location(1) @interpolate(flat) instance:u32,@location(2) uv:vec2f,}
fn vertPos(base:u32,idx:u32)->vec3f{let i=(base+idx)*3u;return vec3f(positions[i],positions[i+1u],positions[i+2u]);}
fn vertUv(base:u32,idx:u32)->vec2f{let i=(base+idx)*2u;return vec2f(uvs[i],uvs[i+1u]);}
fn wrapCoord(t:f32,repeat:bool)->f32{return select(clamp(t,0.0,1.0),fract(t),repeat);}
fn maskKeep(page:PageInfo,uv:vec2f)->bool{
 if((page.flags&128u)==0u||(page.flags&8u)==0u){return true;}
 let wrapped=vec2f(wrapCoord(uv.x,(page.flags&32u)!=0u),wrapCoord(uv.y,(page.flags&64u)!=0u))*page.uvScale;
 let sample=textureSampleLevel(maps,mapsSampler,wrapped,i32(page.mapIndex),0.0);
 return sample.w>=page.baseColor.w;
}
fn computeTriangle(page:PageInfo,triangle:u32)->bool{
 if(uni.smallThreshold<=0.0||triangle*3u+2u>=page.indexCount){return false;}
 let ia=indices[page.pageOffset+triangle*3u];let ib=indices[page.pageOffset+triangle*3u+1u];let ic=indices[page.pageOffset+triangle*3u+2u];
 let a=uni.viewProj*page.world*vec4f(vertPos(page.vertexBase,ia),1.0);
 let b=uni.viewProj*page.world*vec4f(vertPos(page.vertexBase,ib),1.0);
 let c=uni.viewProj*page.world*vec4f(vertPos(page.vertexBase,ic),1.0);
 if(a.w<=0.0||b.w<=0.0||c.w<=0.0||a.z<0.0||b.z<0.0||c.z<0.0||a.z>a.w||b.z>b.w||c.z>c.w){return false;}
 let pa=vec2f((a.x/a.w*0.5+0.5)*uni.viewport.x,(1.0-(a.y/a.w*0.5+0.5))*uni.viewport.y);
 let pb=vec2f((b.x/b.w*0.5+0.5)*uni.viewport.x,(1.0-(b.y/b.w*0.5+0.5))*uni.viewport.y);
 let pc=vec2f((c.x/c.w*0.5+0.5)*uni.viewport.x,(1.0-(c.y/c.w*0.5+0.5))*uni.viewport.y);
 let lo=min(pa,min(pb,pc));let hi=max(pa,max(pb,pc));
 return lo.x>=0.0&&lo.y>=0.0&&hi.x<uni.viewport.x&&hi.y<uni.viewport.y&&hi.x-lo.x<=uni.smallThreshold&&hi.y-lo.y<=uni.smallThreshold;
}
@vertex fn vis_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->VSOut{
 var out:VSOut;
 let pageIndex=drawPage(instanceIndex);
 let page=pages[pageIndex];
 out.instance=pageIndex;out.uv=vec2f(0.0);
 if(vertexIndex>=page.indexCount||computeTriangle(page,vertexIndex/3u)){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}
 let id=indices[page.pageOffset+vertexIndex];
 let p=vertPos(page.vertexBase,id);
 let world=page.world*vec4f(p,1.0);
 out.position=uni.viewProj*world;
 out.id=page.packedBase|((vertexIndex/3u)&0xffu);
 if((page.flags&4u)!=0u){out.uv=vertUv(page.vertexBase,id);}
 return out;
}
@vertex fn vis_hiz_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->VSOut{
 var out:VSOut;
 let pageIndex=drawPage(instanceIndex);
 let page=pages[pageIndex];
 out.instance=pageIndex;out.uv=vec2f(0.0);
 if(page.hizSlot!=0xffffffffu&&hizFlags[page.hizSlot]!=0u){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}
 if(vertexIndex>=page.indexCount||computeTriangle(page,vertexIndex/3u)){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}
 let id=indices[page.pageOffset+vertexIndex];
 let p=vertPos(page.vertexBase,id);
 let world=page.world*vec4f(p,1.0);
 out.position=uni.viewProj*world;
 out.id=page.packedBase|((vertexIndex/3u)&0xffu);
 if((page.flags&4u)!=0u){out.uv=vertUv(page.vertexBase,id);}
 return out;
}
struct VisHizOut{@location(0) id:u32,@location(1) depth:f32,}
@fragment fn vis_hiz_fs(in:VSOut)->VisHizOut{
 var out:VisHizOut;
 if(!maskKeep(pages[in.instance],in.uv)){discard;}
 out.id=in.id;out.depth=in.position.z;return out;
}
@fragment fn vis_fs(in:VSOut)->@location(0) u32{
 if(!maskKeep(pages[in.instance],in.uv)){discard;}
 return in.id;
}
`;
