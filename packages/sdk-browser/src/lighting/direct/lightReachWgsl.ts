import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { LIGHTING_CHANNELS_WGSL } from '../lightingChannelsWgsl.ts'
import {
  LIGHT_CHANNELS_SHIFT,
  LIGHT_KIND_SPAN,
  LIGHT_PAYLOAD_MASK,
  LIGHT_SHADOWED,
  LIGHT_SHADOWED_MASK,
  LIGHT_SHADOWED_SHIFT,
  LIGHT_UNDRAWN_SHIFT,
} from '../../../../sdk-core/src/scene/light/contracts.ts'

/**
 * Whether a local light may light a point at `offset` from it (its centre minus the point): the one
 * test of where a light gives energy — the first statement of the one light term
 * (`declaredLight`, `declaredIrradiance`, through `lightReaches`) and the shadow passes' test at
 * their own points. Zero past its `range` — a point at the range itself is reached, the light's energy
 * there already none (`rangeWindow`) —, at or outside a spot's cone of
 * cosine `cosEdge` around `forward` (its fade), and behind a rectangle's (`rect`) plane, `forward`
 * the direction it emits along: a point in the plane itself is in front. No divide: the range on
 * the squared distance — the sphere test, a dot and a compare —, the cone against the distance
 * scaled by its cosine, tested only for a light that has one: `cosEdge` is −2 for any other, which
 * no cosine reaches. A point no comparison orders (NaN) is reached, left to the lighting.
 */
export const localLightReaches = wgslFn(
  'localLightReaches',
  [],
  `fn localLightReaches(offset:vec3f,range:f32,cosEdge:f32,forward:vec3f,rect:bool)->bool{
 let lengthSquared=dot(offset,offset);
 if(lengthSquared>range*range){return false;}
 if(rect){return !(dot(offset,forward)>0.0);}
 if(cosEdge<-1.0){return true;}
 return !(dot(-offset,forward)<=cosEdge*sqrt(lengthSquared));
}`,
)

/** The range window at `distance` from a light's centre: one at the centre, zero at its range. */
export const rangeWindow = wgslFn(
  'rangeWindow',
  [],
  `fn rangeWindow(distance:f32,range:f32)->f32{
 let ratio=distance/range;
 return pow(clamp(1.0-ratio*ratio*ratio*ratio,0.0,1.0),2.0);
}`,
)

/** The window of a lamp that does not fall off as the inverse square, at `distance` from its centre:
 *  one at the centre, zero at its range, the square of the distance over the square of the range
 *  taken from one and raised to `exponent` (`SceneLight.radialExponent`). */
export const radialWindow = wgslFn(
  'radialWindow',
  [],
  `fn radialWindow(distance:f32,range:f32,exponent:f32)->f32{
 let ratio=distance/range;
 return pow(1.0-saturate(ratio*ratio),exponent);
}`,
)

/** The constants of a light's kind word (`LIGHT_FIELD.kind`): what the readers keep of it (the marker is not theirs, `LIGHT_KIND_MARKER`), the
 *  span of its rank, and the bit the view sets where it leaves the light out (`LIGHT_UNDRAWN_SHIFT`). */
const KIND_WORD_CONSTS = wgslBlock(
  'KIND_WORD_CONSTS',
  [],
  wgslConsts({
    KIND_PAYLOAD_MASK: LIGHT_PAYLOAD_MASK,
    KIND_SPAN: LIGHT_KIND_SPAN,
    KIND_UNDRAWN: 2 ** LIGHT_UNDRAWN_SHIFT,
  }),
)

/** A light's kind word (`LIGHT_FIELD.kind`) holds a whole number in the bits of its float, read by `bitcast<u32>`: this accessor is the only
 *  place that reads it, and every reader below takes the light and answers in `u32`. Its parts each above the one before
 *  (`scene/light/contracts.ts`, with the bit budget): its rank, under `LIGHT_KIND_SPAN`; the flags (`LIGHT_FLAG`); the lighting channels stored
 *  (`LIGHT_CHANNELS_SHIFT`); the shadowed value (`LIGHT_SHADOWED_SHIFT`); the profile lane (`LIGHT_PROFILE_SHIFT`); the undrawn bit
 *  (`LIGHT_UNDRAWN_SHIFT`); its light function's index (`LIGHT_FUNCTION_SHIFT`, `lightFunction/readWgsl.ts`). The constant marker bit above
 *  them (`LIGHT_KIND_MARKER`) is masked off. */
export const kindWord = wgslFn(
  'kindWord',
  [KIND_WORD_CONSTS],
  'fn kindWord(light:DirectLight)->u32{return bitcast<u32>(light.params.x)&KIND_PAYLOAD_MASK;}',
)

/** The rank of a light's kind alone (`LIGHT_KIND`). */
const lightKindOf = wgslFn(
  'lightKindOf',
  [kindWord],
  'fn lightKindOf(light:DirectLight)->u32{return kindWord(light)%KIND_SPAN;}',
)

/** Whether a flag bit (`LIGHT_FLAG`) is set in a light's kind word. */
export const lightFlagged = wgslFn(
  'lightFlagged',
  [kindWord],
  'fn lightFlagged(light:DirectLight,flag:u32)->bool{return (kindWord(light)&flag)!=0u;}',
)

/** Whether the view leaves a light out (`lightDrawn`, `lighting/lightDrawRange.ts`): the bit its kind word carries, set by the CPU once a
 *  view for every light. A word written anew says drawn, and a sun is never left out. */
export const lightUndrawn = wgslFn(
  'lightUndrawn',
  [kindWord],
  'fn lightUndrawn(light:DirectLight)->bool{return (kindWord(light)&KIND_UNDRAWN)!=0u;}',
)

/** The mask of the lighting channels a light is in, read from the stored bits of its kind word (`storedToChannels` decodes them). */
export const lightChannelsOf = wgslFn(
  'lightChannelsOf',
  [LIGHTING_CHANNELS_WGSL, kindWord],
  `fn lightChannelsOf(light:DirectLight)->u32{return storedToChannels(kindWord(light)>>${LIGHT_CHANNELS_SHIFT}u);}`,
)

/** The values of a light's shadowed value, the shift and the mask that read it from the kind word (`LIGHT_SHADOWED`, `LIGHT_SHADOWED_BITS`
 *  bits), the word's layout owned by the same file as `lightFlagged` and `lightKindOf`. */
export const LIGHT_SHADOWED_WGSL = wgslBlock(
  'LIGHT_SHADOWED_WGSL',
  [],
  wgslConsts({
    SHADOWED_SHIFT: LIGHT_SHADOWED_SHIFT,
    SHADOWED_MASK: LIGHT_SHADOWED_MASK,
    SHADOWED_NONE: LIGHT_SHADOWED.none,
    SHADOWED_DYNAMIC: LIGHT_SHADOWED.dynamic,
  }),
)

/** A light's shadow bits, read from its kind word: `SHADOWED_DYNAMIC` where it casts a dynamic shadow, the static value where it
 *  casts a static one or wears a light function with no slot, else `SHADOWED_NONE` (`shadowedBitsOf`). */
export const shadowBitsOf = wgslFn(
  'shadowBitsOf',
  [LIGHT_SHADOWED_WGSL, kindWord],
  'fn shadowBitsOf(light:DirectLight)->u32{return (kindWord(light)>>SHADOWED_SHIFT)&SHADOWED_MASK;}',
)

/** The one place that rereads a kind word as a rank: every kind's test its call. */
export const isKind = wgslFn(
  'isKind',
  [lightKindOf],
  'fn isKind(light:DirectLight,rank:u32)->bool{return lightKindOf(light)==rank;}',
)

/** The lanes of a light's eighth `vec4f` (`DirectLight.traits`; its first lane is `LIGHT_FIELD.exposureBlend`) that a shader reads, each by its
 *  accessor: the blend of its strength with the inverse of the exposure, half the length of its tube and its source's term (a sun's disk's
 *  sine, a lamp's weight of the rough diffuse). Its draw range is the CPU's (`SceneLightStore.draw`). The emitter's unit axis (`capsule.xyz`) is
 *  the profile's frame and the tube's line: `tubeHalfAxisOf` is the tube, the axis times its half length, zero for a light of no tube whatever
 *  its axis. */
export const lightTraits = wgslBlock(
  'lightTraits',
  [],
  `fn exposureBlendOf(light:DirectLight)->f32{return light.traits.x;}
fn tubeHalfLengthOf(light:DirectLight)->f32{return light.traits.y;}
fn sourceTermOf(light:DirectLight)->f32{return light.traits.z;}
fn emitterAxisOf(light:DirectLight)->vec3f{return light.capsule.xyz;}
fn tubeHalfAxisOf(light:DirectLight)->vec3f{return light.capsule.xyz*light.traits.y;}`,
)
