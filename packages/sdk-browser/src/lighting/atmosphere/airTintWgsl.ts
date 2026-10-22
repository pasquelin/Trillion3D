import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { AIR_GEOMETRY_WGSL } from './geometryWgsl.ts'
import { PUBLISHED_TRANSMITTANCE } from './layout.ts'
import { airProgram } from './programs.ts'
import type { AirShape } from './shape.ts'

/**
 * THE AIR'S TRANSMITTANCE TOWARD A LIGHT, FOR EACH SURFACE POINT: where a directional light of the
 * air asks for it (`SceneLight.transmittancePerPixel`) its light reaches a surface untinted — the
 * store leaves the colour of its slot as declared — and the surface programs multiply it by what
 * the air keeps of it between the point and the top of the air: `airTintOf(rank, light, P)`, one
 * for a light that does not ask, zero where the planet hides the light. The point is a scene point
 * in metres; the transmittance is read from the table's copy in the light buffer (`tint`), published
 * when the table is built (`publishProgram`), by the very address the air's programs read the
 * table by (`transmittanceAddress`), blended as a sampler would, and squared, the table holding
 * its square root.
 *
 * The block names the light buffer (`directLights`) and the light structure (`DirectLight`) as the
 * lighting programs declare them.
 */
export const AIR_TINT_WGSL = wgslBlock(
  'AIR_TINT_WGSL',
  [AIR_GEOMETRY_WGSL],
  `
const TINT_SIZE:vec2i=vec2i(${PUBLISHED_TRANSMITTANCE.width},${PUBLISHED_TRANSMITTANCE.height});
fn tintTexel(column:i32,row:i32)->vec3f{
 let at=clamp(vec2i(column,row),vec2i(0),TINT_SIZE-vec2i(1));
 let word=directLights.tint[at.y*TINT_SIZE.x+at.x];
 return vec3f(unpack2x16float(word.x),unpack2x16float(word.y).x);
}
fn tintStored(uv:vec2f)->vec3f{
 let at=uv*vec2f(TINT_SIZE)-0.5;
 let base=floor(at);
 let f=at-base;
 let c=vec2i(base);
 let low=mix(tintTexel(c.x,c.y),tintTexel(c.x+1,c.y),f.x);
 let high=mix(tintTexel(c.x,c.y+1),tintTexel(c.x+1,c.y+1),f.x);
 return mix(low,high,f.y);
}
fn airTintOf(rank:u32,light:DirectLight,P:vec3f)->vec3f{
 let flags=directLights.atmosphere[${ATMOSPHERE_SLOT.lightFlags}];
 let slots=directLights.atmosphere[${ATMOSPHERE_SLOT.lightSlots}];
 var k=2u;
 if(f32(rank)==slots.x){k=0u;}else if(f32(rank)==slots.y){k=1u;}
 if(k==2u||flags[2u+k]==0.0){return vec3f(1.0);}
 let planet=directLights.atmosphere[${ATMOSPHERE_SLOT.planet}];
 let q=vec3f(P.x*0.001,(P.y-planet.w)*0.001+planet.y,P.z*0.001);
 let toward=-light.directionCone.xyz;
 let hit=raySphere(q,toward,planet.y);
 if(hit.x>0.0||hit.y>0.0){return vec3f(0.0);}
 let height=length(q);
 let stored=tintStored(transmittanceAddress(height,dot(toward,q/height),planet.y,planet.z));
 return stored*stored;
}`,
)

/** The table's copy for the surface programs, one thread a texel of the published grid: the table
 *  sampled at the texel's centre, as the table stores it, packed in half floats into the light
 *  buffer's `tint`. Run when the table is built; a table the shape makes none of publishes ones. */
export const publishProgram = (shape: AirShape) =>
  airProgram(
    { air: 'read_write', transmittance: true },
    `
@compute @workgroup_size(8,8,1)
fn publishMain(@builtin(global_invocation_id) id:vec3u){
 let size=vec2u(${PUBLISHED_TRANSMITTANCE.width}u,${PUBLISHED_TRANSMITTANCE.height}u);
 if(id.x>=size.x||id.y>=size.y){return;}
 let t=transmittanceStored((vec2f(id.xy)+0.5)/vec2f(size));
 directLights.tint[id.y*size.x+id.x]=vec2u(pack2x16float(t.xy),pack2x16float(vec2f(t.z,0.0)));
}`,
    [],
    shape,
  )
