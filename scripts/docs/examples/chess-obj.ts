import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { boardMeshes, pieceTurn, playOpening, SQUARE, type Placed } from './chess-game.ts';
import { chessPieces } from './chess-pieces.ts';
import { moved, type Mesh } from './mesh.ts';
import { snap } from './random.ts';
import { box } from './solids.ts';

/**
 * `a-model-from-obj`: a chess set on a table written as one plain OBJ file and its `.mtl`, in
 * metres, Y up. The board and the turned pieces are those of the USDZ example, each piece written
 * out where it stands — OBJ has no instancing — with a normal per vertex; after 1. e4 e5 2. Nf3
 * Nc6 3. Bb5 a6 4. Bxc6 dxc6 the two pieces taken stand on the table beside the board, by the
 * player who took them, and a chess clock waits at the board's side.
 */
const MOVES = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5c6', 'd7c6'];
/** Height of the board in centimetres, frame included: its underside rests on the table top. */
const BOARD_HEIGHT = 1.61;
/** Half the board's width, frame included, in centimetres. */
const BOARD_HALF = 4 * SQUARE + 3;

/** `[Kd, Ks, Ns, roughness]` of each material, the `.mtl` keywords `Kd Ks Ns Pr`. */
const MATERIALS: Record<string, readonly [number[], number, number, number]> = {
  ivory: [[0.93, 0.88, 0.78], 0.2, 180, 0.28],
  ebony: [[0.16, 0.11, 0.09], 0.3, 220, 0.3],
  lightSquare: [[0.86, 0.72, 0.52], 0.05, 40, 0.45],
  darkSquare: [[0.36, 0.22, 0.13], 0.05, 40, 0.45],
  frame: [[0.24, 0.14, 0.08], 0.1, 80, 0.4],
  oak: [[0.42, 0.27, 0.15], 0.03, 20, 0.7],
  clockFace: [[0.9, 0.88, 0.8], 0.1, 60, 0.4],
};

/** The mesh turned by `degrees` about +Y, as USD's `rotateY` turns it, positions and normals. */
function turnedY(mesh: Mesh, degrees: number): Mesh {
  const [c, s] = [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)],
    turn = (values: readonly number[]) =>
      values.map((value, i) => {
        const [x, z] = [values[i - (i % 3)], values[i - (i % 3) + 2]];
        return i % 3 === 0 ? c * x + s * z : i % 3 === 2 ? -s * x + c * z : value;
      });
  return { ...mesh, positions: turn(mesh.positions), normals: turn(mesh.normals) };
}

/** One OBJ object per part: `[name, material, mesh in centimetres]`. */
type Part = readonly [name: string, material: string, mesh: Mesh];

function parts(): Part[] {
  // Turned more coarsely than the USDZ's instanced shapes: here every piece is its own mesh.
  const shapes = chessPieces({ segments: 24, density: 2 }),
    lift: [number, number, number] = [0, BOARD_HEIGHT, 0],
    { pieces, captured } = playOpening(MOVES),
    board = boardMeshes(),
    piece = ({ side, name, turn }: Placed, at: [number, number, number]): Part => [
      side.toLowerCase() + '-' + name.toLowerCase(),
      side === 'White' ? 'ivory' : 'ebony',
      moved(turnedY(shapes[name], turn), at),
    ];
  return [
    ['table', 'oak', moved(box(110, 4, 75), [0, -2, 0])],
    ['board-light-squares', 'lightSquare', moved(board.light, lift)],
    ['board-dark-squares', 'darkSquare', moved(board.dark, lift)],
    ['board-frame', 'frame', moved(board.frame, lift)],
    ...pieces.map((placed) => {
      const [file, rank] = [placed.file, placed.rank],
        [name, material, mesh] = piece(placed, [
          (file - 3.5) * SQUARE,
          BOARD_HEIGHT,
          (3.5 - rank) * SQUARE,
        ]);
      return [`${name}-${String.fromCharCode(97 + file)}${rank + 1}`, material, mesh] as const;
    }),
    // A taken piece stands on the table on its taker's right, in the order it fell.
    ...captured.map(([side, name], fell) => {
      const taker = side === 'White' ? -1 : 1,
        k = captured.slice(0, fell).filter(([other]) => other === side).length,
        placed = { side, name, file: k, rank: 0, turn: pieceTurn(side, name, k, 0) },
        [, material, mesh] = piece(placed, [taker * (BOARD_HALF + 4), 0, taker * (12 - k * 5)]);
      return [`captured-${side.toLowerCase()}-${name.toLowerCase()}`, material, mesh] as const;
    }),
    ['clock-case', 'frame', moved(box(5, 6, 15), [BOARD_HALF + 8, 3, -8])],
    ...[-11.5, -4.5].flatMap((z, k): Part[] => [
      [`clock-dial-${k + 1}`, 'clockFace', moved(box(0.3, 3.5, 3.5), [BOARD_HALF + 5.45, 3.2, z])],
      [`clock-button-${k + 1}`, 'ebony', moved(box(1.5, 0.8, 1.5), [BOARD_HALF + 8, 6.3, z])],
    ]),
  ];
}

/** Writes `chess.obj` and `chess.mtl` into `directory`. */
export async function writeChessObj(directory: string) {
  const lines = [
    "# A chess set on a table, modelled for Trillion3D's examples. CC0 1.0.",
    'mtllib chess.mtl',
  ];
  let base = 1;
  for (const [name, material, mesh] of parts()) {
    lines.push(`o ${name}`, `usemtl ${material}`);
    for (let v = 0; v < mesh.positions.length; v += 3) {
      const at = mesh.positions.slice(v, v + 3).map((value) => snap(value / 100).toFixed(5)),
        normal = mesh.normals.slice(v, v + 3).map((value) => snap(value).toFixed(4));
      lines.push(`v ${at.join(' ')}`, `vn ${normal.join(' ')}`);
    }
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const corner = (k: number) => `${mesh.indices[t + k] + base}//${mesh.indices[t + k] + base}`;
      lines.push(`f ${corner(0)} ${corner(1)} ${corner(2)}`);
    }
    base += mesh.positions.length / 3;
  }
  await writeFile(resolve(directory, 'chess.obj'), lines.join('\n') + '\n');
  const library = Object.entries(MATERIALS).map(
    ([name, [kd, ks, ns, roughness]]) =>
      `newmtl ${name}\nKd ${kd.join(' ')}\nKs ${ks} ${ks} ${ks}\nNs ${ns}\nPr ${roughness}\nPm 0\n`,
  );
  await writeFile(
    resolve(directory, 'chess.mtl'),
    ['# Materials of chess.obj. CC0 1.0.', ...library].join('\n\n'),
  );
}
