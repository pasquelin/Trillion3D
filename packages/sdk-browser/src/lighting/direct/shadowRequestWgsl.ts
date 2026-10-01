import { SUN_WINDOW } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { shadowEntryBits, laneRequestWgsl, subgroupRequestWgsl } from './requestLanesWgsl.ts';
/** Words of the request buffer after the count and a list as long as the pool's (`shadowRequestCap`,
 *  read at run time): one bit per table entry — a page is listed once however many pixels read it. */
export const shadowRequestBits = (pages = SUN_WINDOW) => shadowEntryBits(pages);

/**
 * What a reading asks of the scheduler. The shading that marks writes the page into the request
 * buffer the first time any pixel reads it this frame, a bit per table entry. A pass that does not
 * mark — the blend forward stage, which keeps its early depth reject — reads without asking.
 * `shadowRequesting` is the pass's to set on a lane that asks per subgroup. The buffer is bound at
 * `binding` of `group`, group 0 but for the transparents' marks, which bind it beside the blend
 * pass's groups (#1411); `null`, a module that reads without asking.
 */
export const shadowRequestWgsl = (binding: number | null, pages = SUN_WINDOW, group = 0) =>
  binding === null
    ? 'fn requestShadowPage(e:u32){}'
    : `@group(${group}) @binding(${binding}) var<storage,read_write> shadowRequests:array<atomic<u32>>;
var<private> shadowRequesting:bool=false;
${laneRequestWgsl(pages)}`;

/**
 * `shader`, a text that asks with `LANE_REQUEST_WGSL`, asking per subgroup instead: the feature
 * enabled, and the uniformity diagnostic off — the request runs in the pixel's own control flow,
 * and the loop above holds for any set of active lanes.
 */
export function withSubgroupShadowRequests(shader: string, pages = SUN_WINDOW) {
  const swapped = shader.replace(laneRequestWgsl(pages), () => subgroupRequestWgsl(pages));
  if (swapped === shader) throw new Error('SHADOW_REQUESTS_ABSENT');
  return `enable subgroups;
diagnostic(off,subgroup_uniformity);
${swapped}`;
}
