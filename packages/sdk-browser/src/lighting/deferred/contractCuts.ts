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
   *  hair model: no contact shadow code (`../contactShadow/contactShadowWgsl.ts`). The translucent
   *  programs hold none, whatever their key says (`translucentLitKey`, `../../blend/shader.ts`). */
  contactless: boolean
}

/** The passes whose programs are keyed on a `ContractKey`: the opaque lit passes', and the forward
 *  one (`contractVariants.ts`). */
export type LitPass = 'opaque' | 'blend'
type Cut = Exclude<keyof ContractKey, 'narrow'>

/** What a program can leave out besides its lists' width — bit `k` of a set is `CUTS[k]` —: every
 *  pass, opaque or blend, makes every cut, each read off what that pass lights
 *  (`../../frame/prepare/contractLight.ts`). */
const CUTS: readonly Cut[] = [
  'unshadowed',
  'rectless',
  'sunless',
  'localless',
  'lobeless',
  'contactless',
]
export const CUT_COUNT = CUTS.length
/** The bit of cut `name` in a set, read off `CUTS`'s order. */
const cutBit = (name: Cut) => 1 << CUTS.indexOf(name)
const UNSHADOWED = cutBit('unshadowed'),
  KINDS = cutBit('sunless') | cutBit('localless')
/** The lobe cut's and the contact cut's bits: the only cuts a program's twin keeps (`twinOf`). */
const LOBELESS_BIT = CUTS.indexOf('lobeless'),
  LOBELESS = cutBit('lobeless'),
  CONTACTLESS = cutBit('contactless')
/** The set of cuts of a program that holds no contact shadow code: a set with the cut. */
export const withoutContactSet = (set: number) => set | CONTACTLESS

/** The suffix of the name of a program that leaves out what `key` says. */
export const variantLabel = (key: Partial<ContractKey>) =>
  `${key.narrow ? '_NARROW' : ''}${CUTS.map((name) => (key[name] ? `_${name.toUpperCase()}` : '')).join('')}`

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
 *  scene whose surfaces carry a lobe, or whose lights cast a ray, compiles (`createLitVariants`). */
export const twinOf = (set: number) => set & (LOBELESS | CONTACTLESS)

/** Whether `key` is a twin's: it leaves out no code but, maybe, the lobes' and the contact shadows'. */
export const isTwin = (key: Partial<ContractKey>) => !(cutsIn(key) & ~(LOBELESS | CONTACTLESS))

/** The sets of cuts of the programs that serve a frame of cuts `set`, the most cuts first — the
 *  closest fit: a program serves the frames that keep what it leaves out. An unshadowed frame
 *  keeps no shadow read of either kind, so a program that leaves out one kind serves it too. No
 *  key leaves out a kind beside `unshadowed`, nor both kinds (`ContractKey`): no such set is a
 *  program. */
const serving = (set: number) => {
  const served = set & UNSHADOWED ? set | KINDS : set
  const sets: number[] = []
  for (let own = served; ; own = (own - 1) & served) {
    if (!(own & UNSHADOWED && own & KINDS) && (own & KINDS) !== KINDS) sets.push(own)
    if (!own) break
  }
  const size = (n: number) => n.toString(2).replace(/0/g, '').length
  return sets.sort((x, y) => size(y) - size(x) || x - y)
}
/** `SERVING[set]`: the sets that serve a frame of cuts `set`, closest first. */
export const SERVING = Array.from({ length: 1 << CUTS.length }, (_, set) => serving(set))
