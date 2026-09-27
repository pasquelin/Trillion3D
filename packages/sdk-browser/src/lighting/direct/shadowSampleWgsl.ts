// The shadow pool's page reads, shared by every pass that lights a surface (`shadowWgsl.ts`):
// where a page lies, and the hardware comparison in it, exact wherever the pool puts it (#831).

/** Steps a texel of the comparison filter's weights: their 8 bits, the subtexel precision of
 *  Direct3D and Metal, rounded to nearest (measured on Apple M2, #831). `shadowCompare` reads at
 *  their centres, where a normalised coordinate's rounding never changes the step; centres of a
 *  truncating filter's steps, half a step off, changed 20–30 % of the samples between pool sides. */
export const SHADOW_SUBTEXELS = 256;

/** The page reads. Requires `shadowAtlas`, `shadowSampler`, `SHADOW_PAGE`, `SHADOW_SUBTEXELS`, `SHADOW_SUBTEXEL` and
 *  `PAGE_INDEX_MASK`. */
export const SHADOW_SAMPLE_WGSL = `/** Place of page \`p\`, held by physical page \`word\`: \`xy\` added to a texel coordinate of the
 *  map gives that texel's place in its layer, \`z\` is the layer (\`shadowPoolShape\`). The quotients
 *  are single-precision floors, not integer divisions: with \`phys\` under 2¹⁶ and \`side\` at most
 *  2⁹, \`(n + ½) / d\` lies at least \`½ / d\` from any integer while a division a few ulps off stays
 *  far inside that, so each floor is the integer quotient (\`shadowOffset.test.ts\`, every input). */
fn shadowOffset(word:u32,p:vec2i)->vec3f{
 let phys=f32(word&PAGE_INDEX_MASK);let side=f32(textureDimensions(shadowAtlas).x)/SHADOW_PAGE;
 let area=side*side;
 let layer=floor((phys+0.5)/area);
 let local=phys-layer*area;
 let y=floor((local+0.5)/side);
 return vec3f((vec2f(local-y*side,y)-vec2f(p))*SHADOW_PAGE,layer);
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
 return shadowSample(offset.xy+floor(t*SHADOW_SUBTEXELS+0.5)*SHADOW_SUBTEXEL,i32(offset.z),shadowAtlasTexels(),reference);
}`;
