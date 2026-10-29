/**
 * THE RENDER OVERRIDES OF A VIEW: what a view drawn for a capture turns off or forces, one field
 * for each switch, read by the passes it concerns through `rt.views.active.overrides`. The main
 * view and every view drawn for the page hold `NO_OVERRIDES`, every field at its neutral value:
 * its passes read it as one boolean on the CPU, and no shader of the main path reads a word of it
 * (the surface rewrite below is a pass of its own, encoded only for a view that asks for it).
 *
 * - `skyLighting`: the sky light lights the view; off, its colour is black
 *   (`skyLightColor`'s `skyLighting`, `../../../modules/sky/skyLight/read.ts`);
 * - `lighting`: the declared lights, the probes, the reflections and the ambient occlusion light
 *   the view; off, the lit image holds only what the surfaces emit (`lit` and `encodeDirectLights`);
 * - `reflections`: the scene's reflections are traced for the view (and, with `lighting`, lit by
 *   it); off, none is;
 * - `roughness`: the surface roughness becomes `saturate(r) * range + min` before any light reads it;
 *   none, the roughness as the material gives it;
 * - `diffuse`, `specular`: `colour * w + xyz` on the diffuse colour and on the specular one; none,
 *   the surface's own. The specular colour is no texel of this engine's surfaces: a specular
 *   override of zero removes the reflections (`reflects`), and no other value is read;
 * - `particles`, `lightShafts`, `lightFunctions`: the particle pools, the light shafts and the
 *   light functions are drawn; `post`: the effects, the exposure, the finishing, the composition
 *   and the temporal pass are run, off the lit image is the view's output (`readLit`);
 * - `staticSceneOnly`: only what has static lighting is drawn (no surface of this engine has);
 * - `lodScale`: the factor the cut's screen-space tolerance is divided by, to ask more detail;
 * - `reflectionCapture`: the view is a capture of the scene that lights it (the sky light's captured
 *   scene), not a view of the page; the height fog then shows by its `inReflectionCaptures` and not by
 *   its `inMainView` (`../../render/fogView.ts`);
 * - `readLit`: handed the encoder and the lit image (linear HDR, before exposure and any effect)
 *   of every image the view draws, ahead of the lit image's turn (`adoptLitImage`).
 */
export interface ViewOverrides {
  readonly skyLighting: boolean
  readonly lighting: boolean
  readonly reflections: boolean
  readonly roughness?: { readonly min: number; readonly range: number }
  readonly diffuse?: readonly [number, number, number, number]
  readonly specular?: readonly [number, number, number, number]
  readonly particles: boolean
  readonly lightShafts: boolean
  readonly lightFunctions: boolean
  readonly post: boolean
  readonly staticSceneOnly: boolean
  readonly lodScale: number
  readonly reflectionCapture: boolean
  readonly readLit?: LitReader
}

/** What reads the lit image of a view: its encoder, the image's view (level 0 of the HDR target),
 *  the size drawn in it, of the target allocated, and the view's depth. */
type LitReader = (
  encoder: GPUCommandEncoder,
  lit: GPUTextureView,
  drawn: readonly number[],
  allocated: readonly number[],
  depth: GPUTextureView | undefined,
) => void

/** The overrides of a view that overrides nothing. */
export const NO_OVERRIDES: ViewOverrides = Object.freeze({
  skyLighting: true,
  lighting: true,
  reflections: true,
  particles: true,
  lightShafts: true,
  lightFunctions: true,
  post: true,
  staticSceneOnly: false,
  lodScale: 1,
  reflectionCapture: false,
})

/** Whether the view rewrites its surfaces' roughness or diffuse colour (`encodeSurfaceRewrite`). */
export const rewritesSurfaces = (o: ViewOverrides) => !!o.roughness || !!o.diffuse

const isZero = (v: readonly number[] | undefined) => !!v && v.every((x) => x === 0)

/** Whether the view's surfaces reflect: it is lit, traces reflections, and its specular colour is
 *  not forced to zero. */
export const reflects = (o: ViewOverrides) => o.lighting && o.reflections && !isZero(o.specular)
