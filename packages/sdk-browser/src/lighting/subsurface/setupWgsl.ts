import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { interleavedGradientNoise } from '../../../../math/src/wgsl/sampling.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'
import { SSS_COMMON_WGSL } from './commonWgsl.ts'
import { SSS_TILE_TYPE as T } from './layout.ts'
import { NEIGHBOURS_WGSL } from './tileWgsl.ts'

/** The kinds of scattering a pixel gets, and that it lies in the view: the bits the setup ORs over a tile. */
const KIND = { separable: 1, sampled: 2, inView: 4 } as const

/**
 * THE LIGHT OF A PROFILE PIXEL, split into its diffuse and its specular part (`sssReconstruct`, the lit image bound as `texA`):
 * - one pixel a pixel (the lit image has an alpha channel): the alpha is the diffuse light's luminance, the share of the colour that
 *   is diffuse is that over the colour's luminance;
 * - in a checkerboard (`SSS_CHECKER`): the pixel holds its diffuse light on one pixel of two and its specular light on the other, the
 *   missing one rebuilt from the neighbours — the mean of the left and the right with the quality low, the mean of the pair
 *   (left and right, or above and below) whose luminances differ least with the quality high; with `validate`, a neighbour that is not
 *   a profile pixel adds nothing, and the mean is then taken over those that do.
 * A texel outside the image repeats the edge texel (a point sampler that clamps).
 */
export const SSS_RECONSTRUCT_WGSL = wgslBlock(
  'SSS_RECONSTRUCT_WGSL',
  [SSS_COMMON_WGSL, luminance],
  `struct SssLight{diffuse:vec3f,specular:vec3f}
fn sssSceneTexel(p:vec2i)->vec4f{
 return textureLoad(texA,clamp(p,vec2i(0),vec2i(textureDimensions(texA))-vec2i(1)),0);
}
fn sssChecker(p:vec2i)->bool{return ((u32(p.x)+u32(p.y)+view.words.z)%2u)!=0u;}
fn sssLookup(p:vec2i,o:vec2i,validate:bool)->vec3f{
 let c=sssSceneTexel(p+o).rgb;
 return select(c,select(vec3f(0.0),c,sssIsProfile(p+o)),validate);
}
fn sssZeroAdd(a:vec3f,b:vec3f,validate:bool)->vec3f{
 var r=a+b;
 if(validate){
  r+=select(vec3f(0.0),b,all(a==vec3f(0.0)));
  r+=select(vec3f(0.0),a,all(b==vec3f(0.0)));
 }
 return r;
}
fn sssReconstruct(p:vec2i,validate:bool)->SssLight{
 var r:SssLight;
 if(SSS_CHECKER){
  let quant0=sssSceneTexel(p).rgb;
  let a=sssLookup(p,vec2i(1,0),validate);
  let b=sssLookup(p,vec2i(-1,0),validate);
  var quant1=0.5*sssZeroAdd(a,b,validate);
  if(SSS_HIGH){
   let c=sssLookup(p,vec2i(0,1),validate);
   let d=sssLookup(p,vec2i(0,-1),validate);
   let horizontal=abs(luminance(a)-luminance(b))>abs(luminance(c)-luminance(d));
   quant1=0.5*select(sssZeroAdd(a,b,validate),sssZeroAdd(c,d,validate),horizontal);
  }
  let checker=sssChecker(p);
  r.diffuse=select(quant1,quant0,checker);
  r.specular=select(quant0,quant1,checker);
 }else{
  let c=sssSceneTexel(p);
  let l=luminance(c.rgb);
  var factor=select(0.0,1.0,c.a>0.0);
  if(l>0.0){factor=saturate(c.a/l);}
  r.diffuse=c.rgb*factor;
  r.specular=c.rgb*(1.0-factor);
 }
 return r;
}`,
)

/**
 * THE SETUP (`sssSetupMain`, `sssSetupPass`), one group a tile of a list, a thread a pixel of the scattering's resolution: the diffuse
 * light of the pixel (in half resolution the mean over the profile pixels of the four it stands for) in the colour, in the alpha the
 * depth in centimetres (zero for no profile pixel; the mean over the four's valid ones in half resolution, a noise of up to a thousandth
 * of it added at the image's resolution so the half floats hold it), and the profile of the pixel in the ids texture. The main setup
 * runs over the tiles that scatter and also lists, in the two lists of how a tile's pixels scatter, the tiles that hold such a pixel; the
 * pass-through setup runs over the others, writes the same into the last target, its alpha a mask.
 */
export const SSS_SETUP_WGSL = wgslBlock(
  'SSS_SETUP_WGSL',
  [SSS_RECONSTRUCT_WGSL, NEIGHBOURS_WGSL, interleavedGradientNoise],
  `var<workgroup> wgKinds:atomic<u32>;
fn sssSetupPixel(p:vec2i)->vec4f{
 if(!sssIsProfile(p)){return vec4f(0.0);}
 return vec4f(sssReconstruct(p,false).diffuse,1.0);
}
fn sssClampedProfile(uv:vec2f)->u32{
 let inv=vec2f(1.0)/view.scene.zw;
 return sssProfileAt(sssPixelAtUv(clamp(uv,0.5*inv,(view.scene.xy-vec2f(0.5))*inv)));
}
fn sssKindOf(profile:u32)->u32{return select(${KIND.separable}u,${KIND.sampled}u,sssUseBurley(profile));}
fn sssAddTile(kind:u32,tile:vec2u){
 let at=atomicAdd(&counts[kind],1u);
 if(at<sssMaxTiles()){lists[kind*sssMaxTiles()+at]=sssTileWord(tile);}
}
fn sssSetup(g:vec3u,gi:u32,list:u32,passthrough:bool){
 if(gi==0u){atomicStore(&wgKinds,0u);}
 workgroupBarrier();
 let index=sssTileIndex(g);
 let valid=index<sssCount(list);
 var tile=vec2u(0u);
 if(valid){tile=sssTileAt(list,index);}
 let pos=tile*8u+vec2u(gi%8u,gi/8u);
 var uv=(vec2f(pos)+vec2f(0.5))/view.sub.zw;
 var kind=0u;
 if(valid){
  var out=vec4f(0.0);
  var has=false;
  var id=0u;
  if(SSS_HALF){
   var sum=vec4f(0.0);
   var weight=vec4f(0.0);
   var chosen=uv;
   for(var i=0u;i<4u;i++){
    let c=sssCorner(uv,i);
    let s=sssSetupPixel(sssPixelAtUv(c));
    weight[i]=s.a;
    sum+=s;
    chosen=select(chosen,c,s.a>0.0);
   }
   has=sum.a>=0.5;
   let div=1.0/max(sum.a,1.0);
   let q=uv*view.scene.zw-vec2f(0.5);
   let b=vec2i(floor(q));
   let last=vec2i(view.scene.zw)-vec2i(1);
   let depths=vec4f(
    sssDepthAt(clamp(b+vec2i(0,1),vec2i(0),last)),
    sssDepthAt(clamp(b+vec2i(1,1),vec2i(0),last)),
    sssDepthAt(clamp(b+vec2i(1,0),vec2i(0),last)),
    sssDepthAt(clamp(b,vec2i(0),last)));
   out=vec4f(sum.rgb*div,dot(depths,weight)*div);
   if(out.a>0.0){has=true;}
   id=sssClampedProfile(uv);
   if(has){
    if(SSS_FORCE_SEPARABLE){kind=${KIND.separable}u;}
    else{id=sssClampedProfile(chosen);kind=sssKindOf(id);}
   }
  }else{
   let p=sssPixelAtUv(uv);
   out=sssSetupPixel(p);
   id=sssClampedProfile(uv);
   if(out.a>0.0){
    has=true;
    let depth=sssDepthAt(p);
    out.a=depth+interleavedGradientNoise(vec2f(pos),f32(view.words.y))*(depth/1024.0);
    kind=sssKindOf(id);
   }
  }
  if(all(vec2f(pos)<view.sub.xy)){
   kind|=${KIND.inView}u;
   if(passthrough){out.a=select(0.0,1.0,out.a>0.0);}
   textureStore(outA,pos,out);
   if(SSS_CACHE){textureStore(outIds,pos,vec4u(id,0u,0u,0u));}
  }
 }
 let scatters=valid&&!SSS_FORCE_SEPARABLE&&!passthrough;
 if(scatters){atomicOr(&wgKinds,kind);}
 workgroupBarrier();
 if(scatters&&gi==0u){
  let flags=atomicLoad(&wgKinds);
  if((flags&${KIND.inView}u)!=0u){
   if((flags&${KIND.separable}u)!=0u){sssAddTile(${T.separable}u,tile);}
   if((flags&${KIND.sampled}u)!=0u){sssAddTile(${T.sampled}u,tile);}
  }
 }
}
@compute @workgroup_size(64)
fn sssSetupMain(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) gi:u32){
 sssSetup(g,gi,${T.nonPassthrough}u,false);
}
@compute @workgroup_size(64)
fn sssSetupPass(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) gi:u32){
 sssSetup(g,gi,${T.passthrough}u,true);
}`,
)
