import type { XrLayerImage } from './layers.ts';

/** Browser layers consume bottom-left, premultiplied pixels; restore the renderer's unpack state. */
export function uploadXrGlLayer(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  image: XrLayerImage,
  rect: { x: number; y: number; width: number; height: number },
) {
  let source: TexImageSource = image;
  // ImageBitmap ignores WebGL unpack conversion. A canvas makes the conversion explicit.
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('XR_LAYER_UPLOAD_UNAVAILABLE');
    context.drawImage(image, 0, 0);
    source = canvas;
  }
  const previous = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean;
  const alpha = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) as boolean;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  try {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, rect.x, rect.y, gl.RGBA, gl.UNSIGNED_BYTE, source);
  } finally {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, alpha);
    gl.bindTexture(gl.TEXTURE_2D, previous);
  }
}
