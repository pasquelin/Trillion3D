import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { computeUniformEntry } from '../../gpu/core/computeBindings.ts'

/**
 * THE GRAPH FRAME: what the rasters read of the image to evaluate a graph's cutout and offset — the
 * clocks of the image and of the image before, in seconds (`clock`: the world's time, the wall clock,
 * then the same before), and the camera in the world, then the camera before (`eye`, `before`). One
 * small uniform for every pass that places a vertex or cuts a pixel (the visibility rasters and the
 * binning, the shadow depth pass, the resolves, the temporal pass, the
 * transparent pass), written once an image (`../../frame/render/graphFrame.ts`): the clocks that a
 * graph reads are one value in all of them. Group 0, the binding the pass gives it. The fourth float
 * of `eye` says whether the blue noise a dithered cutout is cut by is bound (one) or its stand-in is
 * (zero: the cut is then plain); `frame`, the word after the camera before, is the view's image number, which that noise is
 * walked by.
 */
export const GRAPH_FRAME_BYTES = 48

/** The WGSL struct of the frame and the uniform at `binding` of `group`, `graphFrame`. */
export const graphFrameWgsl = (binding: number, group = 0) =>
  wgslBlock(
    group === 0 ? `graphFrameWgsl(${binding})` : `graphFrameWgsl(${binding}, ${group})`,
    [],
    `struct GraphFrame{clock:vec4f,eye:vec4f,before:vec3f,frame:u32,}
@group(${group}) @binding(${binding}) var<uniform> graphFrame:GraphFrame;`,
  )

/** The layout entry of the frame at `binding`, seen by `visibility`. */
export const graphFrameEntry = (binding: number, visibility: number) =>
  computeUniformEntry(binding, { minBindingSize: GRAPH_FRAME_BYTES }, visibility)

/** The floats of the frame: the clocks (time, real time, then the same before), the camera, the
 *  camera before. */
export const GRAPH_FRAME_AT = { clock: 0, eye: 4, before: 8 } as const
