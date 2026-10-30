/**
 * Which lit program a frame asks for, past its bounce: what it leaves out. `sunless` and
 * `localless` leave out the shadow read of one kind of light — a sun's clipmap, a local light's map
 * (`ShadowKinds`) — where every shadowed light of the scene is of the other; never set beside
 * `unshadowed`, which leaves out both.
 */
export type ContractKey = {
  narrow: boolean
  unshadowed: boolean
  rectless: boolean
  sunless: boolean
  localless: boolean
  /** No surface the pass lights carries an anisotropic or clear-coat lobe: no lobe code
   *  (`../direct/lobesWgsl.ts`) — the opaque lit passes' surfaces, the translucent items. */
  lobeless: boolean
  /** No light of the scene casts a contact shadow of its own and no surface of the pass is of the eye or
   *  hair model: no contact shadow code (`../contactShadow/contactShadowWgsl.ts`). The frame's cut: the
   *  translucent programs' is the scene's (`TranslucentScene`, `../../blend/shader.ts`). */
  contactless: boolean
  /** Every light and every object the scene lights is in the default lighting channel (channel 0 alone): no
   *  light is left out of a surface by its channels, so no test of them
   *  (`../direct/lightLoopWgsl.ts`, `lightChannelsOf`). The cut of a scene that uses none. */
  channelless: boolean
  /** No light of the scene names a light profile: no profile read, no atlas and no sampler bound
   *  (`../lightProfile/lightProfileWgsl.ts`, `NO_LIGHT_PROFILE_WGSL`). The cut of a scene that uses none. */
  profileless: boolean
  /** The image sets no ambient cubemap: no cube read in the indirect pass, no cube, sampler or colour bound
   *  (`ambientCubemapWgsl.ts`). The opaque lit passes' alone: a translucent program's key leaves the cube out. */
  cubeless: boolean
  /** The image makes no reflection capture: no capture read in the indirect pass, no cube array, sampler nor records bound (`reflectionCapture/localLightWgsl.ts`).
   *  The opaque lit passes' alone. Left out, the code is kept. */
  captureless?: boolean
  /** The sampled lighting lights the local lights (`manyLightsSampled`): the local lights' pass adds the light it left (`sampledLight`) in place of walking the lights,
   *  and no light is lit one by one. Left out, false. Kept by the twin, and by every program that serves a frame of this cut. */
  sampled?: boolean
  /** The sampled lighting lights the directional lights too: the sun's pass lights none. Left out, false. */
  sampledSun?: boolean
  /** The image holds the shadows the heterogeneous volumes cast (`heterogeneousVolumesShadows` on, a volume in the scene): the opaque lit
   *  passes read them (`beerShadowReadWgsl.ts`) and bind their buffer. Left out, false: no read, no binding. */
  volumeShadow?: boolean
  /** The lit passes write the toon data (`toonUnifiedDiffuse`): the diffuse light of each toon pixel, unramped, with its weight and weighted cosine, in two more targets
   *  of the lit image's pass, which the step after the lights applies the ramp to. Not a cut: a program of its own, made when the frame asks (`createContractVariants`). Left out, false. */
  toonData?: boolean
}

/** The passes whose programs are keyed on a `ContractKey`: the opaque lit passes', and the forward
 *  one (`contractVariants.ts`). */
export type LitPass = 'opaque' | 'blend'
type Cut = Exclude<keyof ContractKey, 'narrow' | 'toonData'>

/** What a program can leave out besides its lists' width — bit `k` of a set is `CUTS[k]` —: every
 *  pass, opaque or blend, makes every cut, each read off what that pass lights
 *  (`../../frame/prepare/contractLight.ts`). */
export const CUTS: readonly Cut[] = [
  'unshadowed',
  'rectless',
  'sunless',
  'localless',
  'lobeless',
  'contactless',
  'channelless',
  'profileless',
  'cubeless',
  'sampled',
  'sampledSun',
  'volumeShadow',
  'captureless',
]
export const CUT_COUNT = CUTS.length
/** The bit of cut `name` in a set, read off `CUTS`'s order. */
const cutBit = (name: Cut) => 1 << CUTS.indexOf(name)
const UNSHADOWED = cutBit('unshadowed'),
  KINDS = cutBit('sunless') | cutBit('localless'),
  SAMPLED = cutBit('sampled') | cutBit('sampledSun')
/** The lobe cut's and the contact cut's bits: the only cuts a program's twin keeps (`twinOf`). */
const LOBELESS_BIT = CUTS.indexOf('lobeless'),
  LOBELESS = cutBit('lobeless'),
  CONTACTLESS = cutBit('contactless')
/** The set of cuts of a program that holds no contact shadow code: a set with the cut. */
export const withoutContactSet = (set: number) => set | CONTACTLESS

/** The suffix of the name of a program that leaves out what `key` says. */
export const variantLabel = (key: Partial<ContractKey>) =>
  `${key.narrow ? '_NARROW' : ''}${CUTS.map((name) => (key[name] ? `_${name.toUpperCase()}` : '')).join('')}${key.toonData ? '_TOON_DATA' : ''}`

/** The key of a program with every code path but the lobes and the contact shadows (which need the lit
 *  passes' depth): what a lighting builder compiles when handed no key. A key's missing cut is code
 *  kept. */
export const LOBELESS_KEY: Readonly<Partial<ContractKey>> = { lobeless: true, contactless: true }

/** The key of the program with every code path: it serves any scene. */
export const FULL_CONTRACT: Readonly<ContractKey> = {
  narrow: false,
  unshadowed: false,
  rectless: false,
  sunless: false,
  localless: false,
  lobeless: false,
  contactless: false,
  channelless: false,
  profileless: false,
  cubeless: false,
  captureless: false,
  sampled: false,
  sampledSun: false,
  volumeShadow: false,
}

/** The set of cuts `key` makes; `lobed`, when given, says the lobe cut in its place. Read by every
 *  pass of every frame: a plain loop, no closure. */
export function cutsIn(key: Partial<ContractKey>, lobed = !key.lobeless) {
  let set = lobed ? 0 : LOBELESS
  for (let bit = 0; bit < CUTS.length; bit++)
    if (bit !== LOBELESS_BIT && key[CUTS[bit]]) set |= 1 << bit
  return set
}

/** The key of a set of cuts, at a lists' width: one object, written cut by cut. */
export function keyOf(narrow: boolean, set: number) {
  const key = { narrow } as ContractKey
  for (let bit = 0; bit < CUTS.length; bit++) key[CUTS[bit]] = !!(set & (1 << bit))
  return key
}

/** The set of a program's twin: every code path but the lobes and the contact shadows, which only a
 *  scene whose surfaces carry a lobe, or whose lights cast a ray, compiles (`createLitVariants`). The twin keeps the
 *  test of the lighting channels, as it keeps the shadow and rectangle code: the wide program a scene with none of
 *  them compiles beside its own, which lights a light or an object put in a channel at once (a program that holds
 *  the test serves the frame meanwhile, `SERVING`); and the light profile code, which a scene with no profiled
 *  light leaves out of its own, bound to the stand-in atlas where the frame has none; and the ambient cubemap's code, bound
 *  to the stand-in cube and a black colour where the image sets none. */
export const twinOf = (set: number) => set & (LOBELESS | CONTACTLESS | SAMPLED)

/** Whether `key` is a twin's: it leaves out no code but, maybe, the lobes' and the contact shadows'. */
export const isTwin = (key: Partial<ContractKey>) =>
  !(cutsIn(key) & ~(LOBELESS | CONTACTLESS | SAMPLED))

/** The sets of cuts of the programs that serve a frame of cuts `set`, the most cuts first — the
 *  closest fit: a program serves the frames that keep what it leaves out. An unshadowed frame
 *  keeps no shadow read of either kind, so a program that leaves out one kind serves it too. No
 *  key leaves out a kind beside `unshadowed`, nor both kinds (`ContractKey`): no such set is a
 *  program. */
const serving = (set: number) => {
  const served = set & UNSHADOWED ? set | KINDS : set
  const sets: number[] = []
  for (let own = served; ; own = (own - 1) & served) {
    // A program lights the sampled lights in a way no other does: only the frames of the very same sampled cuts are served by it.
    if (
      !(own & UNSHADOWED && own & KINDS) &&
      (own & KINDS) !== KINDS &&
      (own & SAMPLED) === (set & SAMPLED)
    )
      sets.push(own)
    if (!own) break
  }
  const size = (n: number) => n.toString(2).replace(/0/g, '').length
  return sets.sort((x, y) => size(y) - size(x) || x - y)
}
/** `SERVING[set]`: the sets that serve a frame of cuts `set`, closest first. */
export const SERVING = Array.from({ length: 1 << CUTS.length }, (_, set) => serving(set))
