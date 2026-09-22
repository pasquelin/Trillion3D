import { createDiagnosticChannel } from '../../diagnosticChannel.ts';
import type { BackendDiagnostic } from '../../backendTypes.ts';
import { presentationColorDiagnostic } from '../../presentationDiagnostic.ts';
import { sessionOf } from '../core/worldSession.ts';
import { DEFAULT_CLEAR_COLOR } from '../../backendCommon.ts';
import { listenWorldNotices } from './worldNotices.ts';

/**
 * The `diagnostic` family: watching the engine work. A channel (`createDiagnosticChannel`) hands
 * each finding to its observers — among them every notice a world says of its scene
 * (`worldNotices.ts`) until the channel is closed; the audits are the session's own proofs.
 */
export const diagnostic = {
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
  /** The clear colour asked against the pixels the view shows (`presentationColorDiagnostic`). */
  presentationColor(world: { scene: { background: unknown } }) {
    const session = sessionOf(world);
    const { width, height } = session.canvas;
    const background = world.scene.background as { getHex?: () => number } | null;
    const clear = background?.getHex?.() ?? DEFAULT_CLEAR_COLOR;
    return presentationColorDiagnostic(session.capture(), width, height, clear);
  },
  partitionAudit: (world: object) => sessionOf(world).partitionAudit(),
  transparentOcclusion: (world: object) => sessionOf(world).transparentOcclusionAudit(),
  shadowAtlas: (world: object) => sessionOf(world).shadowAtlasDigest(),
};
