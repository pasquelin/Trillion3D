import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  ATMOSPHERE_SLOT,
  ATMOSPHERE_SLOTS,
} from '../../../../sdk-core/src/scene/core/atmospherePack.ts'

/** The bits of the traced atmosphere's flags (`ptAtmo.options.x`): the air is traced, its transmittance is read from the optical depth table, the camera's rays see the planet's ground, the lamps and rectangles light a volume by a point drawn on the ray's stretch of it (`pathTracingVolumeMISMode` 1). */
export const PT_AIR_FLAG = { enabled: 1, analytic: 2, ground: 4, volumeLights: 8 } as const

/** The bindings the traced atmosphere takes in the trace and the finish programs' first group (`traceProgram.ts`): its block, the optical depth table. */
export const PT_AIR_BINDINGS = { atmosphere: 14, depth: 15 } as const

/** The bytes of `PtAtmo`: the atmosphere's block (`ATMOSPHERE_SLOTS` vec4) and the four words of the options. */
export const PT_AIR_BYTES = (ATMOSPHERE_SLOTS + 1) * 16

/** The format of the optical depth table: the integrated density of the three channels, in floats. */
export const PT_AIR_DEPTH_FORMAT = 'rgba32float' as const

/** What the traced atmosphere's programs bind: the atmosphere's block with the options after it (`x` the flags, `y` the most steps a ray takes in a volume, `z` the table's side), and the optical depth table. */
export const PT_AIR_STRUCT = `struct PtAtmo{block:array<vec4f,${ATMOSPHERE_SLOTS}>,options:vec4u,}`

const S = ATMOSPHERE_SLOT

/**
 * THE TRACED ATMOSPHERE'S MEDIUM (`ptAtmo`, the atmosphere's block the raster reads the air by, in kilometres), as the paths and the table of the optical depth read it. The planet is a sphere whose
 * top is the point of the ground plane the block names; a point's altitude is read from its place in the tangent plane there (`ptAirAltitude`, with no subtraction of two large lengths), a ray's
 * place in the planet's frame is its distance from the centre `h` and the cosine `c` its direction makes with the up there.
 *
 * - `ptAirMediumAt(altitude)` is what the air holds at an altitude per kilometre: the extinction (haze, Rayleigh scattering and ozone) and the scattering of the Rayleigh and of the haze;
 * - `ptAirAt(h, c, t)` is the distance from the centre and the cosine at the distance `t` kilometres along the ray;
 * - `ptAirLutUv(h, c)` is where the optical depth table holds a ray (more resolution toward the ground and about the horizon), `ptAirLutFromUv(uv)` the ray a texel stands for.
 */
export const PT_AIR_MEDIUM_WGSL = wgslBlock(
  'PT_AIR_MEDIUM_WGSL',
  [],
  `fn ptAirBottom()->f32{return ptAtmo.block[${S.planet}].y;}
fn ptAirTop()->f32{return ptAtmo.block[${S.planet}].z;}
fn ptAirAltitude(q:vec3f)->f32{
 let r=ptAirBottom();
 let s=dot(q,q)+2.0*r*q.y;
 return s/(r+sqrt(max(r*r+s,0.0)));
}
struct PtAirMedium{extinction:vec3f,rayleigh:vec3f,mie:vec3f,}
fn ptAirMediumAt(altitude:f32)->PtAirMedium{
 let a=max(altitude,0.0);
 let lines=ptAtmo.block[${S.ozoneLines}];
 let mie=exp(ptAtmo.block[${S.mieScattering}].w*a);
 let ray=exp(ptAtmo.block[${S.rayleigh}].w*a);
 let ozone=select(saturate(lines.z*a+lines.w),saturate(lines.x*a+lines.y),a<ptAtmo.block[${S.ozone}].w);
 var m:PtAirMedium;
 m.mie=mie*ptAtmo.block[${S.mieScattering}].xyz;
 m.rayleigh=ray*ptAtmo.block[${S.rayleigh}].xyz;
 m.extinction=mie*ptAtmo.block[${S.mieExtinction}].xyz+m.rayleigh+ozone*ptAtmo.block[${S.ozone}].xyz;
 return m;
}
fn ptAirAt(h:f32,c:f32,t:f32)->vec2f{
 let over=t/h;
 let relative=sqrt(max((2.0*c+over)*over+1.0,0.0));
 return vec2f(h*relative,(over+c)/relative);
}
fn ptAirHorizon(h:f32)->f32{
 let q=ptAirBottom()/h;
 return -sqrt(saturate(1.0-q*q));
}
fn ptAirGain(x:f32,k:f32)->f32{
 let a=1.0-2.0*x;
 return 0.5-0.5*sign(a)*pow(abs(a),k);
}
fn ptAirLutUv(h:f32,c:f32)->vec2f{
 let horizon=ptAirHorizon(h);
 let q=0.5;
 let ab=select(vec2f((1.0+horizon)/q,-1.0),vec2f((horizon-1.0)/(q-1.0),(q-horizon)/(q-1.0)),c>=horizon);
 let u=(c-ab.y)/ab.x;
 return vec2f(ptAirGain(u,0.5),sqrt(saturate((h-ptAirBottom())/(ptAirTop()-ptAirBottom()))));
}
fn ptAirLutFromUv(uv:vec2f)->vec2f{
 let h=mix(ptAirBottom(),ptAirTop(),uv.y*uv.y);
 let horizon=ptAirHorizon(h);
 let u=ptAirGain(uv.x,2.0);
 let q=0.5;
 let ab=select(vec2f((1.0+horizon)/q,-1.0),vec2f((horizon-1.0)/(q-1.0),(q-horizon)/(q-1.0)),u>q);
 return vec2f(h,ab.x*u+ab.y);
}`,
)
