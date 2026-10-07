/**
 * The kinds of light whose shadow a lit program reads: a sun's (the clipmap, `directional` in the
 * shadow reads) and a local light's (a point's cube faces, a spot's map). A program compiled for one
 * kind holds the other's read in no function: the key of the lit programs says which a scene's
 * lights use (`contractKey`, `../deferred/contractVariants.ts`), as the projection pass is compiled
 * with its lights' kinds (`VSM_PROJECTION_KINDS`).
 */
export type ShadowKinds = { sun: boolean; local: boolean }

/** Both kinds: the program every scene can be lit by. */
export const ALL_SHADOW_KINDS: Readonly<ShadowKinds> = { sun: true, local: true }

/** The kinds as a block name reads them: the sun's, then the local light's. */
export const shadowKindsLabel = ({ sun, local }: ShadowKinds) => `${sun}, ${local}`

/** The kinds a key names: what it leaves out (`sunless`, `localless`) is not read. */
export const shadowKindsOf = ({
  sunless,
  localless,
}: {
  sunless?: boolean
  localless?: boolean
}): ShadowKinds => ({ sun: !sunless, local: !localless })

/**
 * A shadow read's body: the sun's branch `sun` and the local light's `local` as the full program
 * holds them (`if(directional)` the sun's, which returns), each alone where the program reads one
 * kind only. Each branch is the same text in every program.
 */
export const byShadowKind = (
  { sun, local }: ShadowKinds,
  sunBranch: string,
  localBranch: string,
) =>
  sun && !local
    ? sunBranch
    : local && !sun
      ? localBranch
      : `if(directional){\n${sunBranch}\n }\n${localBranch}`
