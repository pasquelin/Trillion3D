// A resolve's shipped text run in JavaScript pixel by pixel: `resolve` at the pixel's centre, its
// fetches counted.
import { shaderRun } from '../texture/shaderRun.fixture.ts';
import { resolveFunctions } from './taaBuiltins.fixture.ts';

/** Around a pixel's own resolve: `before` it, and `after`, from `TaaOut`'s value in the scope. */
export interface PixelHooks<R> {
  before?: (x: number, y: number) => void;
  after: (out: unknown) => R;
}

/** `(x, y)`'s resolve of `shader` over `frameScope` and its fetches — every load, filtered sample
 *  and gather, counted here. */
export function pixelResolves<R>(
  shader: string,
  frameScope: Record<string, unknown>,
  hooks: PixelHooks<R>,
): (x: number, y: number) => { value: R; fetches: number } {
  let fetches = 0;
  const scope = { ...frameScope };
  for (const name of ['textureLoad', 'textureGather', 'textureSampleLevel']) {
    const read = scope[name] as (...args: unknown[]) => unknown;
    scope[name] = (...args: unknown[]) => (fetches++, read(...args));
  }
  const entry = shaderRun<{ resolve: (...args: unknown[]) => unknown }>(
    shader,
    resolveFunctions(shader),
    scope,
  );
  return (x: number, y: number) => {
    hooks.before?.(x, y);
    fetches = 0;
    const value = hooks.after(entry.resolve([x + 0.5, y + 0.5, 0, 1]));
    return { value, fetches };
  };
}
