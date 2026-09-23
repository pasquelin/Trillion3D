import { merge, moved, type Mesh } from './mesh.ts';
import { box } from './solids.ts';

/**
 * The chess board and the game on it, shared by the chess set written as USDZ and the one written
 * as OBJ: centimetres, Y up, the squares' top at zero, file `a` towards -X and white towards +Z.
 */
export const SQUARE = 5;

/** Light and dark squares, the frame around them and the plinth under the whole board. The square
 * `(i, j)` stands at `((i - 3.5) * SQUARE, (j - 3.5) * SQUARE)`, so a1 is `(0, 7)`: an odd sum is
 * a dark square, and h1, at white's right hand, a light one. */
export function boardMeshes() {
  const squares: [Mesh[], Mesh[]] = [[], []];
  for (let i = 0; i < 8; i++)
    for (let j = 0; j < 8; j++)
      squares[(i + j) % 2].push(
        moved(box(SQUARE, 0.4, SQUARE), [(i - 3.5) * SQUARE, -0.2, (j - 3.5) * SQUARE]),
      );
  const edge = 4 * SQUARE + 1.5,
    frame = [-1, 1].flatMap((s) => [
      moved(box(8 * SQUARE + 6, 1.6, 3), [0, -0.81, s * edge]),
      moved(box(3, 1.6, 8 * SQUARE), [s * edge, -0.81, 0]),
    ]);
  return {
    light: merge(squares[0]),
    dark: merge(squares[1]),
    frame: merge([...frame, moved(box(8 * SQUARE + 6, 1.2, 8 * SQUARE + 6), [0, -1, 0])]),
  };
}

/** A piece on its square: `file` and `rank` count from zero, `turn` is in degrees about +Y. */
export type Placed = {
  side: 'White' | 'Black';
  name: string;
  file: number;
  rank: number;
  turn: number;
};

/**
 * The pieces where `moves` (from-square to-square, `e2e4`) left them, sorted by square, and the
 * pieces taken on the way, in the order they fell.
 */
export function playOpening(moves: readonly string[]) {
  const back = ['Rook', 'Knight', 'Bishop', 'Queen', 'King', 'Bishop', 'Knight', 'Rook'],
    squares = new Map<string, [side: Placed['side'], name: string]>(),
    captured: [side: Placed['side'], name: string][] = [],
    key = (file: number, rank: number) => `${file}${rank}`;
  for (let f = 0; f < 8; f++) {
    squares.set(key(f, 0), ['White', back[f]]).set(key(f, 1), ['White', 'Pawn']);
    squares.set(key(f, 7), ['Black', back[f]]).set(key(f, 6), ['Black', 'Pawn']);
  }
  for (const move of moves) {
    const [from, to] = [move.slice(0, 2), move.slice(2)].map((square) =>
      key(square.charCodeAt(0) - 97, Number(square[1]) - 1),
    );
    const taken = squares.get(to);
    if (taken) captured.push(taken);
    squares.set(to, squares.get(from)!);
    squares.delete(from);
  }
  const pieces = [...squares]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([square, [side, name]]): Placed => {
      const [file, rank] = [Number(square[0]), Number(square[1])];
      return { side, name, file, rank, turn: pieceTurn(side, name, file, rank) };
    });
  return { pieces, captured };
}

/** Knights look across the board at the other side; the rest turn a little, as by hand. */
export function pieceTurn(side: Placed['side'], name: string, file: number, rank: number) {
  if (name === 'Knight') return side === 'White' ? -90 : 90;
  return ((file * 37 + rank * 11) % 30) - 15;
}
