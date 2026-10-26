/**
 * One WGSL declaration: a function, a constant or a structure of the maths library, written once
 * and named by the shaders that use it, or a shader's fragment (`block`), the text of several
 * declarations a program shares with others. Its dependencies are the declarations themselves,
 * never their names: a misspelt dependency is a TypeScript error, not a shader that fails to
 * compile. The assembler (`assemble.ts`) writes each one once, its dependencies first; only a whole
 * program calls it, so two fragments needing one function hold it once.
 */
export type WgslDecl = {
  /** The WGSL identifier it declares, the name of its TypeScript twin when one exists; a
   *  fragment's own name, never a WGSL identifier. */
  readonly name: string
  readonly kind: 'fn' | 'const' | 'struct' | 'block'
  /** The declarations its text names, written before it. */
  readonly deps: readonly WgslDecl[]
  /** The declaration as the shader reads it; a fragment's declarations, as written. */
  readonly text: string
  /** A default: a program that lists another declaration of the same name takes that one in its
   *  place, and keeps this one only when it lists none (`wgslFn`'s `weak`). */
  readonly weak?: true
}

/** Spliced into a template as text, a declaration would be written again by every fragment
 *  holding it: every declaration inherits this refusal, so the fragment lists it instead. `.text`
 *  is the only sanctioned read of a declaration's text, by the assembler and by the tests. */
const DECLARATION = Object.freeze({
  toString(this: WgslDecl): string {
    throw new Error(`WGSL '${this.name}' spliced as text: list it as a dependency`)
  },
})

const declare = (
  kind: WgslDecl['kind'],
  name: string,
  deps: readonly WgslDecl[],
  text: string,
  weak?: true,
): WgslDecl =>
  Object.freeze(
    Object.assign(Object.create(DECLARATION) as WgslDecl, {
      name,
      kind,
      deps: Object.freeze([...deps]),
      text,
      ...(weak && { weak }),
    }),
  )

/** A WGSL function `name`, `text` its whole declaration (`fn name(...)->...{...}`). With `weak`, a
 *  default: the function a fragment calls without knowing whether the program supplies its own, which
 *  the program's declaration of the same name replaces (`assemble.ts`). */
export const wgslFn = (
  name: string,
  deps: readonly WgslDecl[],
  text: string,
  options: { weak?: true } = {},
) => declare('fn', name, deps, text, options.weak)

/** A WGSL module-scope constant `name`, `text` its whole declaration (`const name=...;`). */
export const wgslConst = (name: string, deps: readonly WgslDecl[], text: string) =>
  declare('const', name, deps, text)

/** A WGSL structure `name`, `text` its whole declaration (`struct name{...}`). */
export const wgslStruct = (name: string, deps: readonly WgslDecl[], text: string) =>
  declare('struct', name, deps, text)

/** A shader fragment `name`: `text` declares what several programs share, written as is, after
 *  the declarations and fragments it uses (`deps`). A program holds one text a fragment name. */
export const wgslBlock = (name: string, deps: readonly WgslDecl[], text: string) =>
  declare('block', name, deps, text)
