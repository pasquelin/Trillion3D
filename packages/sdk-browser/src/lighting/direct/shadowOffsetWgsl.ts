/**
 * Place of page `p`, held by physical page `word`: `xy` added to a texel coordinate of the map
 * gives that texel's place in its layer, `z` is the layer (`shadowPoolShape`). The quotients are
 * single-precision floors, not integer divisions: with `phys` under 2¹⁶ and `side` at most 2⁹,
 * `(n + ½) / d` lies at least `½ / d` from any integer while a division a few ulps off stays far
 * inside that, so each floor is the integer quotient (`shadowOffset.test.ts`, every input).
 */
export const SHADOW_OFFSET_WGSL = `fn shadowOffset(word:u32,p:vec2i)->vec3f{
 let phys=f32(word&PAGE_INDEX_MASK);let side=f32(textureDimensions(shadowAtlas).x)/SHADOW_PAGE;
 let area=side*side;
 let layer=floor((phys+0.5)/area);
 let local=phys-layer*area;
 let y=floor((local+0.5)/side);
 return vec3f((vec2f(local-y*side,y)-vec2f(p))*SHADOW_PAGE,layer);
}`;
