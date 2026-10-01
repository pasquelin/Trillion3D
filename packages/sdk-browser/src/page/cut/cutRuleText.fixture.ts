/**
 * The cut rule's kernel text run in Node on a packing (`wgslText`): what the rule's backends
 * (`cutRuleBackends.fixture.ts`) and the world link's proof decide with.
 */
import { DAG_SELECTION_SHADER } from '../../gpu/dag/shader/shader.ts';
import type { CutRuleAt, DagLinkAt } from '../../gpu/dag/oracle/predicates.fixture.ts';
import type { PackedDag } from '../../gpu/dag/types.ts';
import { CLUSTER_WORDS, HOT_ROOT } from '../../gpu/dag/layout.ts';
import { wgslScope } from './wgslPredicate.fixture.ts';
import { wgslConstants } from '../../texture/shaderRule.fixture.ts';

/** What the kernel's text decides in the model: its rule, a root's world link (`linkOf`, `linkHolds`). */
export type KernelText = { rule: CutRuleAt; links: DagLinkAt };

/**
 * The kernel's own text (`DAG_SELECTION_SHADER`) deciding on `packed`, run in Node. Its residency
 * reads `isResident(i)` and `childResident(i)` on the bit sets the host uploaded into the cold
 * buffer, and the rule itself. Only the projection is the model's: its screen errors are passed
 * where the kernel projects.
 * - `camera`: the cut a camera runs — `dagWanted` keeps the rule's two comparisons in the page's
 *   cone word (`setFlag(coneCache(i),…);`), then `dagMask`'s `let all=…;` and
 *   `draw=drawsCompared(…);` decide on that word.
 * - `light`: a light cut's `dagMask` call site, `let all=…;` then `draw=drawsCluster(…);`, on the
 *   model's two screen errors as `pagePixels` returns them (`x` the parent's, `y` its own).
 */
export function wgslText(
  packed: PackedDag,
  source = DAG_SELECTION_SHADER,
  path: 'camera' | 'light' = 'camera',
): KernelText {
  const all = /\blet all=([^;]+);/.exec(source),
    light = /\bdraw=(drawsCluster\([^;]+\));/.exec(source),
    camera = /\bdraw=(drawsCompared\([^;]+\));/.exec(source),
    word = /\bsetFlag\(coneCache\(i\),([^;]+)\);/.exec(source);
  if (!all || !light || !camera || !word) throw new Error('WGSL_CALL_SITE_MISSING: dagMask');
  const cold = new Uint32Array(
      packed.pageCones.buffer,
      packed.pageCones.byteOffset,
      packed.pageCones.length,
    ),
    hot = new Uint32Array(packed.clusters.buffer, packed.clusters.byteOffset);
  // The view block the call site, residency and link read: a cut that holds residency.
  const views = [{ residentCut: 1, clusterCount: packed.pageCount, pixelError: 0 }];
  const scope = wgslScope(source, {
    ...wgslConstants(source),
    views,
    cold,
    // `clusterAt(r).root`, the one field of the hot record the link reads.
    clusters: new Proxy(
      {},
      { get: (_, r) => ({ root: hot[Number(r) * CLUSTER_WORDS + HOT_ROOT] }) },
    ),
    min: Math.min,
    vi: 0,
    select: (no: unknown, yes: unknown, condition: unknown) => (condition ? yes : no),
  });
  const held = scope.expression(all[1]),
    linkOf = scope.fn('linkOf'),
    linkHolds = scope.fn('linkHolds');
  const links: DagLinkAt = {
    linkOf: (w, record) => linkOf(w, record) as number,
    linkHolds: (at) => linkHolds(at) === true,
  };
  if (path === 'light') {
    const draw = scope.expression(light[1], ['all', 'i', 'pixels']);
    const rule: CutRuleAt = (_ready, parentPixels, ownPixels, _childReady, t, page) => {
      views[0].pixelError = t;
      return draw({ all: held(), i: page, pixels: { x: parentPixels, y: ownPixels } }) === true;
    };
    return { rule, links };
  }
  const kept = scope.expression(word[1], ['rejected', 'pixels', 't', 'light']),
    draw = scope.expression(camera[1], ['all', 'i', 'word']);
  const rule: CutRuleAt = (_ready, parentPixels, ownPixels, _childReady, t, page) => {
    const f32 = Math.fround,
      bits = kept({
        rejected: false,
        light: false,
        pixels: { x: f32(parentPixels), y: f32(ownPixels) },
        t: f32(t),
      });
    return draw({ all: held(), i: page, word: bits }) === true;
  };
  return { rule, links };
}

