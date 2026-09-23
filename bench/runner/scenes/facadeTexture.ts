// The facade's own texture: a checkerboard whose every cell carries its index in digits.
//
// A checker alone says that a texture coordinate moved; it never says by how much, nor in which
// direction — two cells apart looks exactly like no slide at all. The digits give each cell a name,
// so a capture shows the slide itself: a wall reading `37` where `38` is expected is off by one
// cell, whatever the filtering did to the edges.
import { encodePng } from '../../../packages/sdk-node/src/cutout/png.mts';

/** 5 × 7 glyphs, one string of 35 characters per digit, row after row. */
const DIGITS = [
  '01110100011001110101100111000101110',
  '00100011000010000100001000010001110',
  '01110100010000100010001000100011111',
  '01110100010000100110000011000101110',
  '00010001100101010010111110001000010',
  '11111100001111000001000011000101110',
  '00110010001000011110100011000101110',
  '11111000010001000100010000100001000',
  '01110100011000101110100011000101110',
  '01110100011000101111000010001001100',
];

const FONT_WIDTH = 5,
  FONT_HEIGHT = 7;

/** The same glyphs, cut into rows once instead of at every cell. */
const GLYPHS = DIGITS.map((digit) => digit.match(/.{1,5}/g) ?? []);

/** The texture is 1024 × 1024 — a power of two, so the cook's mip chain halves it cleanly — cut
 *  into 16 × 16 cells of 64 texels: the cell is the unit a slide is read in. */
export const TEXTURE_CELLS = 16;
const TEXTURE_CELL_PIXELS = 64;
export const TEXTURE_SIZE = TEXTURE_CELLS * TEXTURE_CELL_PIXELS;

/** Draws `text` in `ink`, top-left of the cell, at the largest scale its cell can hold. */
function drawText(
  rgba: Uint8Array,
  text: string,
  x0: number,
  y0: number,
  scale: number,
  ink: number[],
) {
  let pen = x0;
  for (const character of text) {
    const rows = GLYPHS[Number(character)];
    for (let row = 0; row < FONT_HEIGHT; row++)
      for (let column = 0; column < FONT_WIDTH; column++) {
        if (rows[row][column] !== '1') continue;
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const index = ((y0 + row * scale + dy) * TEXTURE_SIZE + pen + column * scale + dx) * 4;
            rgba.set(ink, index);
          }
      }
    pen += (FONT_WIDTH + 1) * scale;
  }
}

/** The two greys of the checker: far enough apart to read on a capture, close enough that
 *  neither clips. Each cell's digits are drawn in the other one, so they read on both squares. */
export const CHECKER_GREYS = { light: [214, 214, 208, 255], dark: [58, 62, 70, 255] };

/** The checker and its digits, texel by texel, RGBA8, top row first. */
export function facadeTexels() {
  const { light, dark } = CHECKER_GREYS;
  const rgba = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  for (let y = 0; y < TEXTURE_SIZE; y++)
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const cellX = Math.floor(x / TEXTURE_CELL_PIXELS),
        cellY = Math.floor(y / TEXTURE_CELL_PIXELS);
      rgba.set((cellX + cellY) % 2 === 0 ? light : dark, (y * TEXTURE_SIZE + x) * 4);
    }
  const digits = String(TEXTURE_CELLS * TEXTURE_CELLS - 1).length;
  const scale = Math.max(
    1,
    Math.min(
      Math.floor(TEXTURE_CELL_PIXELS / (digits * (FONT_WIDTH + 1))),
      Math.floor(TEXTURE_CELL_PIXELS / FONT_HEIGHT),
    ),
  );
  for (let cellY = 0; cellY < TEXTURE_CELLS; cellY++)
    for (let cellX = 0; cellX < TEXTURE_CELLS; cellX++) {
      const index = cellY * TEXTURE_CELLS + cellX;
      drawText(
        rgba,
        String(index),
        cellX * TEXTURE_CELL_PIXELS + scale,
        cellY * TEXTURE_CELL_PIXELS + scale,
        scale,
        (cellX + cellY) % 2 === 0 ? dark : light,
      );
    }
  return rgba;
}

/** The PNG the facade's material points at. */
export const facadeTexture = () => encodePng(TEXTURE_SIZE, TEXTURE_SIZE, facadeTexels());
