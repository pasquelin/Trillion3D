import { PI } from '../../../../math/src/wgsl/constants.ts'
import { hgPhase } from '../../../../math/src/wgsl/lighting.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { SKY_VIEW_LUT } from './layout.ts'

/**
 * THE AIR, AS EVERY ATMOSPHERE PROGRAM READS IT: the planet's rays and spheres, the three gases at
 * a point, their phase functions, and the way the tables are addressed. A program that includes it
 * declares what it reads the air through: `atmo(slot)` the atmosphere's block
 * (`../../../../sdk-core/src/scene/core/atmospherePack.ts`), `transmittanceAt(uv)` and
 * `multiScatterAt(uv)` the two tables, each of its own sampler.
 *
 * The planet is a sphere at the origin, lengths in kilometres: a point's height is its distance
 * from the origin less the ground's radius. Directions leave the eye.
 */
export const OPTICS_WGSL = wgslBlock(
  'OPTICS_WGSL',
  [PI, hgPhase],
  `
/** Lifts a point off the ground by a metre, against the float error of a sphere test. */
const PLANET_OFFSET:f32=0.001;
const SKY_VIEW_SIZE:vec2f=vec2f(${SKY_VIEW_LUT.width}.0,${SKY_VIEW_LUT.height}.0);
fn bottomRadius()->f32{return atmo(${ATMOSPHERE_SLOT.planet}u).y;}
fn topRadius()->f32{return atmo(${ATMOSPHERE_SLOT.planet}u).z;}
/** A light of the air: the unit direction toward it and its illuminance outside the air, times the
 *  scattered factor; the cosine of its disk's radius and the luminance of its disk (\`w\`: 1 where
 *  there is a light) are the sky draw's. */
struct Sun{toward:vec3f,illuminance:vec3f,cosRadius:f32,disk:vec4f,}
/** The lights of the air, the first \`count\` of \`list\`: the sun, then the second light, a moon or
 *  a second sun, only where there is one. Where there is none the marches read nothing of it. */
struct Suns{list:array<Sun,2>,count:u32,}
fn airSun(direction:vec4f,illuminance:vec4f,disk:vec4f,factor:vec3f)->Sun{
 var s:Sun;
 s.toward=direction.xyz;
 s.illuminance=illuminance.xyz*factor;
 s.cosRadius=direction.w;
 s.disk=disk;
 return s;
}
/** The lights of the air as the block holds them, in the scene's axes. */
fn airSuns()->Suns{
 let factor=atmo(${ATMOSPHERE_SLOT.scatteredFactor}u).xyz;
 var s:Suns;
 s.list[0]=airSun(atmo(${ATMOSPHERE_SLOT.sunDirection}u),atmo(${ATMOSPHERE_SLOT.sunIlluminance}u),atmo(${ATMOSPHERE_SLOT.sunDisk}u),factor);
 s.list[1]=airSun(atmo(${ATMOSPHERE_SLOT.secondDirection}u),atmo(${ATMOSPHERE_SLOT.secondIlluminance}u),atmo(${ATMOSPHERE_SLOT.secondDisk}u),factor);
 s.count=select(1u,2u,s.list[1].disk.w!=0.0);
 return s;
}
/** One light alone, \`toward\` it and its \`illuminance\`: a table that is a transfer. */
fn singleSun(toward:vec3f,illuminance:vec3f)->Suns{
 var one:Sun;
 one.toward=toward;
 one.illuminance=illuminance;
 var s:Suns;
 s.list[0]=one;
 s.count=1u;
 return s;
}
/** Where a ray from \`origin\` meets the sphere of \`radius\` at the origin: both distances, or
 *  \`(-1, -1)\` when it never does; a negative one is behind. */
fn raySphere(origin:vec3f,dir:vec3f,radius:f32)->vec2f{
 let b=2.0*dot(dir,origin);
 let c=dot(origin,origin)-radius*radius;
 let d=b*b-4.0*c;
 if(d<0.0){return vec2f(-1.0);}
 let r=sqrt(d);
 return vec2f(-b-r,-b+r)*0.5;
}
/** The nearest meeting with a sphere at \`center\`, never behind the origin of the ray; -1 for none. */
fn raySphereNearest(origin:vec3f,dir:vec3f,center:vec3f,radius:f32)->f32{
 let s=raySphere(origin-center,dir,radius);
 if(s.x<0.0&&s.y<0.0){return -1.0;}
 if(s.x<0.0){return max(0.0,s.y);}
 if(s.y<0.0){return max(0.0,s.x);}
 return max(0.0,min(s.x,s.y));
}
fn rayleighPhase(cosTheta:f32)->f32{return 3.0/(16.0*PI)*(1.0+cosTheta*cosTheta);}
/** What the air holds at a point: what it scatters, what it takes out of a ray, and the share of
 *  each that is the haze's and the air's. */
struct Medium{scattering:vec3f,extinction:vec3f,mieScattering:vec3f,rayScattering:vec3f,}
fn mediumAt(p:vec3f)->Medium{
 let h=max(0.0,length(p)-bottomRadius());
 let mie=exp(atmo(${ATMOSPHERE_SLOT.mieScattering}u).w*h);
 let ray=exp(atmo(${ATMOSPHERE_SLOT.rayleigh}u).w*h);
 let lines=atmo(${ATMOSPHERE_SLOT.ozoneLines}u);
 let ozone=select(saturate(lines.z*h+lines.w),saturate(lines.x*h+lines.y),h<atmo(${ATMOSPHERE_SLOT.ozone}u).w);
 var m:Medium;
 m.mieScattering=mie*atmo(${ATMOSPHERE_SLOT.mieScattering}u).xyz;
 m.rayScattering=ray*atmo(${ATMOSPHERE_SLOT.rayleigh}u).xyz;
 m.scattering=m.mieScattering+m.rayScattering;
 m.extinction=mie*atmo(${ATMOSPHERE_SLOT.mieExtinction}u).xyz+m.rayScattering+ozone*atmo(${ATMOSPHERE_SLOT.ozone}u).xyz;
 return m;
}
/** The transmittance table's address for a point at \`height\` from the planet's centre and a
 *  direction that makes \`cosZenith\` with the up there: the table holds the transmittance to the top
 *  of the air, parameterised by the distance to it between the nearest and the farthest it can be. */
fn transmittanceUv(height:f32,cosZenith:f32)->vec2f{
 let bottom=bottomRadius();let top=topRadius();
 let reach=sqrt(max(0.0,top*top-bottom*bottom));
 let rho=sqrt(max(0.0,height*height-bottom*bottom));
 let disc=height*height*(cosZenith*cosZenith-1.0)+top*top;
 let d=max(0.0,-height*cosZenith+sqrt(max(disc,0.0)));
 let dMin=top-height;
 let dMax=rho+reach;
 return vec2f((d-dMin)/(dMax-dMin),rho/reach);
}
/** The point and direction a transmittance table texel stands for: its height and zenith cosine. */
fn transmittanceParams(uv:vec2f)->vec2f{
 let bottom=bottomRadius();let top=topRadius();
 let reach=sqrt(max(0.0,top*top-bottom*bottom));
 let rho=reach*uv.y;
 let height=sqrt(rho*rho+bottom*bottom);
 let dMin=top-height;
 let dMax=rho+reach;
 let d=dMin+uv.x*(dMax-dMin);
 let cosine=select((reach*reach-rho*rho-d*d)/(2.0*height*d),1.0,d==0.0);
 return vec2f(height,clamp(cosine,-1.0,1.0));
}
/** The transmittance from the point \`p\` to the top of the air along \`dir\`. */
fn transmittanceToward(p:vec3f,dir:vec3f)->vec3f{
 let height=length(p);
 return transmittanceAt(transmittanceUv(height,dot(dir,p/height)));
}
/** The light scattered more than once, in the air at \`p\`, for a sun whose cosine with the up is
 *  \`cosZenith\`: the table is addressed by that cosine and the height. */
fn multiScatter(p:vec3f,cosZenith:f32)->vec3f{
 let uv=saturate(vec2f(cosZenith*0.5+0.5,(length(p)-bottomRadius())/(topRadius()-bottomRadius())));
 return multiScatterAt(uv);
}
/** A table coordinate in the unit square to the texel centres' span, and back: the tables are
 *  sampled by their texels, never past their ends. */
fn unitToSub(uv:vec2f,size:vec2f)->vec2f{return (uv+0.5/size)*(size/(size+1.0));}
fn subToUnit(uv:vec2f,size:vec2f)->vec2f{return (uv-0.5/size)*(size/(size-1.0));}
/** A ray that starts above the air moved onto its top, a metre in; \`w\` 0 when it never enters. */
fn moveToTopAtmosphere(pos:vec3f,dir:vec3f)->vec4f{
 let height=length(pos);
 if(height>topRadius()){
  let hit=raySphereNearest(pos,dir,vec3f(0.0),topRadius());
  if(hit>=0.0){return vec4f(pos+dir*hit-pos/height*PLANET_OFFSET,1.0);}
  return vec4f(pos,0.0);
 }
 return vec4f(pos,1.0);
}
`,
)
