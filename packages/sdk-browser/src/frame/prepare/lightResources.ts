/**
 * Serves tiles requested by the previous image, except during a pose barrier: the shadow
 * drain replays the image without admitting new ones. An arriving tile changes the image the drain
 * replays and the queue would never empty. Returns the tiles served.
 */
export function pumpResidentTiles(
  textures: { pump: (frame: number) => { served: number } } | undefined,
  frame: number,
  converging: boolean,
) {
  return (!converging && textures?.pump(frame).served) || 0
}
