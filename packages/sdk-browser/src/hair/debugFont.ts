/**
 * THE LETTERS OF THE DEBUG VIEWS' TEXT, drawn as lines: a glyph is five rows of three cells, each run of
 * lit cells in a row one horizontal segment. The text of the views is figures and short words (names of the
 * strands' components, counts, sizes): capitals, digits and a few marks. A lower-case letter is drawn as its
 * capital; a character with no glyph, as a space.
 */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  ' ': ['...', '...', '...', '...', '...'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  ':': ['...', '.#.', '...', '.#.', '...'],
  '.': ['...', '...', '...', '...', '.#.'],
  ',': ['...', '...', '...', '.#.', '#..'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  '-': ['...', '...', '###', '...', '...'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'],
  '(': ['.#.', '#..', '#..', '#..', '.#.'],
  ')': ['.#.', '..#', '..#', '..#', '.#.'],
}

/** Cells a glyph is wide and tall, and the cells from one character to the next and one row of text to the next. */
const FONT_CELLS = { width: 3, height: 5, advance: 4, line: 7 } as const

/** The segments of the glyph of `char` as runs of lit cells: for each, the row and the first and last cell. */
function runsOf(char: string) {
  const rows = GLYPHS[char.toUpperCase()] ?? GLYPHS[' ']!
  const runs: [row: number, from: number, to: number][] = []
  rows.forEach((cells, row) => {
    for (let at = 0; at < cells.length; at++) {
      if (cells[at] !== '#') continue
      let end = at
      while (cells[end + 1] === '#') end++
      runs.push([row, at, end])
      at = end
    }
  })
  return runs
}

/**
 * Hands `put` each segment (`x0`, `y0`, `x1`, `y1`, in pixels) of `text` written from the pixel (`x`, `y`) with
 * cells `cell` pixels wide: the middle of the cell a run starts in to the middle of the cell it ends in, so that
 * a line of width `cell` covers the lit cells exactly. A new line (`\n`) goes down by `FONT_CELLS.line` cells.
 * Returns the pixel the text ended at.
 */
export function textSegments(
  text: string,
  x: number,
  y: number,
  cell: number,
  put: (x0: number, y0: number, x1: number, y1: number) => void,
) {
  let column = 0,
    line = 0
  for (const char of text) {
    if (char === '\n') {
      column = 0
      line++
      continue
    }
    for (const [row, from, to] of runsOf(char)) {
      const py = y + (line * FONT_CELLS.line + row + 0.5) * cell
      const px = x + column * FONT_CELLS.advance * cell
      put(px + (from + 0.5) * cell, py, px + (to + 0.5) * cell, py)
    }
    column++
  }
  return [x + column * FONT_CELLS.advance * cell, y + line * FONT_CELLS.line * cell] as const
}

/** The lit cells of the glyph of `char` as the bits of a word: the cell of row `r` and column `c` is bit `r * 3 + c`. */
export function glyphBits(char: string) {
  const rows = GLYPHS[char.toUpperCase()] ?? GLYPHS[' ']!
  let bits = 0
  rows.forEach((cells, row) => {
    for (let at = 0; at < cells.length; at++) if (cells[at] === '#') bits |= 1 << (row * 3 + at)
  })
  return bits
}
