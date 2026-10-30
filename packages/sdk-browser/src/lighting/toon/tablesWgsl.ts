import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  TOON_BUFFER_HEADER_WORDS,
  TOON_ROWS_AT,
} from '../../../../sdk-core/src/lighting/toonProfile/rows.ts'

/** Where a pass binds the toon buffer. */
export interface ToonTablesBinding {
  readonly group: number
  readonly binding: number
}

/**
 * HOW THE TOON TABLES ARE READ, over the toon buffer (`toonProfile/rows.ts`) bound at `at` as `toonTables`: `toonSize` the resolution the ramps
 * and patterns are baked at, `toonRowWord` a word of a profile's row, `toonPatternWord` a word of the baked patterns and `toonPeakWord` the two
 * words of a texel of the toon specular's peak table. A pass that lights toon pixels binds the buffer (`ToonTablesBinding`); the others
 * hold `TOON_TABLES_NONE_WGSL`, whose reads answer zero.
 */
export const toonTablesBinding = (at: ToonTablesBinding) =>
  wgslBlock(
    `toonTablesBinding(${at.group}:${at.binding})`,
    [],
    `
@group(${at.group}) @binding(${at.binding}) var<storage,read> toonTables:array<u32>;
fn toonSize()->u32{return toonTables[1];}
fn toonRowWord(row:u32,at:u32)->u32{return toonTables[${TOON_ROWS_AT}u+row*toonTables[2]+at];}
fn toonPatternWord(i:u32)->u32{return toonTables[toonTables[0]+i];}
fn toonPeakWord(i:u32)->vec2u{return vec2u(toonTables[${TOON_BUFFER_HEADER_WORDS}u+i*2u],toonTables[${TOON_BUFFER_HEADER_WORDS + 1}u+i*2u]);}`,
  )

export const TOON_TABLES_NONE_WGSL = wgslBlock(
  'TOON_TABLES_NONE_WGSL',
  [],
  `
fn toonSize()->u32{return 64u;}
fn toonRowWord(row:u32,at:u32)->u32{return 0u;}
fn toonPatternWord(i:u32)->u32{return 0u;}
fn toonPeakWord(i:u32)->vec2u{return vec2u(0u);}`,
)
