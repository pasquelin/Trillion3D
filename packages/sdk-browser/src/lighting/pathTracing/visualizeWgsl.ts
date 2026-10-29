import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { frameAround, outOfFrame } from '../../../../math/src/wgsl/basis.ts'
import { PATH_TRACING_VISUALIZE_MODES } from '../../../../sdk-core/src/contracts/pathTracingOptions.ts'
import { sheenFuzzRoughness } from '../direct/sheenLobeWgsl.ts'
import { PT_HIT_KIND } from './hitRecordWgsl.ts'
import { PT_HIT_MATERIAL_VECS, PT_MATERIAL_FLAG } from './hitMaterialWgsl.ts'
import { PT_GROUND_CLASS } from './airWgsl.ts'
import { PT_NO_CLASS } from './traceBounceWgsl.ts'
import { PT_VISUALIZE_COLOURS_WGSL, visualizeMode as mode } from './visualizeColoursWgsl.ts'
import { PT_VOLUME_LIGHT_WGSL } from './volumeLightWgsl.ts'

export { PT_CAPTURED_VIEW } from './visualizeColoursWgsl.ts'

/** The entry of the view of the payload, run in place of the finish of the bounce (`ptFinish`). */
export const PT_VISUALIZE_ENTRY = 'ptVisualize'

/** The words of the view drawn, as the grid's parameters carry them: the number of its name in `PATH_TRACING_VISUALIZE_MODES`, the count its ramps end at and the length of its occlusion ray. */
export const visualizeWords = (view: string, maxCount: number, distance: number) => {
  const words = new ArrayBuffer(12)
  new Uint32Array(words).set([
    Math.max(PATH_TRACING_VISUALIZE_MODES.indexOf(view as never), 0),
    maxCount,
  ])
  new Float32Array(words)[2] = distance
  return words
}

/**
 * THE VIEWS OF THE PAYLOAD (`ptShowHit(path, bounce, index)`, `pathTracingVisualize`): in place of the lighting of the first bounce, the pixel takes the colour of a field of what its ray found (the surface that `ptHitSurface` gives, taken as its material gives it, and,
 * where a class shades it, the material the shade of the hits wrote), held to one sample. A ray that meets nothing leaves the pixel black; a field that is a vector is drawn as `0.5 + 0.5 · v` (normals, the tangent) or as it is (colours, the roughness, the index
 * of refraction); a count is the ramp from blue to red up to `visualizeMax` and pink past it; the position is a hue by the hash of its 10 cm cell; the shading model a colour by its kind; the instance, triangle and cluster a colour by their hash, and the lighting channels a
 * colour by their mask (these two kept by the trace, `PT_CAPTURED_VIEW`). Where the material has no such field (the anisotropy, the profile and the radius of a subsurface scattering), the view shows the value a material without it has.
 * The views that would otherwise be flat colours (`ptShowNeedsShading`) are shaded by the occlusion of a ray of `visualizeAo` metres in the cosine distribution about the normal (the facing ratio where it is negative).
 * The ray goes through every surface that does not cover it, in the rounds of the bounce, and the layers add their colours in proportion to what they cover (the opacity, the throughput what the layers before let through); the count of the translucent layers rides in `PtPath.segment.x`.
 * The last round has the surface cover the ray whatever its opacity.
 */
export const PT_VISUALIZE_WGSL = wgslBlock(
  'PT_VISUALIZE_WGSL',
  [
    PT_VOLUME_LIGHT_WGSL,
    PT_VISUALIZE_COLOURS_WGSL,
    luminance,
    sheenFuzzRoughness,
    PI,
    frameAround,
    outOfFrame,
  ],
  `fn ptShowVolumeLights(path:ptr<function,PtPath>,reach:f32)->vec3f{
 var n=0u;
 for(var id=ptGridParams.infinite;id<ptView.counts.x;id++){
  let setup=ptPrepareVolumeLight(id,(*path).origin,(*path).direction,0.0,reach);
  if(ptVolumeValid(setup)&&setup.importance*ptLightScattering(id)>0.0){n++;}
 }
 return select(vec3f(0.18),ptCountColour(n),n>0u);
}
fn ptShowGrid(point:vec3f,m:u32)->vec3f{
 let cell=ptGridLookup(point);
 if(cell.offset==0xffffffffu){return vec3f(0.18);}
 let n=cell.lights-ptGridParams.infinite;
 if(m==${mode('LightGridListHash')}){
  if(n==0u){return vec3f(0.36);}
  var h=0u;
  for(var i=0u;i<n;i++){h=ptHash32(h+ptGridLightId(ptGridParams.infinite+i,cell));}
  return ptHashColour(h);
 }
 if(m==${mode('LightGridSingular')}){
  if(n==0u){return vec3f(0.36);}
  return select(vec3f(0.2,1.0,0.2),vec3f(0.2,0.2,1.0),cell.lights==cell.mis);
 }
 if(m==${mode('LightGridAxis')}){
  let axis=(cell.offset/ptGridParams.maxCount)%3u;
  return select(select(vec3f(0.2,0.2,0.9),vec3f(0.2,0.9,0.2),axis==1u),vec3f(0.9,0.2,0.2),axis==0u);
 }
 if(n<1u){return vec3f(0.36);}
 return ptCountColour(n);
}
fn ptShowCount(path:ptr<function,PtPath>,hit:bool,normal:vec3f){
 let n=u32((*path).segment.x);
 let most=max(ptGridParams.visualizeMax,1u);
 var colour=vec3f(0.5);
 if(n>0u){colour=select(ptRamp(saturate(f32(n-1u)/f32(most))),vec3f(1.0,0.1,1.0),n>most);}
 if(hit){colour*=abs(dot(normal,(*path).direction));}
 ptAccumulate(path,colour,true);
}
fn ptShowHit(path:ptr<function,PtPath>,bounce:u32,index:u32)->bool{
 let m=ptGridParams.visualize;
 let h=ptLoadHit(index);
 if(h.kind==${PT_HIT_KIND.ended}u){return false;}
 let camera=(*path).scatter==PT_SCATTER_CAMERA;
 let reach=select(PT_T_MAX,h.distance,h.kind==${PT_HIT_KIND.surface}u);
 var colour=vec3f(0.0);
 if(m==${mode('VolumeLightCount')}){
  colour=ptShowVolumeLights(path,reach);
  if(h.kind==${PT_HIT_KIND.surface}u){colour*=abs(dot(h.normal,(*path).direction));}
  ptAccumulate(path,colour,camera);
  return false;
 }
 if(h.kind!=${PT_HIT_KIND.surface}u){
  if(m==${mode('TransparencyCount')}){ptShowCount(path,false,vec3f(0.0));}
  return false;
 }
 ptShowing=true;
 let s=ptHitSurface(h,index,path);
 var mat:PtHitMaterial;
 var shaded=false;
 if(h.classKey!=${PT_NO_CLASS}u&&h.classKey!=${PT_GROUND_CLASS}u){
  mat=ptUnpackHitMaterial(ptMaterials[index*${PT_HIT_MATERIAL_VECS}u],ptMaterials[index*${PT_HIT_MATERIAL_VECS}u+1u],ptMaterials[index*${PT_HIT_MATERIAL_VECS}u+2u]);
  shaded=true;
 }
 let view=(*path).direction;
 let normal=s.normal;
 // The subsurface scattering a material has: the radius the opacity gives (the more transparent, the wider), no anisotropy, the colour it adds to the diffuse.
 let scatters=shaded&&(mat.flags&${PT_MATERIAL_FLAG.subsurface}u)!=0u&&s.opacity<1.0;
 switch m{
  case ${mode('Radiance')}:{colour=s.emission;}
  case ${mode('WorldNormal')}:{colour=normal*0.5+0.5;}
  case ${mode('WorldSmoothNormal')}:{colour=s.vertexNormal*0.5+0.5;}
  case ${mode('WorldGeoNormal')}:{colour=s.geoNormal*0.5+0.5;}
  case ${mode('WorldTangent')}:{colour=ptWorldTangent(h)*0.5+0.5;}
  case ${mode('BaseColor')}:{colour=select(s.diffuse,mat.base,shaded);}
  case ${mode('DiffuseColor')}:{colour=s.diffuse;}
  case ${mode('SpecularColor')}:{colour=s.f0;}
  case ${mode('TransparencyColor')}:{colour=vec3f(1.0-s.opacity);}
  case ${mode('Metallic')}:{colour=vec3f(select(0.0,mat.metallic,shaded));}
  case ${mode('Specular')}:{colour=vec3f(select(0.5,mat.specular,shaded));}
  case ${mode('Roughness')}:{colour=vec3f(s.roughness);}
  case ${mode('Anisotropy')}:{colour=ptAnisotropyColour(0.0);}
  case ${mode('IOR')}:{colour=vec3f(s.ior);}
  case ${mode('ShadingModel')}:{colour=ptModelColour(select(0u,mat.model,shaded),shaded&&mat.transmission>0.0,shaded&&mat.thickness<=0.0,shaded&&(mat.flags&${PT_MATERIAL_FLAG.foliage}u)!=0u);}
  case ${mode('LightingChannelMask')}:{colour=ptChannelColour(h.flags);}
  case ${mode('TriangleID')},${mode('InstanceID')},${mode('ClusterID')}:{colour=ptFieldsColour(h.flags);}
  case ${mode('WorldPosition')}:{
   let cell=vec3i(round((h.position+ptView.eye.xyz)/0.1));
   colour=ptHashColour(ptHash32(ptHash32(ptHash32(bitcast<u32>(cell.x))+bitcast<u32>(cell.y))+bitcast<u32>(cell.z)));
  }
  case ${mode('LightGridCount')},${mode('LightGridAxis')},${mode('LightGridListHash')},${mode('LightGridSingular')}:{colour=ptShowGrid(h.position,m);}
  case ${mode('HitKind')}:{colour=select(vec3f(1.0,0.0,0.0),vec3f(0.0,1.0,0.0),h.front);}
  case ${mode('SSSColor')}:{colour=select(vec3f(0.0),mat.subsurface,scatters);}
  case ${mode('SSSRadius')}:{colour=select(vec3f(0.0),vec3f((1.0-s.opacity)*10.0),scatters);}
  case ${mode('SSSWeight')}:{
   if(scatters){colour=vec3f(s.opacity*ptPrepareBsdf(s,-view).diffuseWeight);}
  }
  case ${mode('SSSPhase')}:{colour=select(vec3f(0.0),ptRamp(0.5),scatters);}
  case ${mode('FuzzColor')}:{colour=select(vec3f(0.0),s.fuzzColor,s.fuzz>0.0);}
  case ${mode('FuzzRoughness')}:{colour=select(vec3f(0.0),vec3f(sheenFuzzRoughness(s.roughness)),s.fuzz>0.0);}
  case ${mode('FuzzAmount')}:{colour=vec3f(s.fuzz);}
  case ${mode('BSDFOpacity')}:{colour=vec3f(s.opacity);}
  case ${mode('BackfacingNormal')}:{
   colour=vec3f(1.0);
   let k1=dot(normal,view);
   let k2=dot(s.geoNormal,reflect(view,normal));
   if(k1>1e-3){colour=vec3f(0.0,1.0,0.0);}else if(k2< -1e-3){colour=vec3f(1.0,0.0,0.0);}
  }
  default:{}
 }
 var fake=1.0;
 if(ptShowNeedsShading(m)){
  if(ptGridParams.visualizeAo>0.0){
   let e=ptRand2(&(*path).rand);
   let r=sqrt(e.x);
   let phi=2.0*PI*e.y;
   let direction=outOfFrame(vec3f(r*cos(phi),r*sin(phi),sqrt(1.0-e.x)),frameAround(normal));
   fake=select(0.0,1.0,ptVisible(ptRayBias(s.position,s.hitT,s.geoNormal),direction,ptGridParams.visualizeAo,true)>0.0);
  }else{
   fake=abs(dot(normal,view));
  }
 }
 // The layer adds its colour in proportion to what it covers and to what the layers before let through; the last round covers the ray whatever the opacity.
 let layer=(*path).throughput;
 let transparency=select(vec3f(1.0-s.opacity),vec3f(0.0),ptRound()>=ptRounds());
 let coverage=vec3f(1.0)-transparency;
 ptAccumulate(path,colour*layer*coverage*fake,camera);
 (*path).alpha+=luminance(layer*coverage);
 if((*path).depth==0.0&&s.opacity>0.3333){
  let clip=ptView.viewProjection*vec4f(s.position+ptView.eye.xyz,1.0);
  (*path).depth=clip.z/clip.w;
 }
 if(s.opacity<1.0){(*path).segment.x+=1.0;}
 (*path).throughput=layer*transparency;
 if(any((*path).throughput>vec3f(0.0))){
  (*path).origin=ptRayBias(s.position,s.hitT,-s.geoNormal);
  return true;
 }
 if(m==${mode('TransparencyCount')}){ptShowCount(path,true,normal);}
 return false;
}`,
)
