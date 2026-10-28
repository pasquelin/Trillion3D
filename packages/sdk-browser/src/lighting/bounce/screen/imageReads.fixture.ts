/** What an image with all of it can read: its screen, history, field and vectors. */
export const IMAGE_READS = {
  frame: 1,
  previousFrame: 0,
  history: true,
  screen: true,
  cache: true,
  velocity: true,
  previousInverse: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  relativeThickness: 0.02,
  depthThicknessScale: 1,
  historyThickness: 0.005,
  fullResDepth: true,
  skylightLeak: [0, 0, 0] as const,
  roughSpecularFoliage: 0.8,
  posesMoving: false,
  exactLight: false,
}
