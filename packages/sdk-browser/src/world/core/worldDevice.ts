import { cpuNow } from '../../diagnostic/stopwatch.ts'
import { probeWorldDevice } from '../capability/worldReady.ts'

/**
 * The one WebGPU device a world holds for its life: every session it opens draws on it. A device
 * lost for any reason but its own `destroy` — a driver reset, a GPU process restarted — is asked
 * for again the way the first one was (`probeWorldDevice`), and `regranted` then reopens the
 * session on what was granted, told when the loss happened — the reopen's notice measures the
 * recovery from it, with the pages the world's cache kept (`worldReopen.ts`); a machine that grants none any more
 * fails that grant by name (`WEBGPU_UNAVAILABLE`). `ready` settles with the first grant, `pending`
 * with the one asked last. `probe` stands for the machine's own.
 */
export function holdWorldDevice(
  regranted: (lostAt: number) => void,
  probe: () => Promise<GPUDevice> = probeWorldDevice,
) {
  let gpuDevice: GPUDevice | undefined,
    disposed = false
  const grant = (): Promise<void> =>
    probe().then((granted) => {
      // A world disposed while its device was asked for keeps nothing it was granted.
      if (disposed) return granted.destroy()
      gpuDevice = granted
      void granted.lost.then((info) => {
        if (disposed || info.reason === 'destroyed' || gpuDevice !== granted) return
        console.warn('World GPU device lost, asking for another:', info.message)
        const lostAt = cpuNow()
        gpuDevice = undefined
        pending = grant()
        // Granted or not, the session reopens: it waits on `pending`, and reports a refusal.
        const reopen = () => regranted(lostAt)
        pending.then(reopen, reopen)
      })
    })
  let pending = grant()
  // A refusal is the world's `ready` to report, never an unhandled rejection.
  pending.catch(() => {})
  return {
    ready: pending,
    /** The grant asked last: a session opens once it settles, never in a device's absence. */
    get pending() {
      return pending
    },
    /** The device every session opens on, `undefined` while one is asked again. */
    get gpuDevice() {
      return gpuDevice
    },
    /** Gives the device back; a grant still pending is given back when it arrives. */
    dispose() {
      disposed = true
      gpuDevice?.destroy()
    },
  }
}
