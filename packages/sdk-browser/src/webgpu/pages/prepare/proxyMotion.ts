import { preparedNodeRank } from '../../../host/prepared/sourceRanks.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts';

type MovingProxy = { sync(worldOf: (source: number) => ArrayLike<number> | undefined): boolean };
const readers = new WeakMap<
  WebgpuPagesRuntime,
  (source: number) => ArrayLike<number> | undefined
>();
const seen = new WeakMap<MovingProxy, number>();

/** Source identity is indexed once; matrices are the engine's live views, including parents. */
function reader(rt: WebgpuPagesRuntime) {
  let read = readers.get(rt);
  if (read) return read;
  const nodes = new Map<number, Object3D>();
  rt.setup.source.traverse((node) => {
    const rank = preparedNodeRank(node);
    if (rank !== undefined) nodes.set(rank, node);
  });
  read = (rank) => {
    const node = rank === -1 ? rt.setup.source : nodes.get(rank);
    return node ? rt.setup.worlds.of(node).elements : undefined;
  };
  readers.set(rt, read);
  return read;
}

/** Late arrivals read today's poses, including host writes that preceded their asynchronous load. */
export function syncPageProxy(rt: WebgpuPagesRuntime, proxy: MovingProxy, arrived = false) {
  const epoch = rt.run.gate.revisions.scene;
  if (!arrived && seen.get(proxy) === epoch) return false;
  if (arrived) rt.setup.worlds.refresh();
  const moved = proxy.sync(reader(rt));
  seen.set(proxy, epoch);
  return moved;
}

/** Kept bounce resources must follow motion even while bounce is toggled off: far shadows borrow them. */
export function syncLightingProxies(rt: WebgpuPagesRuntime) {
  if (rt.bounce.probes) syncPageProxy(rt, rt.bounce.probes);
  if (rt.sunFar.gpu?.proxy && !rt.sunFar.borrowed) syncPageProxy(rt, rt.sunFar.gpu.proxy);
}
