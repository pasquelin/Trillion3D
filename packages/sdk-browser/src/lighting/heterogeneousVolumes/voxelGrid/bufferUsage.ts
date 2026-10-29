/** The usages of the buffers the grids keep, as numbers (`GPUBufferUsage`: COPY_SRC 4, COPY_DST 8, UNIFORM 64, STORAGE 128, INDIRECT 256), which a module
 *  that Node loads may name at its top: Node has no such global. */
export const STORAGE = 128 | 8 | 4
export const UNIFORM = 64 | 8
export const INDIRECT = 256
