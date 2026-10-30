import { INVERSE_PI } from '../../../../math/src/wgsl/constants.ts'
import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import {
  BLEND_OBJECT_SHADOW_BINDINGS as B,
  OBJECT_SHADOW_HEADER_ROWS,
  OBJECT_SHADOW_PACKED_LAYER_ROWS,
  OBJECT_SHADOW_PACKED_WIDTH,
  foldsProfiles,
  readsAtlasTexture,
  type ObjectShadowAtlasRead,
} from '../../gpu/core/objectShadowRead.ts'
import { AIR_TINT_WGSL } from '../../lighting/atmosphere/airTintWgsl.ts'
import { OBJECT_SHADOW_SERIES_WGSL } from '../../lighting/shadows/perObject/objectShadowProjectWgsl.ts'
import { BLEND_LIGHT_STRENGTH_WGSL } from '../viewLayout.ts'
import { INSTANCE_ITEM_MASK } from '../runs.ts'
import { allocateExtras, extraRead, extraWrite } from '../vertexExtras.ts'
import { programAsks } from '../water/waterBodyLane.ts'
import type { CloudVertexText, VertexReads } from '../cloudVertexText.ts'

/**
 * THE TRANSLUCENT SURFACES' OWN SHADOW IN THE BLEND PROGRAMS (the self shadow of a surface lit from the translucency lighting volume): a fragment of an
 * item whose object casts a translucent shadow from a sun reads that shadow's coefficients at its own place, rebuilds the density the object's
 * layers add between the sun and the point, and takes from the volume's light what the volume holds of the sun where that density shadows it,
 * adding the light that scatters back toward a viewer who looks at the sun through a subsurface surface. The volume's light is the sun's (the alpha
 * of its ambient light sums the share of each sun that reached the cell) among the other lights', so the correction removes the sun's part only.
 *
 * Which record a fragment reads is found per item: the vertex stage reads the item's rank off the instance (it reads the item already), looks it up in
 * the packed table (`packed`, one word an item: the record's first texel plus one, 0 for an item that casts nothing from a sun) and hands it over as one lane of the
 * extras of its output (`vertexExtras.ts`): no location more. A record is one (subject, material) pair: the subject's light frame, the rectangle its
 * coefficients lie in, the sun's direction and fade, and the material's self shadow scales (`MATERIAL_TRANSLUCENT_SHADOW_RULES`). The records are
 * texels of the packed table (the words of a float are its bits), as many as the frame needs. The coefficients
 * are read from the atlas texture (a layer pair of one 2D array), or, on a device that cannot spare the second sampled texture, from the copy of the
 * subject's rectangle in the packed table (a texel holds two half-float texels of one layer) filtered by hand: the same texels, the same bilinear weights.
 */

/** The packed table, both stages read by load: the item table, the records and, in the packed read, the atlas rectangles; in the folded read the header row comes first and the profiles' bytes (and the sorted depth) follow the item table. */
const packedDecl = (folded: boolean) =>
  wgslBlock(
    folded ? 'SELF_SHADOW_PACKED_FOLDED_WGSL' : 'SELF_SHADOW_PACKED_WGSL',
    [],
    `@group(0) @binding(${B.packed}) var selfPacked:texture_2d_array<u32>;
fn selfPackedAt(x:u32,row:u32)->vec4u{return textureLoad(selfPacked,vec2u(x,row%${OBJECT_SHADOW_PACKED_LAYER_ROWS}u),row/${OBJECT_SHADOW_PACKED_LAYER_ROWS}u,0);}
fn selfPackedTexel(i:u32)->vec4u{return selfPackedAt(i%${OBJECT_SHADOW_PACKED_WIDTH}u,i/${OBJECT_SHADOW_PACKED_WIDTH}u${folded ? `+${OBJECT_SHADOW_HEADER_ROWS}u` : ''});}`,
  )
const PACKED_DECL = packedDecl(false),
  FOLDED_DECL = packedDecl(true)

/**
 * The light profiles read from the packed table (the folded read, `objectShadowAtlasRead`): the header texel (the row the bytes start at, the side, the half floats a row spans, the profiles held) then the
 * atlas copied byte for byte (a half float a texel of the atlas, a row after the other, slice after slice), the value of `at` filtered bilinear with the edge held as the sampler
 * the atlas is otherwise read through does. A slice the table does not hold reads 1, a light unchanged.
 */
export const PROFILE_FOLDED_WGSL = wgslBlock(
  'SELF_SHADOW_PROFILE_FOLDED_WGSL',
  [FOLDED_DECL],
  `fn profileTexel(head:vec4u,slice:u32,at:vec2i)->f32{
 let index=(slice*head.y+u32(at.y))*head.z+u32(at.x);
 let texel=index>>3u;
 let e=selfPackedAt(texel%${OBJECT_SHADOW_PACKED_WIDTH}u,head.x+texel/${OBJECT_SHADOW_PACKED_WIDTH}u);
 let pair=unpack2x16float(e[(index>>1u)&3u]);
 return select(pair.x,pair.y,(index&1u)==1u);
}
fn lightProfileFolded(at:vec2f,slice:i32)->f32{
 let head=selfPackedAt(0u,0u);
 if(u32(slice)>=head.w){return 1.0;}
 let last=vec2i(i32(head.y)-1);
 let p=at*f32(head.y)-vec2f(0.5);
 let low=vec2i(floor(p));
 let f=fract(p);
 let a=clamp(low,vec2i(0),last);
 let b=clamp(low+vec2i(1),vec2i(0),last);
 let s=u32(slice);
 let top=mix(profileTexel(head,s,a),profileTexel(head,s,vec2i(b.x,a.y)),f.x);
 let bottom=mix(profileTexel(head,s,vec2i(a.x,b.y)),profileTexel(head,s,b),f.x);
 return mix(top,bottom,f.y);
}`,
)

/**
 * The depth the sorted translucency's fragments are tested against (`oitSceneDepth`, the function `OIT_DEPTH_TEXTURE_WGSL` defines from a texture), read from the packed table (the
 * `'foldedDepth'` read): the header's second texel names the row the depth starts at and its width; the depth lies row after row, a texel holding four values. 0 (the farthest) where none is held.
 */
export const OIT_DEPTH_FOLDED_WGSL = wgslBlock(
  'OIT_DEPTH_FOLDED_WGSL',
  [FOLDED_DECL],
  `fn oitSceneDepth(pixel:vec2u)->f32{
 let head=selfPackedAt(1u,0u);
 if(head.x==0u){return 0.0;}
 let index=pixel.y*head.y+pixel.x;
 let texel=index>>2u;
 let e=selfPackedAt(texel%${OBJECT_SHADOW_PACKED_WIDTH}u,head.x+texel/${OBJECT_SHADOW_PACKED_WIDTH}u);
 return bitcast<f32>(e[index&3u]);
}`,
)

/** The record of a subject and a material, read from the texels of the packed table that hold it (`OBJECT_SHADOW_RECORD_WORDS` words). */
const recordStruct = (folded: boolean) =>
  wgslBlock(
    folded ? 'SELF_SHADOW_RECORD_FOLDED_WGSL' : 'SELF_SHADOW_RECORD_WGSL',
    [folded ? FOLDED_DECL : PACKED_DECL],
    `struct SelfShadow{
 clip:mat4x4f,
 tile:vec4f,
 interior:vec4f,
 depth:vec4f,
 light:vec4f,
 scales:vec4f,
 extinction:vec4f,
 place:vec4u,
 copy:vec4u,
}
fn selfRecordAt(first:u32)->SelfShadow{
 var r:SelfShadow;
 r.clip=mat4x4f(bitcast<vec4f>(selfPackedTexel(first)),bitcast<vec4f>(selfPackedTexel(first+1u)),bitcast<vec4f>(selfPackedTexel(first+2u)),bitcast<vec4f>(selfPackedTexel(first+3u)));
 r.tile=bitcast<vec4f>(selfPackedTexel(first+4u));
 r.interior=bitcast<vec4f>(selfPackedTexel(first+5u));
 r.depth=bitcast<vec4f>(selfPackedTexel(first+6u));
 r.light=bitcast<vec4f>(selfPackedTexel(first+7u));
 r.scales=bitcast<vec4f>(selfPackedTexel(first+8u));
 r.extinction=bitcast<vec4f>(selfPackedTexel(first+9u));
 r.place=selfPackedTexel(first+10u);
 r.copy=selfPackedTexel(first+11u);
 return r;
}`,
  )

/** The two coefficient texels of a record's rectangle at `uv`, filtered bilinear, read from the atlas texture. */
const textureRead = (sampler: string) =>
  wgslBlock(
    `SELF_SHADOW_ATLAS_TEXTURE_WGSL(${sampler})`,
    [],
    `@group(0) @binding(${B.atlas}) var selfAtlas:texture_2d_array<f32>;
fn selfCoefficients(r:SelfShadow,uv:vec2f)->array<vec4f,2>{
 let layer=i32(r.place.x);
 return array<vec4f,2>(textureSampleLevel(selfAtlas,${sampler},uv,layer,0.0),textureSampleLevel(selfAtlas,${sampler},uv,layer+1,0.0));
}`,
  )

/** The same texels read from the rectangle's copy in the packed table (a texel is two half-float texels of one layer, the two layers one above the other from the record's row and starting at its texel across, a block of the rectangle's columns after the other), filtered by hand with the edge held. */
const PACKED_READ = wgslBlock(
  'SELF_SHADOW_ATLAS_PACKED_WGSL',
  [],
  `fn selfTexel(r:SelfShadow,plane:u32,at:vec2i)->vec4f{
 let x=u32(at.x);
 let block=x/${2 * OBJECT_SHADOW_PACKED_WIDTH}u;
 let e=selfPackedAt((x/2u)%${OBJECT_SHADOW_PACKED_WIDTH}u+r.copy.y,r.copy.x+(block*2u+plane)*r.copy.w+u32(at.y));
 if((x&1u)==0u){return vec4f(unpack2x16float(e.x),unpack2x16float(e.y));}
 return vec4f(unpack2x16float(e.z),unpack2x16float(e.w));
}
fn selfPlane(r:SelfShadow,uv:vec2f,plane:u32)->vec4f{
 let p=uv*r.extinction.w-vec2f(0.5)-vec2f(r.place.zw);
 let size=vec2i(r.copy.zw)-vec2i(1);
 let low=vec2i(floor(p));
 let f=fract(p);
 let a=clamp(low,vec2i(0),size);
 let b=clamp(low+vec2i(1),vec2i(0),size);
 let top=mix(selfTexel(r,plane,a),selfTexel(r,plane,vec2i(b.x,a.y)),f.x);
 let bottom=mix(selfTexel(r,plane,vec2i(a.x,b.y)),selfTexel(r,plane,b),f.x);
 return mix(top,bottom,f.y);
}
fn selfCoefficients(r:SelfShadow,uv:vec2f)->array<vec4f,2>{return array<vec4f,2>(selfPlane(r,uv,0u),selfPlane(r,uv,1u));}`,
)

/**
 * The shadow a record gives a point, and the sun's light. `selfShadowFactor` is the transmission the object's layers leave at world point `P` (metres): one
 * where the point lies outside the rectangle the coefficients were drawn in, else the first gradient times the second (the second density
 * scale, weighted by the second opacity), from the density over the material's extinction. `selfShadowSun` is the colour of the sun the record was
 * made for (the record names its place in the lights buffer) over pi, times its strength, the air's transmittance toward it at the point and the
 * subject's fade: black where the light is gone from the list.
 */
const readText = (read: ObjectShadowAtlasRead, sampler: string) =>
  wgslBlock(
    `objectShadowSelfWgsl(${read}${readsAtlasTexture(read) ? `, ${sampler}` : ''})`,
    [
      recordStruct(foldsProfiles(read)),
      OBJECT_SHADOW_SERIES_WGSL,
      INVERSE_PI,
      AIR_TINT_WGSL,
      BLEND_LIGHT_STRENGTH_WGSL,
      readsAtlasTexture(read) ? textureRead(sampler) : PACKED_READ,
    ],
    `fn selfShadowFactor(r:SelfShadow,P:vec3f)->vec3f{
 let c=r.clip*vec4f(P,1.0);
 if(c.w<=0.0){return vec3f(1.0);}
 let ndc=c.xy/c.w;
 let uv=vec2f(ndc.x*r.tile.x+r.tile.z,-ndc.y*r.tile.y+r.tile.w);
 if(any(uv<r.interior.xy)||any(uv>r.interior.zw)){return vec3f(1.0);}
 let texels=selfCoefficients(r,uv);
 let density=vec3f(objectShadowSeries(texels[0],texels[1],1.0-c.z*r.depth.x))/r.extinction.xyz;
 let first=saturate(exp(-density*r.scales.x));
 let second=mix(vec3f(1.0),saturate(exp(-density*r.scales.y)),r.scales.z);
 return first*second;
}
fn selfShadowSun(r:SelfShadow,P:vec3f)->vec3f{
 let k=r.place.y;
 if(k>=directLights.count){return vec3f(0.0);}
 let light=directLights.items[k];
 if(!isSun(light)){return vec3f(0.0);}
 return light.colorIntensity.rgb*(lightStrength(light)*INVERSE_PI*r.light.w)*airTintOf(k,light,P);
}`,
  )

/** What a program that reads its object's shadow adds to its vertex stage and its fragments. */
interface SelfShadowText {
  /** The vertex stage's words (`CloudVertexText`) with the record's lane added. */
  readonly shade: CloudVertexText
  /** The fragment side: the record, the filter, the sun, and `selfShadowRecordOf`, the record plus one a fragment's item names (0 for none). */
  readonly fragment: WgslDecl
}

/**
 * The words of a program that reads its object's shadow: `shade` (`cloudVertexText`, of `reads`) with the vertex stage's lookup of the item's record
 * in the extras, and the fragment block reading it. The lane is allocated after the fog's and the clouds' (`allocateExtras`, the order `buildText`
 * asks them in), so their places stay as they were.
 */
export function selfShadowText(
  base: CloudVertexText,
  reads: VertexReads,
  read: ObjectShadowAtlasRead,
  sampler: string,
): SelfShadowText {
  const extras = allocateExtras(programAsks(reads, true, false))
  const place = extras.places.selfShadow!
  return {
    shade: {
      ...base,
      key: `${base.key}, selfShadow`,
      declared: [...base.declared, foldsProfiles(read) ? FOLDED_DECL : PACKED_DECL],
      extras: extras.members,
      vertexLanes: `${base.vertexLanes}let selfItem=slot.x&${INSTANCE_ITEM_MASK}u;
 let selfWords=selfPackedTexel(selfItem>>2u);
 ${extraWrite(place, 'f32(selfWords[selfItem&3u])')}
 `,
    },
    fragment: wgslBlock(
      `selfShadowFragment(${read}, ${extraRead(place)})`,
      [readText(read, sampler)],
      `fn selfShadowRecordOf(in:VSOut)->u32{return u32(round(${extraRead(place)}));}`,
    ),
  }
}
