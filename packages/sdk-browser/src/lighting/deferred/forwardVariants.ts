import { FULL_CONTRACT, cutsIn, isTwin, twinOf, type ContractKey } from './contractCuts.ts'
import { createLitVariants, type LitPrograms } from './contractVariants.ts'

/** What a forward pass is told of the lit programs (`LitPrograms`): the key a first frame asks for
 *  while `precompile`, and whom a failed compile is said to. */
export type ForwardLit = Pick<LitPrograms, 'precompile' | 'key' | 'onFailure'>

/**
 * A forward pass's lit programs — the translucent layers' (`../../blend/pipelines.ts`) —,
 * which light with the opaque lit passes' loop
 * (`declaredLightingWgsl`) and so take its programs without shadow, rectangle or lobe code
 * (`createLitVariants`), never bounce or narrow lists, which they do not read: a first frame's
 * narrow key asks for the wide program. Prepare compiles the one a first frame asks for, and waits
 * for it; a frame picks on the opaque lit passes' key (`directLightResources`) and the pass's own
 * lobes (`lobed`, read off its items), lent a ready program that serves it alone — one that leaves
 * out no code the frame needs, never a stand-in lacking a shadow, a rectangle or a lobe —, none
 * while its own compiles. The frame is held for that compile from its entry (`awaited`,
 * `askBlendReach`, which reads the lights' key before the lights move the image), as a lobed one is
 * (`askLobedPrograms`). The first program's failure falls to the twin, whose own is the pass's
 * (thrown); another's is said (`onFailure`), the program with every code path lighting in its
 * place, compiled then.
 */
export async function createForwardVariants<P>(
  build: (key: ContractKey) => Promise<P>,
  lit: ForwardLit | undefined,
) {
  let failure: unknown
  const variants = createLitVariants(
    (_bounce, key) =>
      build(key).catch((error: unknown) => {
        if (isTwin(key)) failure = error
        else lit?.onFailure?.(error)
        throw error
      }),
    { twins: false },
  )
  const first = lit?.precompile
    ? { ...lit.key, narrow: false }
    : { ...FULL_CONTRACT, lobeless: !!lit?.key.lobeless }
  await variants.precompile(false, first)
  // The first program, else its twin when it failed.
  const twinSet = twinOf(cutsIn(first))
  const base =
    (await variants.ready(false, false, cutsIn(first))) ??
    (await variants.ready(false, false, twinSet))
  if (!base) throw failure
  return {
    /** The program that lights a frame of the lights' key `key` whose items carry a lobe or not, asked
     *  now: the best ready one that serves it, none while its own compiles (`awaited`). */
    pick: (key: Partial<ContractKey>, lobed: boolean) =>
      variants.pick(false, false, cutsIn(key, lobed)),
    /** The program of `key` once compiled, asked now: none if it and its stand-in failed. */
    ready: (key: Partial<ContractKey>) => variants.ready(false, false, cutsIn(key)),
    /** The compile a frame of `key` (`lobed`: its items carry a lobe, else the key's own) waits
     *  for while no ready program serves it, asked now; none once one does. */
    awaited: (key: Partial<ContractKey>, lobed = !key.lobeless) =>
      variants.awaited(false, false, cutsIn(key, lobed)),
    /** The program prepare compiled: what any frame of the pass can be lit by. */
    base,
  }
}
