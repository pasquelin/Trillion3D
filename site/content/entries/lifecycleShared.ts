/** Shared row markers for the lifecycle entries, split across `lifecycle.ts` and
 *  `lifecycleWorld.ts` to keep each file under the line budget; order is preserved by
 *  concatenation, which is what the French overlay (`lifecycle.fr.ts`) merges onto by index. */
export const NODE = {
  section: 'lifecycle',
  kind: 'Function',
  module: 'packages/sdk-node/index.mts',
};
export const BROWSER = { section: 'lifecycle', kind: 'Function' };
