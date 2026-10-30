import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { frameAround } from '../../../../../math/src/wgsl/basis.ts'
import { luminance } from '../../../../../math/src/wgsl/color.ts'
import { visibleGgxHalf } from '../../../../../math/src/wgsl/sampling.ts'

/** How far a path starts past the surface it left, in metres (0.05 cm). */
export const TRACED_PATH_OFFSET = 0.0005

/** The blend modes of a hit's material as the path reads them. */
export const TRACED_BLEND = { opaque: 0, translucent: 1 } as const

/**
 * A REFRACTION OR A REFLECTION SAMPLED AT A SURFACE (`rttSampleRefraction`): the ray `dir` meets the surface of normal `normal` (facing the ray) going from a
 * medium to one of relative index `eta`; the Fresnel term of the dielectric (the mean of the two polarisations) decides, against `pick` in [0,1), between
 * the refracted direction (`true`, the term left being the transmitted share) and the reflected one (`false`, which total internal reflection also gives, the term one).
 */
const REFRACTION_WGSL = `fn rttSampleRefraction(dir:vec3f,normal:vec3f,eta:f32,pick:f32,outDir:ptr<function,vec3f>,fresnel:ptr<function,f32>)->bool{
 let c=abs(dot(dir,normal));
 let g2=eta*eta-1.0+c*c;
 if(g2>=0.0){
  let g=sqrt(g2);
  let a=(g-c)/(g+c);
  let b=(c*(g+c)-1.0)/(c*(g-c)+1.0);
  let fr=0.5*a*a*(1.0+b*b);
  if(pick>=fr){
   *fresnel=1.0-fr;
   *outDir=normalize(dir+normal*(c-g));
   return true;
  }
  *fresnel=fr;
 }else{
  *fresnel=1.0;
 }
 *outDir=dir+(2.0*c)*normal;
 return false;
}`

/**
 * THE PATH OF A RAY THROUGH THE TRANSLUCENT SURFACES (`rttTracePath`), the traced translucency's kernel text. A primary path goes on from the eye through the
 * surfaces it meets, up to `RTT_MAX_PRIMARY` events; off each translucent surface a secondary path (a reflection ray, or a refraction ray where the primary
 * ray is bent) goes through up to `RTT_MAX_SECONDARY` more. Each hit adds the light it gives, weighed by the secondary path's throughput and the
 * surface's coverage, to the radiance; a translucent surface lets the throughput through by its coverage and the transmittance of its medium; an
 * opaque one ends the primary path. The primary path's throughput and the share of the background it lets show come back with the radiance, and the
 * distance of the brightest secondary path, which the temporal pass reprojects by.
 *
 * With `RTT_REFRACTION` the rays bend through surfaces of an index of refraction above one: the primary ray, bent, may meet opaque surfaces and back
 * faces (a back face of a translucent surface refracts out again and costs no event), and one that escapes sees the sky. Without it the index is one.
 * The caller declares: `rttScene(origin, dir, tMin, tMax, onlyTranslucent, cullBack) -> StHit`, `rttSurface(hit, dir) -> RttSurface` (the shading normal facing
 * the ray and the material at the hit), `rttHitLight(hit, origin, dir, surface, reflectionAlpha) -> vec3f` (the light the hit gives toward the ray),
 * `rttSky(dir) -> vec3f`, `rttRandom1() -> f32`, `rttRandom2() -> vec2f`, and the constants `RTT_MAX_PRIMARY`, `RTT_MAX_SECONDARY`, `RTT_THRESHOLD`,
 * `RTT_REFRACTION`, `RTT_SAMPLE_REFLECTION_IN_REFLECTIONS`, `RTT_NEAR_MAX` (the longest a bent or secondary ray goes), `RTT_START_BIAS` and `RTT_START_NORMAL_BIAS`
 * (the reflections' biases). The share of the light a surface leaves to a reflection ray is the reflections' own (`reflectionTraceShare` of the path's roughness squared), so the caller's program holds `REFLECTION_REACH_WGSL`.
 */
export const TRACED_PATH_WGSL = wgslBlock(
  'TRACED_PATH_WGSL',
  [frameAround, luminance, visibleGgxHalf, wgslBlock('RTT_REFRACTION_WGSL', [], REFRACTION_WGSL)],
  `const RTT_OFFSET:f32=${TRACED_PATH_OFFSET};
const RTT_BLEND_OPAQUE:u32=${TRACED_BLEND.opaque}u;
/** The material of a hit as the path reads it: the specular colour and roughness of its top layer, its diffuse colour, the index of refraction, the share of the light its medium lets through before the coverage, its coverage (opacity), what it emits, its blend mode and whether it is a holdout. */
struct RttMaterial{specular:vec3f,roughness:f32,diffuse:vec3f,ior:f32,through:vec3f,opacity:f32,emissive:vec3f,blend:u32,holdout:bool,}
struct RttSurface{normal:vec3f,geoNormal:vec3f,material:RttMaterial,}
/** What a path brought back: the light, the throughput the background shows through, the share of the background hidden and the share of the surfaces' own, the distance of the brightest secondary path, whether anything was hit. */
struct RttResult{radiance:vec3f,throughput:vec3f,background:vec2f,distance:f32,hit:bool,}
struct RttRay{origin:vec3f,dir:vec3f,tMin:f32,tMax:f32,}
fn rttAny(v:vec3f,limit:f32)->bool{return any(v>vec3f(limit));}
fn rttSegment(through:vec3f,coverage:f32)->vec3f{return vec3f(1.0-coverage)+through*coverage;}
fn rttTracePath(first:RttRay)->RttResult{
 var result:RttResult;
 result.radiance=vec3f(0.0);
 result.hit=false;
 result.distance=0.0;
 var primaryThroughput=vec3f(1.0);
 var background=0.0;
 var locked=false;
 var primaryBent=false;
 var secondaryBent=false;
 var primaryOrigin=first.origin;
 var primaryDir=first.dir;
 var primaryFar=first.tMax;
 var brightest=-1.0;
 let eye=first.origin;
 for(var p=0;p<RTT_MAX_PRIMARY;p++){
  var secondary=primaryThroughput;
  var pathRoughness=0.0;
  var pathLuminance=0.0;
  var pathT=length(primaryOrigin-eye);
  var ray=RttRay(primaryOrigin,primaryDir,select(0.0005,0.0,primaryBent),select(primaryFar,RTT_NEAR_MAX,primaryBent));
  secondaryBent=false;
  for(var s=0;s<RTT_MAX_SECONDARY+1;s++){
   let bent=select(secondaryBent,primaryBent,s==0);
   let hit=rttScene(ray.origin,ray.dir,ray.tMin,ray.tMax,s==0&&!bent,!bent);
   if(hit.hit&&(hit.frontFace||hit.twoSided)){
    result.hit=true;
    pathT+=hit.distance;
    let at=ray.origin+ray.dir*hit.distance;
    let surf=rttSurface(hit,ray.dir);
    var m=surf.material;
    if(!RTT_REFRACTION){m.ior=1.0;}
    let translucent=m.blend!=RTT_BLEND_OPAQUE;
    var coverage=select(m.opacity,1.0,m.blend==RTT_BLEND_OPAQUE);
    let refractive=m.ior>1.0;
    pathRoughness=1.0-(1.0-pathRoughness)*(1.0-m.roughness);
    var reflectAlpha=0.0;
    if(s<RTT_MAX_SECONDARY){reflectAlpha=reflectionTraceShare(pathRoughness*pathRoughness,0u);}
    var light=rttHitLight(hit,ray.origin,ray.dir,surf,reflectAlpha)+m.emissive;
    light=coverage*secondary*light;
    if(s!=0){pathLuminance+=dot(light,vec3f(0.2126,0.7152,0.0722));}
    if(translucent&&s==0&&!locked){
     var add=0.0;
     if(m.holdout){
      light=vec3f(0.0);
      reflectAlpha=0.0;
      if(refractive){m.through=vec3f(0.0);coverage=1.0;}
      add=m.through.x*coverage;
     }
     background+=dot(secondary,vec3f(1.0/3.0))*add;
     if(refractive){locked=true;}
    }
    result.radiance+=light;
    var reflection=vec3f(0.0);
    var h=surf.normal;
    if(reflectAlpha>0.0){reflection=secondary*reflectAlpha*coverage*m.specular;}
    if(translucent){secondary*=rttSegment(m.through,coverage);}else{secondary=reflection;}
    var sampleReflection=rttAny(reflection,RTT_THRESHOLD);
    if(!sampleReflection){reflection=vec3f(0.0);}
    if(m.roughness>0.0&&(sampleReflection||(m.ior>1.0&&rttAny(secondary,RTT_THRESHOLD)))){
     var e=rttRandom2();
     e.y*=1.0-0.1;
     let basis=frameAround(surf.normal);
     let tangentV=vec3f(dot(basis.x,-ray.dir),dot(basis.y,-ray.dir),dot(basis.z,-ray.dir));
     let g=visibleGgxHalf(e,vec2f(m.roughness*m.roughness),tangentV);
     h=basis.x*g.x+basis.y*g.y+basis.z*g.z;
    }
    let normalOut=select(-surf.geoNormal,surf.geoNormal,hit.frontFace);
    if(translucent&&rttAny(secondary,RTT_THRESHOLD)){
     if(m.ior>1.0){
      if(s==0){primaryBent=true;}else{secondaryBent=true;}
      var refracted=vec3f(0.0);
      var fresnel=0.0;
      _=rttSampleRefraction(ray.dir,h,m.ior,1.0,&refracted,&fresnel);
      if(s==0){
       primaryOrigin=at-RTT_OFFSET*normalOut;
       primaryDir=refracted;
      }else{
       var pickRefraction=true;
       if(sampleReflection&&RTT_SAMPLE_REFLECTION_IN_REFLECTIONS){
        let wr=luminance(secondary)*fresnel;
        let wf=luminance(reflection)*(1.0-fresnel);
        pickRefraction=rttRandom1()<wr/max(wr+wf,1e-5);
       }
       if(pickRefraction){
        ray.origin=at-RTT_OFFSET*normalOut;
        ray.dir=refracted;
        ray.tMin=0.0;
        ray.tMax=RTT_NEAR_MAX;
        sampleReflection=false;
       }
      }
     }else{
      if(s==0){
       primaryOrigin=at;
       primaryDir=ray.dir;
       if(bent){primaryOrigin+=RTT_OFFSET*primaryDir;}else{primaryFar-=hit.distance;}
      }else{
       var pickRefraction=true;
       if(sampleReflection&&RTT_SAMPLE_REFLECTION_IN_REFLECTIONS){
        let wr=luminance(secondary);
        let wf=luminance(reflection);
        pickRefraction=rttRandom1()<wr/max(wr+wf,1e-5);
       }
       if(pickRefraction){
        ray.origin=at+RTT_OFFSET*ray.dir;
        ray.tMin=0.0;
        ray.tMax=RTT_NEAR_MAX;
        sampleReflection=false;
       }
      }
     }
    }
    if(s==0){
     if(translucent){primaryThroughput=secondary;}
     else{primaryThroughput=vec3f(0.0);p=RTT_MAX_PRIMARY-1;}
    }
    if(sampleReflection){
     secondary=reflection;
     ray.dir=reflect(ray.dir,h);
     ray.tMax=RTT_NEAR_MAX;
     if(s==0){
      ray.origin=at+saturate(dot(normalOut,ray.dir))*RTT_START_NORMAL_BIAS*normalOut;
      ray.tMin=RTT_START_BIAS;
     }else{
      ray.origin=at+RTT_OFFSET*normalOut;
      ray.tMin=0.0;
     }
    }
    if((s==0&&!sampleReflection)||!rttAny(secondary,RTT_THRESHOLD)){break;}
   }else if(hit.hit){
    let surf=rttSurface(hit,ray.dir);
    var m=surf.material;
    if(!RTT_REFRACTION){m.ior=1.0;}
    let at=ray.origin+ray.dir*hit.distance;
    if(m.blend!=RTT_BLEND_OPAQUE){
     var refracted=true;
     if(m.ior>1.0){
      if(s==0){primaryBent=true;}else{secondaryBent=true;}
      var dir=vec3f(0.0);
      var fresnel=0.0;
      refracted=rttSampleRefraction(ray.dir,surf.normal,1.0/m.ior,1.0,&dir,&fresnel);
      ray.origin=at+select(-RTT_OFFSET,RTT_OFFSET,refracted)*surf.geoNormal;
      ray.dir=dir;
     }else{
      ray.origin=at+RTT_OFFSET*ray.dir;
     }
     ray.tMin=0.0;
     ray.tMax=RTT_NEAR_MAX;
     if(s==0){
      primaryOrigin=ray.origin;
      primaryDir=ray.dir;
      if(refracted){p--;}
      break;
     }
     if(refracted){s--;}
    }else{
     if(s==0){
      result.hit=true;
      primaryThroughput=vec3f(0.0);
      p=RTT_MAX_PRIMARY-1;
     }
     break;
    }
   }else{
    if(s==0){
     if(primaryBent){
      result.radiance+=secondary*rttSky(ray.dir);
      primaryThroughput=vec3f(0.0);
     }
     p=RTT_MAX_PRIMARY-1;
    }else{
     let sky=secondary*rttSky(ray.dir);
     pathLuminance+=dot(sky,vec3f(0.2126,0.7152,0.0722));
     result.radiance+=sky;
     pathT=3.0e38;
    }
    break;
   }
  }
  if(pathLuminance>brightest){
   brightest=pathLuminance;
   result.distance=pathT;
  }
  if(!rttAny(primaryThroughput,RTT_THRESHOLD)){break;}
 }
 result.throughput=primaryThroughput;
 result.background=vec2f(background,select(0.0,dot(primaryThroughput,vec3f(1.0/3.0)),!locked));
 return result;
}`,
)
