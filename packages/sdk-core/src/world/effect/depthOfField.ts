import { EffectPass } from './chain.ts'
import {
  depthOfFieldIdle,
  resolveDepthOfField,
  type DepthOfFieldOptions,
  type MatteBoxFlag,
  type ResolvedDepthOfField,
  type ResolvedMatteBoxFlag,
} from '../../contracts/depthOfFieldOptions.ts'

export type {
  DepthOfFieldOptions,
  MatteBoxFlag,
  ResolvedDepthOfField,
  ResolvedMatteBoxFlag,
} from '../../contracts/depthOfFieldOptions.ts'

/**
 * What a lens does to a scene that is not all at the distance it is focused on: each pixel's depth
 * gives it a circle of confusion from the lens (its aperture, the focus, the camera's field of view
 * on a sensor of `sensorWidth`), and the image is blurred by those circles, the foreground and the
 * background each as a layer, in the shape of the diaphragm's blades (`../../contracts/depthOfFieldOptions.ts`
 * says each setting and its default; how the blur is drawn — its quality above all — is the world's
 * settings', `../../contracts/depthOfFieldRules.ts`). It runs on the lit image at the size it is drawn,
 * before the temporal pass resolves it — the pass stabilises its own setup in time — and so before the
 * motion blur, wherever it is added, and is OFF until `focusDistance` (or `depthBlurRadius`) is above 0:
 * the engine passes it by then, drawing and allocating nothing for it.
 */
export class DepthOfField extends EffectPass {
  readonly kind = 'depthOfField'
  readonly stage = 'before-resolve'
  private held: ResolvedDepthOfField
  constructor(options: DepthOfFieldOptions = {}) {
    super()
    this.held = resolveDepthOfField(options)
  }
  private write(options: DepthOfFieldOptions) {
    this.held = resolveDepthOfField({ ...this.held, ...options })
    this.changed()
  }
  /** The depth of field as the engine reads it: every setting. */
  get values(): ResolvedDepthOfField {
    return this.held
  }
  /** The volume's switch; off draws nothing. */
  get enabled() {
    return this.held.enabled
  }
  set enabled(value: boolean) {
    this.write({ enabled: value })
  }
  /** The distance in focus, in metres; 0 is off. */
  get focusDistance() {
    return this.held.focusDistance
  }
  set focusDistance(value: number) {
    this.write({ focusDistance: value })
  }
  /** The lens' f-stop, 1 to 32: the larger, the more of the scene is in focus. */
  get aperture() {
    return this.held.aperture
  }
  set aperture(value: number) {
    this.write({ aperture: value })
  }
  /** The f-stop of the lens' widest opening, 0 to 32. */
  get minAperture() {
    return this.held.minAperture
  }
  set minAperture(value: number) {
    this.write({ minAperture: value })
  }
  /** Blades of the diaphragm, 4 to 16. */
  get bladeCount() {
    return this.held.bladeCount
  }
  set bladeCount(value: number) {
    this.write({ bladeCount: value })
  }
  /** The sensor's width, in millimetres. */
  get sensorWidth() {
    return this.held.sensorWidth
  }
  set sensorWidth(value: number) {
    this.write({ sensorWidth: value })
  }
  /** An anamorphic lens' squeeze factor, 0.1 to 10. */
  get squeezeFactor() {
    return this.held.squeezeFactor
  }
  set squeezeFactor(value: number) {
    this.write({ squeezeFactor: value })
  }
  /** A multiplier of the image's aspect ratio the sensor's is taken from, 0 or more. */
  get aspectRatioScalar() {
    return this.held.aspectRatioScalar
  }
  set aspectRatioScalar(value: number) {
    this.write({ aspectRatioScalar: value })
  }
  /** The depth, in kilometres, at which the depth blur reaches half its radius. */
  get depthBlurAmount() {
    return this.held.depthBlurAmount
  }
  set depthBlurAmount(value: number) {
    this.write({ depthBlurAmount: value })
  }
  /** The radius of the depth blur, in pixels of a 1920-pixel image; above 0 it turns the pass on. */
  get depthBlurRadius() {
    return this.held.depthBlurRadius
  }
  set depthBlurRadius(value: number) {
    this.write({ depthBlurRadius: value })
  }
  /** The strength and sign of a Petzval lens' swirl, −10 to 10; 0 is none. */
  get petzvalBokeh() {
    return this.held.petzvalBokeh
  }
  set petzvalBokeh(value: number) {
    this.write({ petzvalBokeh: value })
  }
  /** How fast the swirl grows from the centre, 0 to 100. */
  get petzvalFalloff() {
    return this.held.petzvalFalloff
  }
  set petzvalFalloff(value: number) {
    this.write({ petzvalFalloff: value })
  }
  /** The box in the middle of the image the swirl leaves alone, its width and height as shares of
   *  the image's, 0 to 1. */
  get petzvalExclusionBox(): readonly [number, number] {
    return [this.held.petzvalExclusionBoxWidth, this.held.petzvalExclusionBoxHeight]
  }
  set petzvalExclusionBox(value: readonly [number, number]) {
    this.write({ petzvalExclusionBoxWidth: value[0], petzvalExclusionBoxHeight: value[1] })
  }
  /** The corner radius of that box, 0 to 1. */
  get petzvalExclusionRadius() {
    return this.held.petzvalExclusionRadius
  }
  set petzvalExclusionRadius(value: number) {
    this.write({ petzvalExclusionRadius: value })
  }
  /** The lens barrel's radius, in centimetres, 0 or more. */
  get barrelRadius() {
    return this.held.barrelRadius
  }
  set barrelRadius(value: number) {
    this.write({ barrelRadius: value })
  }
  /** The lens barrel's length, in centimetres, 0 or more; 0 is no barrel. */
  get barrelLength() {
    return this.held.barrelLength
  }
  set barrelLength(value: number) {
    this.write({ barrelLength: value })
  }
  /** The matte box's three flags; a write takes the flags and fields it names and leaves the rest. */
  get matteBox(): readonly ResolvedMatteBoxFlag[] {
    return this.held.matteBox
  }
  set matteBox(value: readonly MatteBoxFlag[]) {
    this.write({ matteBox: this.held.matteBox.map((flag, at) => ({ ...flag, ...value[at] })) })
  }
  /** Nothing to draw while it is switched off or has neither a focus distance nor a depth blur
   *  radius above 0: the engine passes it by. */
  override get idle() {
    return depthOfFieldIdle(this.held)
  }
}
