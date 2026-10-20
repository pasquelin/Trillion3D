/**
 * THE TRIANGLES DRAWN, their one count: those the cut selected (`selectedTriangles`, past its
 * frustum and its levels) less those of its rows the occlusion test rejected, as the GPU last
 * sampled them (`GpuPartition.counts`, one image in fifteen); none subtracted before the first
 * sample. The test runs once an image, after the occluders drew, on that image's own pyramid: its
 * reject is final, nothing draws the row later. It weighs only the rows the cut draws
 * (`classifyRows`): a resident row the cut leaves undrawn is no reject of the image.
 */
export const drawnTrianglesOf = (
  run: { readonly selectedTriangles: number },
  hiz: { rejectedTriangles: number } | undefined,
) => Math.max(0, run.selectedTriangles - (hiz?.rejectedTriangles ?? 0))
