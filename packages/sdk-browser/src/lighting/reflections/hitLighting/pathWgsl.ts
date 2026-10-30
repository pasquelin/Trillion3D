import { wgslBlock, wgslFn } from '../../../../../math/src/wgsl/decl.ts'
import { envBrdfF90 } from '../../../../../math/src/wgsl/lighting.ts'
import { frameAround } from '../../../../../math/src/wgsl/basis.ts'
import { octEncode, octDecode } from '../../../../../math/src/wgsl/octahedral.ts'
import { visibleGgxHalf } from '../../../../../math/src/wgsl/sampling.ts'
import { declaredLightWgsl } from '../../direct/lightLoopWgsl.ts'
import { lightStrengthWgsl } from '../../direct/lightStrengthWgsl.ts'
import { PT_RANDOM_WGSL } from '../../pathTracing/randomWgsl.ts'
import { RAY_WGSL } from '../../shadows/rayTraced/rayTracedWgsl.ts'
import { SKY_READ_WGSL } from '../../atmosphere/skyReadWgsl.ts'
import { ENVIRONMENT_BRDF_WGSL } from '../../direct/environmentBrdfWgsl.ts'
import { STANDARD_LIGHTING_WGSL } from '../../standardLighting.ts'
import { lightFunctionReadWgsl, type LightFunctionBindings } from '../../lightFunction/readWgsl.ts'
import { lightGridLookupWgsl } from '../../rays/lightGrid/lightGridWgsl.ts'
import { lightProfileOfWgsl } from '../../lightProfile/lightProfileWgsl.ts'
import type { LightProfileBindings } from '../../lightProfile/lightProfileText.ts'
import { TRACED_PATH_OFFSET } from '../translucency/pathWgsl.ts'
import { TRACED_MATERIAL_WORD_WGSL } from '../translucency/materialWord.ts'
import { TRACED_MATERIAL_AT, TRACED_MATERIAL_FLAGS } from '../translucency/materialWords.ts'
import { LIT_BOUNCE_VECS } from './constants.ts'

/**
 * THE MATERIAL OF A HIT as the hit lighting reads it from the scene trace's table, by the one resolver of every per-hit material read (`stMaterialWordOf`: the placement's words, or an HLOD actor's own): the diffuse colour (the base colour less the metal's), the specular colour, the roughness, the emitted light and the coverage (the opacity of a translucent surface, one for the rest), black and opaque for an actor's record that names no material.
 * `litMaterialKey` is the key a hit is sorted by: a hash of the words that make the shading of a material diverge (its flags, its base map's slot or graph record, its cutout bits), so that the threads that follow one another shade the same program.
 */
export const LIT_MATERIAL_WGSL = wgslBlock(
  'LIT_MATERIAL_WGSL',
  [TRACED_MATERIAL_WORD_WGSL],
  `struct LitMaterial{diffuse:vec3f,specular:vec3f,roughness:f32,emissive:vec3f,coverage:f32,}
fn litMaterialOf(placement:u32,record:u32)->LitMaterial{
 let at=stMaterialWordOf(placement,record);
 if(at==NO_INDEX){return LitMaterial(vec3f(0.0),vec3f(0.0),0.0,vec3f(0.0),1.0);}
 return LitMaterial(
  stVec3(at+${TRACED_MATERIAL_AT.diffuse}u),
  stVec3(at+${TRACED_MATERIAL_AT.specular}u),
  bitcast<f32>(stTable[at+${TRACED_MATERIAL_AT.roughness}u]),
  stVec3(at+${TRACED_MATERIAL_AT.emissive}u),
  select(1.0,bitcast<f32>(stTable[at+${TRACED_MATERIAL_AT.opacity}u]),(stTable[at+${TRACED_MATERIAL_AT.flags}u]&${TRACED_MATERIAL_FLAGS.translucent}u)!=0u));
}
/** Whether the surface a hit met is translucent (the hit lighting meets those only where the path goes through them). */
fn litTranslucent(placement:u32,record:u32)->bool{
 let at=stMaterialWordOf(placement,record);
 return at!=NO_INDEX&&(stTable[at+${TRACED_MATERIAL_AT.flags}u]&${TRACED_MATERIAL_FLAGS.translucent}u)!=0u;
}
fn litMaterialKey(placement:u32,record:u32)->u32{
 let at=stMaterialWordOf(placement,record);
 if(at==NO_INDEX){return 0u;}
 var h=stTable[at+${TRACED_MATERIAL_AT.flags}u]*0x9e3779b1u;
 h=(h^stTable[at+${TRACED_MATERIAL_AT.map}u])*0x85ebca6bu;
 h=(h^stTable[at+${TRACED_MATERIAL_AT.mask}u])*0xc2b2ae35u;
 return (h^(h>>16u))&0x7fffu;
}`,
)

/** What the translucent surfaces an accumulating shadow ray passed let through, read once `stTrace` has returned: the ray's caller sets it to one before the trace. */
const LIT_VISIBILITY = wgslBlock('LIT_VISIBILITY', [], 'var<private> stVisibility:vec3f;')

/**
 * THE ACCUMULATING SHADOW RAYS' PASS over a translucent surface (`stAccumulates`, which the scene trace calls on each triangle a ray would take and whose default passes none): with `ST_ACCUMULATE` the surface the hit's material words describe (`stMaterialWordOf`, the placement's or the HLOD actor's own) that is translucent is passed by, its coverage
 * taking from `stVisibility` what the medium lets through; the trace stops at the first opaque surface, or where nothing is left.
 */
const LIT_ACCUMULATES = wgslFn(
  'stAccumulates',
  [TRACED_MATERIAL_WORD_WGSL, LIT_VISIBILITY],
  `fn stAccumulates(placement:u32,record:u32)->bool{
 if((stRay.flags&ST_ACCUMULATE)==0u){return false;}
 let material=stMaterialWordOf(placement,record);
 if(material==NO_INDEX||(stTable[material+${TRACED_MATERIAL_AT.flags}u]&${TRACED_MATERIAL_FLAGS.translucent}u)==0u){return false;}
 let opacity=bitcast<f32>(stTable[material+${TRACED_MATERIAL_AT.opacity}u]);
 stVisibility*=vec3f(1.0-opacity)+stVec3(material+${TRACED_MATERIAL_AT.through}u)*opacity;
 if(any(stVisibility>vec3f(0.0))){return true;}
 stVisibility=vec3f(0.0);
 return false;
}`,
)

/** The sides of the path a host chooses: where the light functions' atlas and the light profiles are read, the expression of the exposure of the image the lights' strength is read under, and the one of the scale the path's light is held under in half floats. */
export interface LitPathHost {
  lightFunction: LightFunctionBindings
  lightProfile: LightProfileBindings
  /** The WGSL expression of the eye's position the scene trace's frame is taken off by (a vec3f). */
  eye: string
  /** The WGSL expression of the exposure of the image (`lightStrength`'s inverse exposure blend). */
  exposure: string
  /** The WGSL expression of the pre-exposure the host multiplies the light by when it writes it: the first pass holds the light multiplied by it, so that the half floats keep their range, and the second divides it out. */
  scale: string
  /** The binding in group 0 of the light grid's texture (`../../rays/lightGrid/`): the lights a hit loops over are those of its cell. */
  lightGrid: number
}

/** The scale the light of a path's first vertex is held under in the radiance buffer (`litScale`, the host's expression), at least a millionth. The first pass and the second both declare it. */
export const litScaleWgsl = (scale: string) =>
  wgslBlock(`LIT_SCALE_WGSL(${scale})`, [], `fn litScale()->f32{return max(${scale},1.0e-6);}`)

/**
 * THE VERTICES OF A PATH IN THE RADIANCE BUFFER (`litVertexAt`): a trace holds `LIT_FIRST_VECS` vec4u for its first vertex, then four for each vertex more a path can hold (its reflection bounces over its refraction
 * stretches; the vertex k). A vertex holds, in two vec4u, its light (half floats, `w` 1) and its colours (the diffuse colour and the roughness, the rough share of the specular colour, the top layer's reflectance); `w` 0 is no vertex, 2 a sky met after a bounce, 4 a sky
 * that began a stretch, 3 a vertex passed without light. Two more hold the hit it was made at (`litKeepsHit`: its point and object, its normal, direction and distance): the first vertex of a host
 * that sets `LIT_FIRST_VECS` to 4, every later vertex of the others. The host declares `LIT_FIRST_VECS`.
 */
const LIT_VERTEX_WGSL = wgslBlock(
  'LIT_VERTEX_WGSL',
  [],
  `fn litVertexAt(slot:u32,k:u32)->u32{return slot+select(0u,LIT_FIRST_VECS+${LIT_BOUNCE_VECS}u*(k-1u),k>0u);}
fn litKeepsHit(k:u32)->bool{return k>0u||LIT_FIRST_VECS>2u;}
fn litUnpack(w:vec2u)->vec4f{
 let a=unpack2x16float(w.x);
 let b=unpack2x16float(w.y);
 return vec4f(a,b);
}
fn litPack(rgb:vec3f,w:f32)->vec2u{return vec2u(pack2x16float(rgb.xy),pack2x16float(vec2f(rgb.z,w)));}`,
)

/**
 * THE PATH OF A TRACE TO LIGHT (`litPath`, which the first pass of a host calls for a trace of its sorted list): the ray is traced again from just short of its hit (a thousandth of a metre) so that it meets the same triangle,
 * which gives the placement the hit's material is read by (the retrace skips the masks' any-hit test where `HIT_LIGHT_FORCE_OPAQUE` says so). With the direct lighting, the lights that reach the hit
 * (`lightReaches`) give their irradiance (`declaredBareIrradiance`), each times the share of its shadow ray that arrives (`litVisible`: none; one ray to the light's centre; one to a point of its
 * source drawn by the trace's noise, `rtSample`; the masked surfaces cut by the any-hit test, the translucent ones letting through what their coverage leaves where the mode is fractional), times the light's profile toward the hit and its function there (in grey), times the whole
 * response of the material toward the eye (`standardLobe`: its diffuse and its specular lobe, at the light's centre), plus the emitted light. The second pass (`litResolve`) finds, kept beside, the
 * material's colours and the top layer's reflectance, in two `vec4u` of half floats. A hit the second trace misses is left invalid.
 * The host declares the radiance buffer `litRadiance`, the words of the mode (`hitLightHas`, `hitLightBounces`, `hitLightRefractions`, `hitLightVertices`, `hitLightShadowMode`, `hitLightTranslucency`), `LIT_FIRST_VECS`, `litSunReach` (how far a shadow ray toward the sun runs), `litTraceShare` (the share of a lobe of squared roughness that the next ray carries) and `litBackFaceEnds` (whether a hit on the back of a surface that is not two-sided ends the path: a host that culls them in its trace says no).
 * With more than one reflection bounce (`hitLightBounces`) the path goes on from a lit hit while the surfaces met are smooth enough for the reflections to trace (`litTraceShare` of the roughness the path has accumulated): the ray reflected on a normal of the specular lobe's visible ones, from just past the surface, weighed by the top layer's reflectance met (the environment BRDF of the specular colour toward the eye); every later vertex is
 * lit as the first, its terms (already weighed by the path's throughputs and the surface's coverage, the specular ones by the share the next ray does not carry) kept with its point, normal, direction and distance for the second pass, and a ray that leaves the scene leaves the sky's light to be read there.
 * With refraction events (`hitLightRefractions`) the translucent surfaces are met, not passed: when the reflections of a stretch have ended the path goes on, in the direction it began, from just past the first surface of the stretch, the throughput multiplied by what that surface's coverage lets through, for up to that many more stretches while any of its channels stays at a hundredth; a stretch whose first ray leaves the scene reads the sky and ends the path.
 */
export const litPathWgsl = (host: LitPathHost) =>
  wgslBlock(
    `LIT_PATH_WGSL(${host.lightFunction.atlas},${host.lightFunction.eye},${host.lightProfile.atlas},${host.lightProfile.sampler},${host.eye},${host.exposure},${host.scale},${host.lightGrid})`,
    [
      LIT_VERTEX_WGSL,
      LIT_MATERIAL_WGSL,
      LIT_ACCUMULATES,
      declaredLightWgsl({}, { term: 'bareIrradiance' }),
      lightStrengthWgsl(host.exposure),
      litScaleWgsl(host.scale),
      PT_RANDOM_WGSL,
      RAY_WGSL,
      frameAround,
      visibleGgxHalf,
      octEncode,
      STANDARD_LIGHTING_WGSL,
      ENVIRONMENT_BRDF_WGSL,
      envBrdfF90,
      lightFunctionReadWgsl(host.lightFunction),
      lightProfileOfWgsl(host.lightProfile),
      lightGridLookupWgsl(host.lightGrid),
    ],
    `/** The ray of a path as the host casts it: its origin (in the scene trace's frame, the eye not yet taken off), its end and the scene trace's flags. */
struct LitRay{origin:vec3f,far:f32,flags:u32,}
/** A path's start: the direction it runs in and its ray. */
struct LitStart{R:vec3f,ray:LitRay,}
/** The share of a light a shadow ray from origin along D for reach lets through: one traversal, as the any-hit shader of the shadow ray runs it. */
fn litVisible(origin:vec3f,D:vec3f,reach:f32)->vec3f{
 if(hitLightShadowMode()==0u){return vec3f(1.0);}
 let translucency=hitLightTranslucency();
 // Fractional visibility: the translucent surfaces on the way, whole meshes of them too, let through what their coverage leaves (ST_ACCUMULATE), the first opaque one stops the ray.
 let flags=ST_SHADOW|ST_ANY_HIT|select(ST_SKIP_TRANSLUCENT|select(0u,ST_FORCE_OPAQUE,translucency==0u),ST_MEET_TRANSLUCENT|ST_ACCUMULATE,translucency>=2u);
 stVisibility=vec3f(1.0);
 let seen=stTrace(StRay(origin-${host.eye},D,0.0,reach,flags));
 return select(stVisibility,vec3f(0.0),seen.hit||!stComplete);
}
/** The ray to the light, drawing its point of the source from the sequence of the path (one draw a light, only where the shadow mode is soft). */
fn litLightRay(light:DirectLight,P:vec3f,rng:ptr<function,PtRand>)->RtRay{
 if(hitLightShadowMode()==2u){
  var ray=rtSample(light,P,ptRand2(rng));
  if(isSun(light)){ray.reach=min(ray.reach,litSunReach());}
  return ray;
 }
 if(isSun(light)){return RtRay(-light.directionCone.xyz,litSunReach(),true);}
 let toLight=light.positionRange.xyz-P;
 let reach=max(length(toLight),1.0e-6);
 return RtRay(toLight/reach,reach,true);
}
/** The direction from P to the centre of the light, which the material's response is evaluated toward. */
fn litLightCentre(light:DirectLight,P:vec3f)->vec3f{
 if(isSun(light)){return -light.directionCone.xyz;}
 return normalize(light.positionRange.xyz-P);
}
fn litPath(slot:u32,trace:LitStart,found:f32,seed:PtRand){
 var rng=seed;
 var retraceFlags=trace.ray.flags|select(0u,ST_FORCE_OPAQUE,hitLightHas(HIT_LIGHT_FORCE_OPAQUE));
 let bounces=hitLightBounces();
 let refractions=hitLightRefractions();
 let vertices=hitLightVertices();
 let followed=hitLightHas(HIT_LIGHT_DIRECT)||hitLightHas(HIT_LIGHT_SKYLIGHT);
 // The path: the ray traced again from just short of the hit the first trace recorded (a thousandth of a metre), then, from each lit hit, the reflection ray its specular lobe sends on, weighed by the top layer's reflectance met. With refraction events the path, once its reflections have ended, goes on straight through the first surface it met, weighed by what the surface's coverage lets through, as a stretch of its own.
 let refractDir=trace.R;
 var origin=trace.ray.origin;
 var D=refractDir;
 var begin=max(found-0.001,0.0);
 var refractThrough=vec3f(1.0);
 var v=0u;
 var seg=0u;
 loop{
  var through=vec3f(1.0);
  var pathRoughness=0.0;
  var kk=0u;
  var nextRefract=vec3f(1.0);
  var refractOrigin=origin;
  var started=false;
  var stopped=false;
  loop{
   let vertex=litVertexAt(slot,v);
   var hit=stTrace(StRay(origin-${host.eye},D,begin,trace.ray.far,retraceFlags));
   // A first retrace that misses the translucent surface the scene stage met leaves the path to what lies behind it, as the stage answers where it does not meet them.
   if(!hit.hit&&v==0u&&(retraceFlags&ST_MEET_TRANSLUCENT)!=0u){
    retraceFlags=(retraceFlags&~ST_MEET_TRANSLUCENT)|ST_SKIP_TRANSLUCENT;
    hit=stTrace(StRay(origin-${host.eye},D,begin,trace.ray.far,retraceFlags));
   }
   var out0=vec4u(0u);
   var out1=vec4u(0u);
   var goesOn=false;
   if(hit.hit&&litBackFaceEnds(hit)){
    // The back of a surface that is not two-sided ends the path with no light, a hit where it stands.
    out0=vec4u(litPack(vec3f(0.0),3.0),0u,0u);
   }else if(hit.hit){
    // A host that culls the back faces in the trace never meets one; the trace turns the normal toward the ray's side, so that a back face of a two-sided surface is lit from the side the ray came.
    let N=hit.normal;
    let P=origin+D*hit.distance;
    let V=-D;
    let material=litMaterialOf(hit.placement,hit.record);
    // The path goes on straight from the first surface of a stretch, what its coverage leaves of the light carrying on.
    if(kk==0u){
     refractOrigin=P+${TRACED_PATH_OFFSET}*D;
     nextRefract=vec3f(1.0-material.coverage);
     started=true;
    }
    // The roughness of the path so far ends it on rough surfaces: the share of the specular light the next ray carries, the rest keeping the rough approximation.
    pathRoughness=1.0-(1.0-pathRoughness)*(1.0-material.roughness);
    let next=select(0.0,litTraceShare(pathRoughness*pathRoughness),followed&&kk+1u<bounces);
    var direct=vec3f(0.0);
    if(hitLightHas(HIT_LIGHT_DIRECT)){
     let surface=lobeSurfaceOf(material.specular,material.diffuse,0.0,material.roughness,N,V);
     let bias=max(1.0e-3,1.0e-4*length(P-${host.eye}));
     // The lights draw from a copy of the path's sequence, as the vertex's lighting takes it by value: the next vertex starts from the sequence as the reflection ray's draw left it.
     var lightRng=rng;
     let cell=litCellOf(P);
     for(var n=0u;n<cell.count;n++){
      let rank=litCellRank(n,cell);
      if(!lightReaches(rank,P)){continue;}
      let irradiance=declaredBareIrradiance(rank,P,N,0.0);
      if(!any(irradiance>vec3f(0.0))){continue;}
      let light=directLights.items[rank];
      let sample=litLightRay(light,P,&lightRng);
      if(!sample.valid){continue;}
      let visible=litVisible(P+N*bias,sample.direction,sample.reach);
      if(!any(visible>vec3f(0.0))){continue;}
      let L=litLightCentre(light,P);
      let NdotL=max(dot(N,L),1.0e-4);
      // The light's profile and its function (in grey), at the hit, on the whole of the light's contribution.
      let given=lightProfileOf(light,P)*dot(lightFunctionOf(light,P),vec3f(1.0/3.0));
      direct+=given*irradiance*visible*standardLobe(surface,N,V,normalize(L+V),NdotL,1.0/NdotL);
     }
    }
    // The top layer's reflectance toward the eye (the environment BRDF of the specular colour), which weighs the next ray and the sky light's reflection.
    var top=vec3f(0.0);
    if(next>0.0||hitLightHas(HIT_LIGHT_CAPTURES)){top=environmentBrdf(material.specular,envBrdfF90(material.specular),material.roughness,saturate(dot(N,V)));}
    // The vertex's terms, weighed by the refraction and reflection throughputs and the surface's coverage; the specular ones by what the next ray does not carry.
    let weight=refractThrough*through*material.coverage;
    // The pre-exposed light is held at the half floats' largest value, as a brighter one would become infinite and then black.
    out0=vec4u(litPack(min(weight*(material.emissive+direct)*litScale(),vec3f(65504.0)),1.0),litPack(weight*material.diffuse,material.roughness));
    out1=vec4u(litPack(weight*0.45*material.specular*(1.0-next),0.0),litPack(weight*top*(1.0-next),0.0));
    if(litKeepsHit(v)){
     litRadiance[vertex+2u]=vec4u(bitcast<u32>(P.x),bitcast<u32>(P.y),bitcast<u32>(P.z),hit.object);
     litRadiance[vertex+3u]=vec4u(pack2x16snorm(octEncode(N)),pack2x16snorm(octEncode(D)),bitcast<u32>(hit.distance),0u);
    }
    if(next>0.0){
     through*=material.coverage*top;
     // The specular lobe's visible normals sampled, the ray reflected on the one drawn.
     var e=ptRand2(&rng);
     e.y*=1.0-0.1;
     let basis=frameAround(N);
     let tangentV=vec3f(dot(basis.x,V),dot(basis.y,V),dot(basis.z,V));
     let sampled=visibleGgxHalf(e,vec2f(material.roughness*material.roughness),tangentV);
     let H=basis.x*sampled.x+basis.y*sampled.y+basis.z*sampled.z;
     origin=P+${TRACED_PATH_OFFSET}*N;
     D=reflect(D,H);
     begin=0.0;
     goesOn=true;
    }
   }else if(kk>0u||seg>0u){
    if(stComplete){
     // A ray that leaves the scene sees the sky, which the second pass reads.
     // A sky met by a stretch's first ray ends the path; one met after a reflection bounce leaves the path to go on in its next stretch.
     out0=vec4u(litPack(refractThrough*through,select(4.0,2.0,kk==0u)),0u,0u);
     litRadiance[vertex+3u]=vec4u(0u,pack2x16snorm(octEncode(D)),0u,0u);
    }else{
     // One whose walk stopped before it was whole is black, as the scene stage answers it.
     out0=vec4u(litPack(vec3f(0.0),3.0),0u,0u);
    }
    // A stretch whose first ray leaves the scene ends the path.
    stopped=kk==0u;
   }
   litRadiance[vertex]=out0;
   litRadiance[vertex+1u]=out1;
   v++;
   kk++;
   if(!goesOn){break;}
  }
  refractThrough*=nextRefract;
  if(!started||stopped||seg>=refractions||!any(refractThrough>=vec3f(0.01))){break;}
  seg++;
  origin=refractOrigin;
  D=refractDir;
  begin=0.0;
 }
 // The path ends at the vertex before this one.
 if(v<vertices){litRadiance[litVertexAt(slot,v)]=vec4u(0u);}
}`,
  )

/**
 * THE SECOND PASS OF THE HIT LIGHTING (`litResolve`, which a host's finishing kernel calls for a trace of its sorted list, in the program whose cards are read for their indirect light): to the first pass's radiance it adds
 * the indirect light on the material's colours — the surface cache's indirect light at the hit, read by the host (`litCards`) over the cone of the ray, or the sky light's irradiance at its normal
 * (`HIT_LIGHT_SKYLIGHT`) — times the diffuse colour plus the rough-diffuse share of the specular one, over π; with the sky light and `HIT_LIGHT_CAPTURES`, the specular share is the top layer's
 * reflectance on the sky light's filtered cube along the reflected ray, with no occlusion (that of an unoccluded hit is one: the saturated power of the facing plus one never falls under it). The sum is the radiance the host takes the way its light goes. The vertices of a path with reflection bounces and refraction stretches are read in turn, each given its indirect light the same way, up to the one that ended the path (a vertex the path passed without light is skipped).
 */
export const LIT_RESOLVE_WGSL = wgslBlock(
  'LIT_RESOLVE_WGSL',
  [LIT_VERTEX_WGSL, SKY_READ_WGSL, octDecode],
  `/** What the host knows of a trace's first hit: its point (metres), normal, object and distance. */
struct LitHit{P:vec3f,N:vec3f,object:u32,distance:f32,}
/** What the host reads the cards with (litCards, which it declares): the cone of the ray and the coordinate its sampling noise is drawn at. */
struct LitLook{cone:f32,coord:vec2u,}
fn litResolve(slot:u32,R:vec3f,head:LitHit,look:LitLook)->vec3f{
 var radiance=vec3f(0.0);
 // The path's vertices, the first being the hit the host's first stage met, each lit by the first pass and given its indirect light here.
 for(var k=0u;k<hitLightVertices();k++){
  let vertex=litVertexAt(slot,k);
  let first=litRadiance[vertex];
  let base=litUnpack(first.xy);
  if(base.w<0.5){break;}
  // A vertex the path passed without light: its stretch ended there.
  if(base.w>2.5&&base.w<3.5){continue;}
  var D=R;
  var N=head.N;
  var P=head.P;
  var object=head.object;
  var distance=head.distance;
  if(litKeepsHit(k)){
   let place=litRadiance[vertex+2u];
   let extra=litRadiance[vertex+3u];
   N=octDecode(unpack2x16snorm(extra.x));
   D=octDecode(unpack2x16snorm(extra.y));
   P=bitcast<vec3f>(place.xyz);
   object=place.w;
   distance=bitcast<f32>(extra.z);
  }
  if(base.w>1.5){
   radiance+=base.xyz*skyRadianceAt(D,0.0);
   // Only a sky that began a stretch ended the path.
   if(base.w<3.0){break;}
   continue;
  }
  radiance+=base.xyz/litScale();
  let colours=litUnpack(first.zw);
  let second=litRadiance[vertex+1u];
  let rough=litUnpack(second.xy).xyz;
  let top=litUnpack(second.zw).xyz;
  if(hitLightHas(HIT_LIGHT_SKYLIGHT)){
   let irradiance=skyIrradiance(N)*0.3183098861837907;
   radiance+=colours.xyz*irradiance;
   if(hitLightHas(HIT_LIGHT_CAPTURES)){
    radiance+=top*skyRadianceAt(reflect(D,N),colours.w);
   }else{
    radiance+=rough*irradiance;
   }
  }else{
   let cards=litCards(object,P,N,distance,look);
   radiance+=(colours.xyz+rough)*select(vec3f(0.0),cards.radiance,cards.valid)*0.3183098861837907;
  }
 }
 return radiance;
}`,
)
