/**
 * The size of a texture's picture in pixels, as the GPU copies it: a video's frame size
 * (`videoWidth`), not the box its element is laid out in (`width`, zero unless set), and a
 * video frame's display size; anything else by its `width` and `height`. At least one pixel each
 * way, so a video not yet playing still has a texture to hold its first frame (#362).
 */
export function pictureSize(image: unknown): [number, number] {
  const picture = image as {
    videoWidth?: number;
    videoHeight?: number;
    displayWidth?: number;
    displayHeight?: number;
    width?: number;
    height?: number;
  } | null;
  const width = picture?.videoWidth ?? picture?.displayWidth ?? picture?.width ?? 1,
    height = picture?.videoHeight ?? picture?.displayHeight ?? picture?.height ?? 1;
  return [Math.max(1, width), Math.max(1, height)];
}
