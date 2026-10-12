import { requireSdkWasm, type SdkWasm } from '../../../wasm/sdkWasm.ts'
import { WASM_ARENA_CONTRACT } from '../../../wasm/wasmArena.ts'

/**
 * The module the math batches run in: the SDK one, already loaded for page reading
 * (`../../../webgpu/pages/readPage.ts`), so no second instantiation and no second linear memory.
 * The batches have one path, its kernels: a module that is missing, or whose compute contract is
 * not the one this loader expects, is refused by name, as the page reader refuses it.
 */

let pending: Promise<SdkWasm> | null = null

/** The module, loaded once for the session and checked against the batches' contract. */
export function mathBatchModule(): Promise<SdkWasm> {
  pending ??= (async () => {
    const wasm = await requireSdkWasm()
    const contract = typeof wasm.math_contract === 'function' ? wasm.math_contract() : 0
    if (contract !== WASM_ARENA_CONTRACT)
      throw new Error(
        `SDK_WASM_CONTRACT: computation contract ${contract}; this loader expects ${WASM_ARENA_CONTRACT}`,
      )
    return wasm
  })()
  return pending
}
