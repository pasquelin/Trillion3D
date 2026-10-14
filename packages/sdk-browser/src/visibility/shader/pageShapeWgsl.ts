import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FLAG_LINE, FLAG_SPRITE } from '../types.ts'
import { PAGE_SCREEN_WGSL } from './pageGeometryWgsl.ts'

/**
 * A row's sprite rule and line width (`PageShape`), read off its surface's record
 * (`materialAt`, `../../webgpu/material/materialWgsl.ts`) where its flags say it draws a sprite or
 * a line (`FLAG_SPRITE`, `FLAG_LINE`): a row of neither — nearly all of them — reads no record,
 * and its zeros are the very values the record holds for it. The host lists the material table at
 * its own binding.
 */
export const PAGE_SHAPE_WGSL = wgslBlock(
  'PAGE_SHAPE_WGSL',
  [PAGE_SCREEN_WGSL],
  `fn pageShape(page:PageInfo)->PageShape{
 if((page.flags&${FLAG_SPRITE | FLAG_LINE}u)==0u){return PageShape(vec2f(0.0),0.0);}
 let m=materialAt(page.material);
 return PageShape(m.sprite,m.lineWidth);
}`,
)
