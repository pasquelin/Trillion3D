// The one way the bench wraps a method of the WebGPU prototypes: the engine's call runs as it did,
// then the bench looks at it. Every probe (`device.ts` counts, `passWorkHooks.ts` encodings,
// `dissectHooks.ts` shaders) hooks through it. These run on
// every draw, bind and dispatch of the engine, and the bench's own CPU time is a number it reports:
// a hook returns at once on a pass nobody follows.

/** A prototype of the WebGPU globals, as the hooks see it. */
export type Proto = Record<string, (...args: never[]) => unknown>

/** Runs `hook(self, args, made)` after each call of `proto[name]`, which is left as it was. */
export function hookAfter(
  proto: Proto | undefined,
  name: string,
  hook: (self: object, args: never[], made: unknown) => void,
) {
  const original = proto?.[name]
  if (!original) return
  proto![name] = function (this: object, ...args: never[]) {
    const made = original.apply(this, args)
    hook(this, args, made)
    return made
  }
}

/** Gives `use` what a creation call made, once it exists: a pipeline made async is a promise. */
export const onMade = (made: unknown, use: (made: object) => void) =>
  made instanceof Promise ? void made.then(use) : use(made as object)
