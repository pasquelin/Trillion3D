/** The format every canvas is configured with and every pass that draws into one is compiled for: the browser's
 *  preferred one where it is `rgba8unorm` or `bgra8unorm` (the present writes display-encoded bytes, which no
 *  other format takes), so the compositor copies no swizzle; `bgra8unorm` where none is asked. */
export const CANVAS_FORMAT: GPUTextureFormat = (() => {
  const preferred =
    typeof navigator === 'undefined' ? undefined : navigator.gpu?.getPreferredCanvasFormat?.()
  return preferred === 'rgba8unorm' ? preferred : 'bgra8unorm'
})()
