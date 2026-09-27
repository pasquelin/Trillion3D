// The shadow pool's page reads, shared by every pass that lights a surface (`shadowWgsl.ts`):
// where a page lies, and the hardware comparison in it, exact wherever the pool puts it (#831).

/** Steps a texel of the comparison filter's weights: their 8 bits, the subtexel precision of
 *  Direct3D and Metal, rounded to nearest (measured on Apple M2, #831). `shadowCompare` reads at
 *  their centres, where a normalised coordinate's rounding never changes the step; centres of a
 *  truncating filter's steps, half a step off, changed 20–30 % of the samples between pool sides. */
export const SHADOW_SUBTEXELS = 256;

/** The page reads. Requires `shadowAtlas`, `shadowSampler`, `SHADOW_PAGE`, `SHADOW_SUBTEXELS` and
 *  `PAGE_INDEX_MASK`. */
export const SHADOW_SAMPLE_WGSL = `/** Place of page \`p\`, held by physical page \`word\`: \`xy\` added to a texel coordinate of the
 *  map gives that texel's place in its layer, \`z\` is the layer (\`shadowPoolShape\`). */
fn shadowOffset(word:u32,p:vec2i)->vec3f{
 let phys=word&PAGE_INDEX_MASK;let side=textureDimensions(shadowAtlas).x/u32(SHADOW_PAGE);
 let local=phys%(side*side);
 return vec3f((vec2f(f32(local%side),f32(local/side))-vec2f(p))*SHADOW_PAGE,f32(phys/(side*side)));
}
/** Texels a side of a layer of the pool. */
fn shadowAtlasTexels()->f32{return f32(textureDimensions(shadowAtlas).x);}
/** The comparison at atlas texel \`at\` — a page's integer origin plus a texel on a weight step's
 *  centre, exact — in a layer \`texels\` a side: it reads the page's content alone, wherever it is. */
fn shadowSample(at:vec2f,layer:i32,texels:f32,reference:f32)->f32{
 return textureSampleCompareLevel(shadowAtlas,shadowSampler,at/texels,layer,reference);
}
/** \`shadowSample\` at map texel \`t\` of the page placed by \`offset\`. */
fn shadowCompare(offset:vec3f,t:vec2f,reference:f32)->f32{
 return shadowSample(offset.xy+floor(t*SHADOW_SUBTEXELS+0.5)/SHADOW_SUBTEXELS,i32(offset.z),shadowAtlasTexels(),reference);
}`;
