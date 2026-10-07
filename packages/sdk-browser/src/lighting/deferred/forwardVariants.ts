import { FULL_CONTRACT, cutsIn, isTwin, twinOf, type ContractKey } from './contractCuts.ts'
import { createLitVariants, type LitPrograms } from './contractVariants.ts'

/** What a forward pass is told of the lit programs (`LitPrograms`): the key a first frame asks for
 *  while `precompile`, and whom a failed compile is said to. */
export type ForwardLit = Pick<LitPrograms, 'precompile' | 'key' | 'onFailure'>

/**
 * A forward pass's lit programs — the blends' (`../../webgpu/blend/pipelines.ts`), the water
 * composite's (`../../webgpu/water/frame.ts`) —, which light with the opaque resolve's loop
 * (`declaredLightingWgsl`) and so take its programs without shadow, rectangle or lobe code
 * (`createLitVariants`), never bounce or narrow lists, which they do not read: a first frame's
 * narrow key asks for the wide program. Prepare compiles the one a first frame asks for and its
 * twin, and waits for both; a frame picks on the opaque resolve's key (`directLightResources`) and
 * the pass's own lobes (`lobed`, read off its items), lent the twin while another compiles; a
 * lobed frame is held until a lobed program lands instead (`awaited`, `askLobedPrograms`). The
 * twin's failure is the pass's own (thrown); another's is said (`onFailure`), the twin lighting in
 * its place.
 */
export async function createForwardVariants<P>(
  build: (key: ContractKey) => Promise<P>,
  lit: ForwardLit | undefined,
) {
  let failure: unknown
  const variants = createLitVariants((_bounce, key) =>
    build(key).catch((error: unknown) => {
      if (isTwin(key)) failure = error
      else lit?.onFailure?.(error)
      throw error
    }),
  )
  const first = lit?.precompile
    ? { ...lit.key, narrow: false }
    : { ...FULL_CONTRACT, lobeless: !!lit?.key.lobeless }
  await variants.precompile(false, first)
  const twin = variants.pick(false, false, twinOf(cutsIn(first)))
  if (!twin) throw failure
  return {
    /** The program that lights a frame of the lights' key `key` whose items carry a lobe or not. */
    pick: (key: Partial<ContractKey>, lobed: boolean) =>
      variants.pick(false, false, cutsIn(key, lobed)) ?? twin,
    /** The program of `key` once compiled, asked now: none if it and its stand-in failed. */
    ready: (key: Partial<ContractKey>) => variants.ready(false, false, cutsIn(key)),
    /** The compile a frame of `key` waits for while no ready program lights it, asked now. */
    awaited: (key: Partial<ContractKey>) => variants.awaited(false, false, cutsIn(key)),
    /** The program prepare compiled beside the first: what any frame of the pass can be lit by. */
    twin,
  }
}
