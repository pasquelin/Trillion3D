/**
 * Whether a host material carries a shader hook the engine's own programs would silently drop.
 *
 * A host library gives every material an EMPTY compile hook on the base prototype all its
 * materials inherit from, and an author installs a real one by writing over it — on the instance,
 * or on a subclass's prototype. So the test is not what the hook does, it is whether the function
 * reached from the material is still the one its base prototype declares. Comparing against the
 * library's class would name the library on the engine path; walking the material's own prototype
 * chain to its deepest declaration does not, and catches the subclass override too.
 */

/** The deepest declaration of `onBeforeCompile` in a material's prototype chain: the library's
 *  own empty hook, whatever the material's family. */
function inheritedHook(material: object) {
  let base: unknown;
  for (let proto = Object.getPrototypeOf(material); proto; proto = Object.getPrototypeOf(proto)) {
    const declared = Object.getOwnPropertyDescriptor(proto, 'onBeforeCompile')?.value;
    if (typeof declared === 'function') base = declared;
  }
  return base;
}

/** True when the material reaches a compile hook other than the one it inherits. */
export function declaresCompileHook(material: { readonly onBeforeCompile?: unknown }) {
  const hook = material.onBeforeCompile;
  return typeof hook === 'function' && hook !== inheritedHook(material);
}
