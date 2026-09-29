import { preparedNodeRank } from '../../../host/prepared/sourceRanks.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts';
import type { ProxySync } from '../../../../../sdk-core/src/scene/core/proxyMotion.ts';

type MovingProxy = {
  sync(worldOf: (source: number) => ArrayLike<number> | undefined): ProxySync;
  /** Owned leaves wait for their still streak to settle. */
  readonly settling?: boolean;
};
const readers = new WeakMap<
  WebgpuPagesRuntime,
  (source: number) => ArrayLike<number> | undefined
>();
const seen = new WeakMap<MovingProxy, number>();
/** Frame of each proxy's last sync: a proxy synced twice in one frame (bounce, then lighting)
 *  does not settle in the frame it moved. */
const syncedFrame = new WeakMap<MovingProxy, number>();

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

/** Late arrivals read today's poses, including host writes that preceded their asynchronous load.
 *  A proxy whose owned leaves wait to settle syncs once on each frame without a scene write, until
 *  its still streak settles them (`proxyMotion.ts`); one that cannot settle stops asking. */
export function syncPageProxy(rt: WebgpuPagesRuntime, proxy: MovingProxy, arrived = false) {
  const epoch = rt.run.gate.revisions.scene,
    frame = rt.run.frame;
  if (
    !arrived &&
    seen.get(proxy) === epoch &&
    (!proxy.settling || syncedFrame.get(proxy) === frame)
  )
    return null;
  if (arrived) rt.setup.worlds.refresh();
  const change = proxy.sync(reader(rt));
  seen.set(proxy, epoch);
  syncedFrame.set(proxy, frame);
  return change;
}

/** Kept bounce resources must follow motion even while bounce is toggled off: far shadows borrow them. */
export function syncLightingProxies(rt: WebgpuPagesRuntime) {
  if (rt.bounce.probes) syncPageProxy(rt, rt.bounce.probes);
  if (rt.sunFar.gpu?.proxy && !rt.sunFar.borrowed) syncPageProxy(rt, rt.sunFar.gpu.proxy);
}
