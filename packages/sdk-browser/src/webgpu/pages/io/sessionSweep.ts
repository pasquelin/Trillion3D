import { gpuDeviceLedgerOf } from '../../../gpu/core/deviceLedger.ts'
import { log } from '../../../diagnostic/log.ts'
import type { PagesSession } from '../backendApi.ts'

/**
 * What the closed session's handle still holds once torn down, destroyed through its ledger
 * (`GpuDeviceLedger.sweep`), which counts every buffer and texture made through the handle and
 * none of the device's shared caches: the buffers its holders keep between uses (`heldBuffers`),
 * its zero words — and any resource a teardown forgot, which the console names, so a leak stays
 * visible while it costs nothing.
 */
export function sweepSession(session: PagesSession) {
  const swept = gpuDeviceLedgerOf(session.claim?.device)?.sweep() ?? []
  if (!swept.length) return
  const byLabel = new Map<string, number>()
  for (const label of swept) byLabel.set(label, (byLabel.get(label) ?? 0) + 1)
  const named = [...byLabel].map(([label, count]) => (count > 1 ? `${label} ×${count}` : label))
  log.info(`A closed session destroyed what its handle still held: ${named.join(', ')}`)
}
