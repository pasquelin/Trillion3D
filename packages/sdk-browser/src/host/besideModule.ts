/**
 * The URL of a module beside the caller's, named without extension: it carries the caller's own
 * extension — `.ts` in a source tree served as is, `.js` in a built `dist/`. A fixed string would
 * hit the wrong file on one side, and a missing worker would fail without saying so.
 * @param name - The module's file name, without extension.
 * @param from - The caller's `import.meta.url`.
 */
export const besideModule = (name: string, from: string) =>
  new URL(`./${name}${from.endsWith('.ts') ? '.ts' : '.js'}`, from);
