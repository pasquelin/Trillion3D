// The state of the shading models a test of the light terms runs with when it sets none (`SHADING_MODEL_STATE_WGSL`): no pixel model, the
// sphere's Newton step kept, a clear coat that keeps its base's normal. One definition for every test that runs the lights in
// JavaScript (`shaderRun`).
export const NO_SHADING_MODEL = {
  pixelModel: 0,
  sphereNoNewton: false,
  clearCoatBottom: false,
} as const
