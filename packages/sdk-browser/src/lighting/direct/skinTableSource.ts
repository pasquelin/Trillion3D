import {
  SKIN_TABLE_FILE_BYTES,
  skinTableWords,
} from '../../../../sdk-core/src/lighting/skinTable.ts'
import { shippedBytes, sourceBytes, type ByteSource } from '../../geometry/cluster/shippedBytes.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { wantsPixelModels } from '../../materials/surface/subsurface.ts'
import { LIGHT_BUFFER_AT } from '../../frame/backend/state/lightBufferLayout.ts'

/**
 * THE PREINTEGRATED SKIN TABLE, as the file it ships in (`skinTable.ts`): read
 * once, when a scene holds a surface that may wear the skin model, and written into the light buffer
 * (`LIGHT_BUFFER_AT.skin`), where the lighting reads it. Until it is there the table reads zero: a skin
 * transmits no light. The host may supply the bytes — Node cannot follow a file URL with `fetch`.
 */
let pending: Promise<Uint32Array> | undefined
let loaded: Uint32Array | undefined
let failed = false
let asked = false

/** The file as a page fetches it: beside the module, by its URL. */
const resource = () => shippedBytes(new URL('./skinTable.bin', import.meta.url).href)

/** The table's words, read once; a failed read is asked again at the next call. */
function skinTableLoaded(source: ByteSource = resource): Promise<Uint32Array> {
  pending ??= (async () => {
    const bytes = await sourceBytes(source)
    if (bytes.length !== SKIN_TABLE_FILE_BYTES)
      throw new RangeError(
        `the skin table holds ${bytes.length} bytes, not ${SKIN_TABLE_FILE_BYTES}`,
      )
    return (loaded = skinTableWords(bytes))
  })().catch((error: unknown) => {
    pending = undefined
    throw error
  })
  return pending
}

const written = new WeakSet<GPUBuffer>()

/** At a frame's end of lights: the table written into the light buffer `buffer` once, if a surface may
 *  wear the skin model — its reading begun the first frame it is asked, a failure named once. */
export function followSkinTable(rt: WebgpuPagesRuntime, device: GPUDevice, buffer: GPUBuffer) {
  if (written.has(buffer) || failed || !wantsPixelModels(rt)) return
  if (!loaded) {
    if (asked) return
    asked = true
    skinTableLoaded()
      // The table is there: the image is drawn again, a still one included.
      .then(() => rt.run.gate.resourcesChanged())
      .catch((error: unknown) => {
        failed = true
        rt.diag.engineDiagnostic('skin-table-unreadable', 'The skin table could not be read', {
          reason: String(error),
        })
      })
    return
  }
  device.queue.writeBuffer(buffer, LIGHT_BUFFER_AT.skin, loaded as Uint32Array<ArrayBuffer>)
  written.add(buffer)
}
