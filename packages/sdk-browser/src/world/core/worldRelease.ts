import { releaseWorldMirror } from './worldMirror.ts';
type Mirror = { root: Parameters<typeof releaseWorldMirror>[0] } | null;
import { pendingViewReleases } from '../views/releases.ts';

/** Keeps closing sessions alive through reopening and final world teardown. */
export function worldReleases() {
  const pending = pendingViewReleases();
  return {
    close(session: { dispose(): void | Promise<void> } | null, mirror?: Mirror) {
      return pending.track(async () => {
        try {
          await session?.dispose();
        } finally {
          if (mirror) releaseWorldMirror(mirror.root);
        }
      });
    },
    async drain(mirror: Mirror, ...opening: (Promise<unknown> | null | undefined)[]) {
      await Promise.allSettled(opening);
      await pending.drain();
      if (mirror) releaseWorldMirror(mirror.root);
    },
  };
}

/** Device and canvas outlive every view release, even when a lost device rejects a readback. */
export function finishWorldRelease(
  released: void | Promise<void>,
  device: { dispose(): void },
  releaseCanvas: () => void,
) {
  const finish = () => {
    device.dispose();
    releaseCanvas();
  };
  void Promise.resolve(released).then(finish, finish);
}
