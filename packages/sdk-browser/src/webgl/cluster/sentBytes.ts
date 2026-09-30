/** Bytes a map's picture sends: RGBA, one byte a channel; its mip chain is reduced on the GPU. */
export const sentBytes = (width: number, height: number) => width * height * 4;
