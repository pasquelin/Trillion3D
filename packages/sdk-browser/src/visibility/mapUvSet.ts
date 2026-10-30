import { wgslFn } from '../../../math/src/wgsl/decl.ts'
import { FLAG_MAP_UV_HIGH, FLAG_MAP_UV_LOW, FLAG_MAP_UV_TOP } from './types.ts'

/** The texture set a row's base map reads (0 to 7) from its flags: the three bits `FLAG_MAP_UV_LOW`, `FLAG_MAP_UV_HIGH` and `FLAG_MAP_UV_TOP`, low to high. */
export const mapUvSetOf = (flags: number) =>
  (flags & FLAG_MAP_UV_LOW ? 1 : 0) |
  (flags & FLAG_MAP_UV_HIGH ? 2 : 0) |
  (flags & FLAG_MAP_UV_TOP ? 4 : 0)

/** The three flags that carry the texture set `set` (0 to 7), the inverse of `mapUvSetOf`. */
export const mapUvSetFlags = (set: number) =>
  (set & 1 ? FLAG_MAP_UV_LOW : 0) |
  (set & 2 ? FLAG_MAP_UV_HIGH : 0) |
  (set & 4 ? FLAG_MAP_UV_TOP : 0)

/** `mapUvSetOf` in WGSL, over the flags word: the same three bits, so the shaders and the host read one set. */
export const MAP_UV_SET = wgslFn(
  'mapUvSetOf',
  [],
  `fn mapUvSetOf(flags:u32)->u32{
 return select(0u,1u,(flags&${FLAG_MAP_UV_LOW}u)!=0u)|select(0u,2u,(flags&${FLAG_MAP_UV_HIGH}u)!=0u)|select(0u,4u,(flags&${FLAG_MAP_UV_TOP}u)!=0u);
}`,
)
