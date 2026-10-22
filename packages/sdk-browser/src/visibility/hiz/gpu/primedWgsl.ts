import { HIZ_SHADER } from './shader.ts'

/** The binding of the primed build's uniform, after the three of the build (`hizBindEntries`). */
export const HIZ_PRIMED_BINDING = 3
/** Bytes of the primed uniform: the near plane, the far plane, the projection's weight and the push. */
export const HIZ_PRIMED_BYTES = 16

/**
 * What the primed pyramid's build adds to the shader (`hizShader`): the push of its level 0. A
 * device depth is turned to the distance it stands for, the push `bias` is added to that distance,
 * and the sum turned back, clamped to [0, 1] — a perspective's depth is `near` over the distance,
 * an orthographic one's is affine from 1 at the near plane to 0 at the far one —; the far plane's
 * zero stays zero. The coarse draw is thus never in front of the image's own surfaces.
 */
const HIZ_PRIMED_WGSL = `struct Primed{near:f32,far:f32,perspective:f32,bias:f32,}
@group(0) @binding(${HIZ_PRIMED_BINDING}) var<uniform> primed:Primed;
fn hizPrimed(z:f32)->f32{
 if(primed.perspective!=0.0){return saturate(z*primed.near/(primed.near+primed.bias*z));}
 return saturate(z-primed.bias/(primed.far-primed.near));
}
`

/** `text` with the one occurrence of `anchor` replaced; a shader that lost the anchor throws, so
 *  the primed build can never run without its push. */
function replacedOnce(text: string, anchor: string, by: string) {
  if (text.split(anchor).length !== 2) throw new Error(`HIZ_PRIMED_ANCHOR: ${anchor}`)
  return text.replace(anchor, () => by)
}

/**
 * The primed pyramid's shader: the culling build's (`HIZ_SHADER`, which no setting changes) with the
 * push declared beside the build's uniform and applied where the first pass copies level 0 into the
 * culling layer. The image's own build is that text, untouched.
 */
export const HIZ_PRIMED_SHADER = /* @__PURE__ */ (() => {
  const declared = replacedOnce(
    HIZ_SHADER,
    'var<uniform> uni:Uni;\n',
    `var<uniform> uni:Uni;\n${HIZ_PRIMED_WGSL}`,
  )
  return replacedOnce(
    declared,
    'let depth=textureLoad(level0,q,0,0).r;',
    'let depth=hizPrimed(textureLoad(level0,q,0,0).r);',
  )
})()
