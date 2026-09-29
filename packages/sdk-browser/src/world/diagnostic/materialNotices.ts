import type { BackendContext } from '../../backend/types.ts';
import { sendEngineDiagnostic } from '../../diagnostic/engineDiagnostic.ts';
import type { WorldNotices } from './worldNotices.ts';

// Apart from `worldNotices.ts`, whose budgets reach the WebGPU engine: the WebGL2 draw
// (`../../webgl/cluster/sceneDraw.ts`) loads this and no WebGPU code.

/**
 * The WebGL2 program's word (`MaterialDegraded`) that it draws a surface without physical
 * `features` it cannot draw (`physicalLostMask`): said once per surface and feature, as
 * `material-degraded`, and the frame goes on. With `leftOut`, the surface is one the gate refuses
 * (`clusterMaterialReason`): it is left out of the frame, every other one drawn, said once per
 * surface and reason as `material-refused`. Heard on each draw of a surface (`readDegraded`): a
 * known feature or reason is never said again.
 */
export function noticeMaterialDegraded(notices: Pick<WorldNotices, 'say'>) {
  const said = new WeakMap<object, Set<string>>();
  const first = (material: object, word: string) => {
    let known = said.get(material);
    if (!known) said.set(material, (known = new Set()));
    return !known.has(word) && !!known.add(word);
  };
  return (
    material: { readonly name?: string; readonly family?: string },
    features: readonly string[],
    leftOut?: string,
  ) => {
    const name = material.name ?? '';
    if (leftOut && first(material, leftOut))
      notices.say(
        'material-refused',
        `surface "${name}" left out of the WebGL2 frame, every other one drawn: ${leftOut}`,
        { material: name, reason: leftOut },
      );
    for (const feature of features)
      if (first(material, feature))
        notices.say(
          'material-degraded',
          `${material.family} material "${name}" drawn on WebGL2 without ${feature}, ` +
            `which WebGL2 cannot draw`,
          { material: name, feature },
        );
  };
}

/** The session's degraded-surface hearer, or, where it gives none, the same notice said on its
 *  diagnostics (`onDiagnostic`): a WebGL2 draw never loses it silently. */
export const degradedHearer = (hosts: Pick<BackendContext, 'materialDegraded' | 'onDiagnostic'>) =>
  hosts.materialDegraded ??
  noticeMaterialDegraded({
    say: (phase, message, context = {}) =>
      sendEngineDiagnostic(hosts.onDiagnostic, phase, message, context),
  });
