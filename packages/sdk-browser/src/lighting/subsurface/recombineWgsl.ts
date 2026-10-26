import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { SSS_TEXTURES, SSS_TILES, SSS_TILE_TYPE } from './layout.ts'
import { SSS_RECONSTRUCT_WGSL } from './setupWgsl.ts'
import { SSS_RADIUS_SCALE_WORD } from './shape.ts'

/**
 * THE RECOMBINE (`sssRecombine`) AND THE COPY BACK (`sssCopy`), drawn over the tiles that hold a profile pixel — a quad a tile of the
 * `all` list, an instance each, in the scattering's resolution — or, with nothing scattered, over the whole image. The recombine
 * rebuilds the light of the pixel in its diffuse and its specular part (`sssReconstruct`), mixes the diffuse light with the scattered
 * (the scattered image divided by its alpha, so that the pixels the half resolution leaves out do not darken it) by the profile's tint,
 * faded in half resolution as the scattering reaches under four pixels, multiplies by the surface's base colour and adds the specular
 * light; its alpha is zero, the opaque surface's, the diffuse light's luminance it held having been read. The copy passes the recombined image on as it is. It draws into an image of its own, which the copy writes back over
 * the lit image: a pass cannot read what it writes.
 */
export const SSS_RASTER_WGSL = wgslBlock(
  'SSS_RASTER_WGSL',
  [SSS_RECONSTRUCT_WGSL],
  `@group(1) @binding(${SSS_TEXTURES.a}) var texA:texture_2d<f32>;
@group(1) @binding(${SSS_TEXTURES.b}) var texB:texture_2d<f32>;
@group(2) @binding(${SSS_TILES.lists}) var<storage,read> lists:array<u32>;
@vertex fn sssTileVertex(@builtin(vertex_index) vid:u32,@builtin(instance_index) instance:u32)->@builtin(position) vec4f{
 let tile=sssTileOf(lists[${SSS_TILE_TYPE.all}u*view.tiles.x*view.tiles.y+instance]);
 var corner=tile*8u;
 corner.x+=select(0u,8u,vid==1u||vid==2u||vid==4u);
 corner.y+=select(0u,8u,vid==2u||vid==4u||vid==5u);
 let uv=vec2f(min(vec2i(corner),vec2i(view.sub.xy)))/view.sub.zw;
 return vec4f(uv*vec2f(2.0,-2.0)+vec2f(-1.0,1.0),0.0,1.0);
}
fn sssFullResolutionShare(depth:f32,profileScale:f32,pixelScale:f32)->f32{
 let reach=view.scatter.x/depth*${SSS_RADIUS_SCALE_WORD}*profileScale;
 let pixels=reach/((1.0/view.sub.z)*0.5);
 return saturate(pixels-4.0)*saturate(pixelScale*10.0);
}
@fragment fn sssRecombine(@builtin(position) at:vec4f)->@location(0) vec4f{
 let p=vec2i(floor(at.xy));
 let scene=sssSceneTexel(p);
 if(!sssIsProfile(p)){return scene;}
 let id=sssProfileAt(p);
 let base=textureLoad(baseTex,p,0).rgb;
 let tint=sssTint(id);
 var share=1.0;
 if(SSS_HALF){
  let profileScale=sssKernel(SSS_KERNEL_OFFSET+SSS_KERNEL_COUNT-1u,id).a;
  share=sssFullResolutionShare(sssDepthAt(p),profileScale,sssOpacityAt(p));
 }
 let uv=clamp(at.xy/view.scene.zw,sssBilinearMin(),sssBilinearMax());
 let c=textureSampleLevel(texB,linearSampler,uv,0.0);
 let scattered=c.rgb/max(c.a,0.00001);
 let light=sssReconstruct(p,view.tiles.w!=0u);
 let lighting=mix(light.diffuse,scattered,tint*share);
 return vec4f(lighting*base+light.specular,0.0);
}
@fragment fn sssCopy(@builtin(position) at:vec4f)->@location(0) vec4f{
 return textureLoad(texA,vec2i(floor(at.xy)),0);
}`,
)
