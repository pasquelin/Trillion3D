import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * THE AIR'S GEOMETRY, PURE: rays against the planet's spheres and the address of a point in the
 * transmittance table, from the radii they are given and nothing the air's block holds — so that
 * the air's programs (`opticsWgsl.ts`) and the programs that light the surfaces through the air
 * (`airTintWgsl.ts`) share one formula. The planet is a sphere at the origin, lengths in kilometres.
 */
export const AIR_GEOMETRY_WGSL = wgslBlock(
  'AIR_GEOMETRY_WGSL',
  [],
  `
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
/** The transmittance table's address for a point at \`height\` from the planet's centre and a
 *  direction that makes \`cosZenith\` with the up there, the planet's radius \`bottom\` and the
 *  air's top \`top\`: the table holds the transmittance to the top of the air, parameterised by the
 *  distance to it between the nearest and the farthest it can be. */
fn transmittanceAddress(height:f32,cosZenith:f32,bottom:f32,top:f32)->vec2f{
 let reach=sqrt(max(0.0,top*top-bottom*bottom));
 let rho=sqrt(max(0.0,height*height-bottom*bottom));
 let disc=height*height*(cosZenith*cosZenith-1.0)+top*top;
 let d=max(0.0,-height*cosZenith+sqrt(max(disc,0.0)));
 let dMin=top-height;
 let dMax=rho+reach;
 return vec2f((d-dMin)/(dMax-dMin),rho/reach);
}
/** A table coordinate in the unit square to the texel centres' span, and back: the tables are
 *  sampled by their texels, never past their ends. */
fn unitToSub(uv:vec2f,size:vec2f)->vec2f{return (uv+0.5/size)*(size/(size+1.0));}
fn subToUnit(uv:vec2f,size:vec2f)->vec2f{return (uv-0.5/size)*(size/(size-1.0));}`,
)
