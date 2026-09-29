import { preparedNodeRank } from '../../../host/prepared/sourceRanks.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts';

type MovingProxy = {
  sync(worldOf: (source: number) => ArrayLike<number> | undefined): boolean;
  readonly dynamic?: boolean;
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
 *  A moving proxy syncs once more on the first frame without a scene write: that is where it
 *  settles (`epoch + 0.5` records that try, so a proxy that cannot settle costs nothing more). */
export function syncPageProxy(rt: WebgpuPagesRuntime, proxy: MovingProxy, arrived = false) {
  const epoch = rt.run.gate.revisions.scene,
    frame = rt.run.frame,
    last = seen.get(proxy);
  if (
    !arrived &&
    (last === epoch + 0.5 ||
      (last === epoch && (!proxy.dynamic || syncedFrame.get(proxy) === frame)))
  )
    return false;
  if (arrived) rt.setup.worlds.refresh();
  const moved = proxy.sync(reader(rt));
  seen.set(proxy, last === epoch ? epoch + 0.5 : epoch);
  syncedFrame.set(proxy, frame);
  return moved;
}

/** Kept bounce resources must follow motion even while bounce is toggled off: far shadows borrow them. */
export function syncLightingProxies(rt: WebgpuPagesRuntime) {
  if (rt.bounce.probes) syncPageProxy(rt, rt.bounce.probes);
  if (rt.sunFar.gpu?.proxy && !rt.sunFar.borrowed) syncPageProxy(rt, rt.sunFar.gpu.proxy);
}
