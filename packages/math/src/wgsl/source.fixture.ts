import type { WgslDecl } from './decl.ts'
import { wgslModule } from './assemble.ts'

/** What a test reads a shader from: its text, or a declaration. */
export type WgslSource = string | WgslDecl

/** The text a test reads of a shader: as given, or a declaration assembled with what it lists, as
 *  a program would write it. */
export const wgslSource = (source: WgslSource) =>
  typeof source === 'string' ? source : wgslModule(source)
