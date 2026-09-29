import { grown } from '../../../../sdk-core/src/math/transform-tree/transformTree.ts';
import { LTC_UNIT } from './rectGlsl.ts';
import { refuseCluster } from './refusal.ts';

/** Texels in a row of a light texture: WebGL2 guarantees 2048 a side, so one row fits every
 *  device and the rows grow with the scene. The program folds an index the same way (`LIGHT_TEXTURE_GLSL`). */
export const LIGHT_ROW_TEXELS = 1024;
/** The units of the light records and of the light grid's lists, past the reflection's two
 *  (`setClusterSamplers`, `./uniforms.ts`). */
export const LIGHT_DATA_UNIT = LTC_UNIT + 3;
export const LIGHT_LIST_UNIT = LTC_UNIT + 4;

/** How the program reads the two textures: a light's `k`th record vec4, the `t`th integer of the
 *  lists (`./lightLists.ts`). The program declares its integers and integer samplers high
 *  precision, as indices need. */
export const LIGHT_TEXTURE_GLSL = `uniform highp sampler2D lightData;uniform highp isampler2D lightList;
ivec2 lightTexel(int t){return ivec2(t%${LIGHT_ROW_TEXELS},t/${LIGHT_ROW_TEXELS});}
vec4 lightRecord(int light,int k){return texelFetch(lightData,lightTexel(light*4+k),0);}
int listEntry(int t){return texelFetch(lightList,lightTexel(t),0).r;}`;

/** A texel layout: four floats (a light record's vec4) or one integer (a list entry). */
type Layout = {
  channels: number;
  internal: 'RGBA32F' | 'R32I';
  format: 'RGBA' | 'RED_INTEGER';
  type: 'FLOAT' | 'INT';
};
export const FLOAT_TEXELS: Layout = {
  channels: 4,
  internal: 'RGBA32F',
  format: 'RGBA',
  type: 'FLOAT',
};
export const INT_TEXELS: Layout = {
  channels: 1,
  internal: 'R32I',
  format: 'RED_INTEGER',
  type: 'INT',
};

/**
 * One long array of texels read by `texelFetch`, `LIGHT_ROW_TEXELS` a row, and its CPU copy
 * `data`: as many rows as the frame writes, doubled when a frame passes them and never shrunk, so
 * N texels cost log N reallocations and nothing is sized for a fixed count of lights.
 */
export class WebglLightTexture<T extends Float32Array | Int32Array> {
  data: T;
  private rows = 0;
  /** The device's tallest texture (`MAX_TEXTURE_SIZE`), read at the first growth. */
  private maxRows = 0;
  private texture: WebGLTexture;
  private gl: WebGL2RenderingContext;
  private unit: number;
  private layout: Layout;
  private make: new (length: number) => T;
  constructor(
    gl: WebGL2RenderingContext,
    unit: number,
    layout: Layout,
    make: new (length: number) => T,
  ) {
    this.gl = gl;
    this.unit = unit;
    this.layout = layout;
    this.make = make;
    this.data = new make(0);
    this.texture = gl.createTexture()!;
    this.bind();
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.reserve(1);
  }
  /** Room for `texels` in `data`, content kept, and in the texture, reallocated when it grows. */
  reserve(texels: number) {
    const rows = Math.ceil(texels / LIGHT_ROW_TEXELS);
    if (rows <= this.rows) return;
    const { gl, layout } = this;
    const most = (this.maxRows ||= Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || Infinity);
    // Past the device's height the texture cannot hold them: refused out loud, never a GL error
    // that leaves the lights unread; the doubling itself never passes the height.
    if (rows > most)
      refuseCluster(`${texels} light texels exceed the ${most}-row light texture of this device`);
    this.rows = Math.min(Math.max(rows, this.rows * 2), most);
    this.data = grown(this.data, this.make, this.rows * LIGHT_ROW_TEXELS * layout.channels);
    this.bind();
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl[layout.internal],
      LIGHT_ROW_TEXELS,
      this.rows,
      0,
      gl[layout.format],
      gl[layout.type],
      null,
    );
  }
  /** Sends the rows holding the first `texels` and binds the texture on its unit: the host's
   *  units are unknown at frame start, so it is bound again every frame. */
  upload(texels: number) {
    const { gl, layout } = this;
    this.bind();
    const rows = Math.ceil(texels / LIGHT_ROW_TEXELS);
    if (rows === 0) return;
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      LIGHT_ROW_TEXELS,
      rows,
      gl[layout.format],
      gl[layout.type],
      this.data,
    );
  }
  /** Binds the texture on its unit, what a frame that sends nothing still owes the program. */
  bind() {
    this.gl.activeTexture(this.gl.TEXTURE0 + this.unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
  }
  dispose() {
    this.gl.deleteTexture(this.texture);
  }
}
