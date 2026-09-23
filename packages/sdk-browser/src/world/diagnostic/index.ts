import { createDiagnosticChannel } from '../../diagnostic/channel.ts';
import type { BackendDiagnostic } from '../../backend/types.ts';
import { presentationColorDiagnostic } from '../../diagnostic/presentationDiagnostic.ts';
import { sessionOf } from '../core/worldSession.ts';
import { DEFAULT_CLEAR_COLOR } from '../../backend/common.ts';
import { listenWorldNotices } from './worldNotices.ts';

/**
 * The `diagnostic` family: watching the engine work. A channel (`createDiagnosticChannel`) hands
 * each finding to its observers — among them every notice a world says of its scene
 * (`worldNotices.ts`) until the channel is closed; the audits are the session's own proofs.
 */
export const diagnostic = {
  /**
   * Opens a channel that tells its observers each thing the engine notices.
   * @param p - Whether it says a summary or everything.
   */
  createChannel(p: { detail?: 'summary' | 'full' } = {}) {
    const observers = new Set<(d: { kind: string; message: string }) => void>();
    const deliver = (d: BackendDiagnostic) => {
      for (const observer of observers) observer({ ...d, kind: d.phase });
    };
    const channel = createDiagnosticChannel(deliver, {
      detail: p.detail === 'full' ? 'trace' : 'summary',
    });
    const unlisten = listenWorldNotices((notice) => channel.emit(notice));
    const close = channel.close.bind(channel);
    return Object.assign(channel, {
      close() {
        unlisten();
        close();
      },
      observe(fn: (d: { kind: string; message: string }) => void) {
        observers.add(fn);
        return () => {
          observers.delete(fn);
        };
      },
    });
  },
  /**
   * The clear colour asked against the pixels the view shows (`presentationColorDiagnostic`).
   * @param world - The world to check.
   */
  presentationColor(world: { scene: { background: unknown } }) {
    const session = sessionOf(world);
    const { width, height } = session.canvas;
    const background = world.scene.background as { getHex?: () => number } | null;
    const clear = background?.getHex?.() ?? DEFAULT_CLEAR_COLOR;
    return presentationColorDiagnostic(session.capture(), width, height, clear);
  },
  /**
   * Checks how the frame split its work between passes.
   * @param world - The world to check.
   */
  partitionAudit: (world: object) => sessionOf(world).partitionAudit(),
  /**
   * Checks which see-through surfaces the occlusion test kept or dropped.
   * @param world - The world to check.
   */
  transparentOcclusion: (world: object) => sessionOf(world).transparentOcclusionAudit(),
  /**
   * A summary of what the shadow atlas holds this frame.
   * @param world - The world to check.
   */
  shadowAtlas: (world: object) => sessionOf(world).shadowAtlasDigest(),
};
