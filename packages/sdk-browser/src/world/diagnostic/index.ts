import { createDiagnosticChannel } from '../../diagnostic/channel.ts'
import type { EngineDiagnostic } from '../../engine/types.ts'
import { presentationColorDiagnostic } from '../../diagnostic/presentationDiagnostic.ts'
import { sessionOf } from '../core/worldSession.ts'
import { RASTER_BACKGROUND } from '../../page/raster.ts'
import { worldNoticeListeners } from './worldNotices.ts'
import { createListeners } from '../../../../sdk-core/src/runtime/listeners.ts'

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
    const observers = createListeners<[d: EngineDiagnostic]>()
    const channel = createDiagnosticChannel(observers.emit, {
      detail: p.detail === 'full' ? 'trace' : 'summary',
    })
    const unlisten = worldNoticeListeners.subscribe((notice) => channel.emit(notice))
    const close = channel.close.bind(channel)
    return Object.assign(channel, {
      close() {
        unlisten()
        close()
      },
      // Each observer is handed its own copy, named by its phase.
      observe(fn: (d: { kind: string; message: string }) => void) {
        return observers.subscribe((d) => fn({ ...d, kind: d.phase }))
      },
    })
  },
  /**
   * The clear colour asked against the pixels the view shows (`presentationColorDiagnostic`).
   * @param world - The world to check.
   */
  async presentationColor(world: { scene: { background: unknown } }) {
    const session = sessionOf(world)
    const { width, height } = session.canvas
    const background = world.scene.background as { getHex?: () => number } | null
    const clear = background?.getHex?.() ?? RASTER_BACKGROUND
    return presentationColorDiagnostic(await session.capture(), width, height, clear)
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
}
