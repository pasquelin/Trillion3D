/**
 * Where a pass sits relative to the temporal pass and the display curve: on the lit image, before
 * the temporal pass resolves it (`before-resolve`); on the image the temporal pass resolved, before
 * its exposure is measured and before every other pass (`after-resolve`); on the scene's linear
 * radiance, before the exposure and the curve bring it into the display range; or on the display
 * image they made.
 */
export type EffectStage =
  'before-resolve' | 'after-resolve' | 'before-tone-mapping' | 'after-tone-mapping'

/** The built-in passes an engine knows how to draw. */
export type EffectKind = 'depthOfField' | 'motionBlur' | 'bloom' | 'outline'

/**
 * One pass of the chain. A pass says which built-in it is and where it runs; its settings are
 * properties whose write reaches the world at once, like a light's.
 */
export abstract class EffectPass {
  /** Which built-in pass this is. */
  abstract readonly kind: EffectKind
  /** Where it runs: on the lit image before the temporal pass, on the image the pass resolved, before
   *  tone mapping, or over the display image after it. */
  abstract readonly stage: EffectStage
  /** @internal The chain that holds the pass, told when a setting changes; `null` outside one. */
  _chain: EffectChain | null = null
  /** True while the pass has nothing to draw — an outline of no object —: the engine passes it
   *  by, drawing and allocating nothing for it. */
  get idle() {
    return false
  }
  /** A setting changed: the chain's image is to be drawn again. */
  protected changed() {
    this._chain?._touch()
  }
}

/**
 * `world.effects`: the ordered passes drawn over the image around temporal antialiasing and before
 * it reaches the canvas. The passes that run on the lit image, before the temporal pass, come
 * first, whatever their place in the chain; those that run on the resolved image read it next, in the
 * order they were added; those that run before tone mapping read the linear radiance, in theirs;
 * those that run after draw over the display image, in theirs. An empty
 * chain, or one whose passes are all idle, costs nothing: no pass, no copy, no target. A
 * transparent surface blending in `multiply` or `subtractive` is drawn under the chain like any
 * other. The depth of field does not blur the translucent surfaces: they are composed onto the
 * image it leaves — but those that lie deeper than twice its focus distance, which it blurs.
 */
export class EffectChain {
  private readonly list: EffectPass[] = []
  private readonly byStage = new Map<EffectStage, EffectPass[]>()
  private count = 0
  private readonly notify: () => void
  /**
   * @param changed - Runs after every change of the chain or of one of its passes.
   * @param passes - The passes the chain starts with, in order: none of them is a change.
   */
  constructor(changed: () => void = () => {}, passes: readonly EffectPass[] = []) {
    this.notify = changed
    this.list.push(...passes)
    for (const pass of passes) pass._chain = this
  }
  /** Counts the changes: an image drawn at another revision is out of date. */
  get revision() {
    return this.count
  }
  /** The passes, in the order they run. */
  get passes(): readonly EffectPass[] {
    return this.list
  }
  /** How many passes the chain holds. */
  get size() {
    return this.list.length
  }
  /**
   * Puts a pass in the chain, last or at `index`. A pass belongs to one chain at a time.
   * @param pass - The pass to add, from the `effect` family.
   * @param index - Where it goes; the end when absent.
   */
  add(pass: EffectPass, index = this.list.length) {
    if (!(pass instanceof EffectPass)) throw new TypeError('EFFECT_UNKNOWN')
    if (pass._chain) throw new Error('EFFECT_IN_A_CHAIN')
    if (!Number.isInteger(index) || index < 0 || index > this.list.length)
      throw new RangeError(`EFFECT_INDEX:${index}`)
    this.list.splice(index, 0, pass)
    pass._chain = this
    this.reordered()
    return this
  }
  /**
   * Takes a pass out of the chain; false when it was not in it.
   * @param pass - The pass to remove.
   */
  remove(pass: EffectPass) {
    const index = this.list.indexOf(pass)
    if (index < 0) return false
    this.list.splice(index, 1)
    pass._chain = null
    this.reordered()
    return true
  }
  /** Takes every pass out: the image is the one without the chain again. */
  clear() {
    if (!this.list.length) return
    for (const pass of this.list) pass._chain = null
    this.list.length = 0
    this.reordered()
  }
  /**
   * The passes of one stage, in chain order: the list an engine runs. Kept from change to change,
   * so a frame allocates nothing.
   * @param stage - Before or after tone mapping.
   */
  stage(stage: EffectStage): readonly EffectPass[] {
    let passes = this.byStage.get(stage)
    if (!passes) this.byStage.set(stage, (passes = this.list.filter((p) => p.stage === stage)))
    return passes
  }
  /** The list changed: the stage lists are made again at their next read. */
  private reordered() {
    this.byStage.clear()
    this._touch()
  }
  /** @internal The chain or one of its passes changed; a pass never changes stage. */
  _touch() {
    this.count++
    this.notify()
  }
}
