import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'

/** Where a program binds the rectangle lights' atlas (a `texture_2d<f32>`) and its trilinear sampler. */
export interface RectAtlasBindings {
  readonly group: number
  readonly atlas: number
  readonly sampler: number
}

/** The rectangle atlas's bindings of a program that binds it beside the light profiles' (`LightProfileBindings`): they are set. */
export const rectBindingsOf = (b: {
  readonly group: number
  readonly rectAtlas?: number
  readonly rectSampler?: number
}): RectAtlasBindings => ({ group: b.group, atlas: b.rectAtlas!, sampler: b.rectSampler! })

/** The bindings as a block name reads them. */
export const rectAtlasBindingsLabel = (b: RectAtlasBindings) =>
  `${b.group}, ${b.atlas}, ${b.sampler}`

/**
 * Where a ray meets a rectangle's face: the ray along \`L0\` from the point (unit here, then bent to point at the plane if it leaves it or grazes
 * it) is put on the plane of the face with corners \`a\`, \`b\` (across) and \`d\` (down) relative to the point. \`uv\` is the hit's place in
 * the picture, across and down from its top left corner \`a\`, \`distance\` the distance along the ray to the plane and \`reach\` the square root
 * of the face's half sides' product, the length that sizes the mip level. A face with no area gives a hit at the centre of no reach.
 */
export const RECT_PICTURE_HIT_WGSL = wgslBlock(
  'RECT_PICTURE_HIT_WGSL',
  [],
  `struct PictureHit{uv:vec2f,distance:f32,reach:f32,}
fn rectPictureHit(a:vec3f,b:vec3f,d:vec3f,L0:vec3f)->PictureHit{
 let across=b-a;let down=d-a;
 let plane=cross(across,down);let area2=dot(plane,plane);
 if(!(area2>0.0)){return PictureHit(vec2f(0.5),0.0,0.0);}
 let axis=plane*inverseSqrt(area2);
 var L=normalize(L0);
 L+=axis*saturate(0.001-dot(axis,L));
 let along=dot(axis,a+0.5*(across+down))/dot(axis,L);
 let hit=L*along-a;
 return PictureHit(saturate(vec2f(dot(cross(hit,down),plane),dot(cross(across,hit),plane))/area2),along,sqrt(0.25*sqrt(area2)));
}`,
)

/**
 * THE READ OF A RECTANGLE'S PICTURE, once for every lighting path (\`rectSourceAt\`, which replaces the white default of
 * \`../direct/rectLightWgsl.ts\` in a program that lists it): where the ray along \`L0\` meets the face (\`rectPictureHit\`), the atlas is read
 * at the slot's rectangle trilinearly at the level the solid angle of the rectangle asks — the log2 of the distance to the plane over the
 * square root of the face's half sides' product, plus the log2 of the slot's short side less 2, no coarser than the slot's last level (its
 * short side's log2, less 1) and no finer than the first. The coordinate is held half a texel of that level inside the slot, so that the
 * filter does not read the slot beside it. The ray is unit before it is bent: the distance, and so the level, does not depend on how long
 * the caller's direction is.
 */
export const rectSourceWgsl = (b: RectAtlasBindings) =>
  wgslFn(
    'rectSourceAt',
    [
      RECT_PICTURE_HIT_WGSL,
      wgslBlock(
        `rectAtlasBindings(${rectAtlasBindingsLabel(b)})`,
        [],
        `@group(${b.group}) @binding(${b.atlas}) var rectAtlas:texture_2d<f32>;
@group(${b.group}) @binding(${b.sampler}) var rectAtlasSampler:sampler;`,
      ),
    ],
    `fn rectSourceAt(slot:vec4f,a:vec3f,b:vec3f,d:vec3f,L0:vec3f)->vec3f{
 if(!(slot.z>0.0)){return vec3f(1.0);}
 let hit=rectPictureHit(a,b,d,L0);
 if(!(hit.reach>0.0)){return vec3f(1.0);}
 let atlasSize=vec2f(textureDimensions(rectAtlas));
 let shortSide=min(slot.z,slot.w);
 let last=f32(max(i32(firstLeadingBit(u32(shortSide)))-1,0));
 let level=max(min(log2(hit.distance/max(hit.reach,0.01))+log2(shortSide)-2.0,last),0.0);
 let scale=slot.zw/atlasSize;let offset=slot.xy/atlasSize;
 let border=0.5/max(vec2f(vec2u(atlasSize)>>vec2u(u32(ceil(level)))),vec2f(1.0));
 let at=clamp(hit.uv*scale+offset,offset+border,offset+scale-border);
 return textureSampleLevel(rectAtlas,rectAtlasSampler,at,level).rgb;
}`,
  )
