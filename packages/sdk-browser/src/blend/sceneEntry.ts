import { wgslFn } from '../../../math/src/wgsl/decl.ts'

/**
 * THE FRAGMENT ENTRIES OF THE LAYERS read the scene (its depth, lights, masks, probes) at their pixel. A layer drawn into targets smaller than
 * the image (`translucencyScale.ts`) sees the pixel of the smaller target; `sceneVsOut` scales it back to the pixel of the image it lies over,
 * by the ratio of the sizes the view uniform holds (`VIEW.reduced`, 1 in every other pass: the position is then left as it is). An entry
 * hands its interpolants so scaled to its body (`layerEntry`, `layerBody`),
 * after the statement the cloud shade takes from them (`first`). The function is declared with the interpolants' structure (`vsOutWgsl`).
 */
export const SCENE_VS_OUT_WGSL = wgslFn(
  'sceneVsOut',
  [],
  `fn sceneVsOut(raw:VSOut)->VSOut{
 var scene=raw;
 scene.position=vec4f(raw.position.xy/uni.reduced,raw.position.z,raw.position.w);
 return scene;
}`,
)

/** The fragment entry `name` of a layer, returning `out`: it takes the interpolants as they are and runs the body (`layerBody`) on them at the
 *  image's pixel. A module that cuts at a plane by the pixel guards each entry on the interpolants it takes (`cutByPixel`). */
export const layerEntry = (name: string, out: string, first = '') =>
  `@fragment fn ${name}(in:VSOut,@builtin(front_facing) front:bool)->${out}{${first}return ${name}Body(sceneVsOut(in),front);}`

/** The head of the body of the entry `name`: the interpolants at the image's pixel, and the facing. */
export const layerBody = (name: string, out: string) =>
  `fn ${name}Body(in:VSOut,front:bool)->${out}`
