import type { ReflectionCaptureField } from '../contracts/reflectionCaptureOptions.ts'

/** What the reflection capture settings mean (`../contracts/reflectionCaptureOptions.ts`). */
export const REFLECTION_CAPTURE_MEANINGS: Readonly<Record<ReflectionCaptureField, string>> = {
  reflectionCaptures:
    'Whether the reflection captures of the scene light the surfaces (true, the default): each captures the scene from its place into a cube, read by the rough reflections that neither the screen nor the scene answer, under the sky light. False makes and reads none.',
  reflectionCaptureResolution:
    "The side in texels of every capture's cube, 128 by default, from 16 to 1024; the power of two at or below it is taken. A capture is made again when it changes.",
  reflectionCaptureSupersample:
    "How many times the cube's side the scene is drawn at for each face before it is reduced (1 by default, from 1 to 8).",
  reflectionCaptureNearPlane:
    'The nearest distance, in metres, the scene is drawn from the capture (0.05 by default).',
  reflectionCaptureLightFunctions:
    "Whether the lights' functions show in the captures (false, the default).",
  reflectionCaptureDiffuse:
    "Whether the four smallest mips of a capture's cube hold its diffuse light and the surfaces take their diffuse light from the captures where they reach, in place of the sky light's (false, the default).",
  reflectionCaptureDiffuseReference:
    'With reflectionCaptureDiffuse, whether the diffuse light is the exhaustive convolution of the cube (true, the default) or is evaluated from nine harmonics summed from the cube.',
}
