/**
 * A camera's cone word, run in Node from the kernel's own text (`DAG_SELECTION_SHADER`):
 * `dagWanted` writes it (`flags[coneCache(i)]=…;`) — the cone verdict and the cut rule's two
 * comparisons — and `dagMask` reads it, first through its guard (`if((word&…)==0u){`).
 */
import { DAG_SELECTION_SHADER } from '../../gpu/dag/shader/shader.ts';
import { wgslScope } from './wgslPredicate.fixture.ts';

/** The `u32` constants of `source`, by name, for a call site that reads them. */
export function wgslConstants(source: string) {
  const found: Record<string, number> = {};
  for (const [, name, value] of source.matchAll(/\bconst (\w+):u32=(\d+)u;/g))
    found[name] = Number(value);
  return found;
}

/** WGSL's `select(no, yes, condition)`. */
export const wgslSelect = (no: unknown, yes: unknown, condition: unknown) => (condition ? yes : no);

/**
 * The word `dagWanted` keeps for a page, on `f32` operands as the kernel holds them, and whether
 * `dagMask`'s guard lets the page through to the rule.
 */
export function coneWord(source = DAG_SELECTION_SHADER) {
  const write = /\bflags\[coneCache\(i\)\]=([^;]+);/.exec(source),
    guard = /\bif\((\(word&\w+\)==0u)\)\{/.exec(source);
  if (!write || !guard) throw new Error('WGSL_CALL_SITE_MISSING: cone word');
  const scope = wgslScope(source, { ...wgslConstants(source), select: wgslSelect });
  const kept = scope.expression(write[1], ['rejected', 'pixels', 't', 'light']),
    open = scope.expression(guard[1], ['word']);
  return (rejected: boolean, parent: number, own: number, t: number, light = false) => {
    const f32 = Math.fround,
      pixels = { parent: f32(parent), own: f32(own) };
    const word = kept({ rejected, light, pixels, t: f32(t) }) as number;
    return { word, open: open({ word }) === true };
  };
}
