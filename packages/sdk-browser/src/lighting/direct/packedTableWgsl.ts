import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * A table of two unorm16 values per texel, packed in one word and held in the light buffer, read at (N·V, roughness) as a texture is:
 * bilinear between the texel centres, held to the edge. `texel` is the function that reads one texel, `pair` the bilinear read of the
 * table; `field` is the light buffer's array of words. A declaration its hosts list.
 */
export function packedTableWgsl(
  texel: string,
  pair: string,
  field: string,
  width: number,
  height: number,
) {
  return wgslBlock(
    `packedTableWgsl(${texel})`,
    [],
    `
fn ${texel}(x:i32,y:i32)->vec2f{
 let at=u32(clamp(y,0,${height - 1}))*${width}u+u32(clamp(x,0,${width - 1}));
 return unpack2x16unorm(directLights.${field}[at]);
}
fn ${pair}(rough:f32,NdotV:f32)->vec2f{
 let p=vec2f(NdotV,rough)*vec2f(${width}.0,${height}.0)-0.5;
 let f=floor(p);
 let t=p-f;
 let x=i32(f.x);let y=i32(f.y);
 return mix(mix(${texel}(x,y),${texel}(x+1,y),t.x),mix(${texel}(x,y+1),${texel}(x+1,y+1),t.x),t.y);
}`,
  )
}
