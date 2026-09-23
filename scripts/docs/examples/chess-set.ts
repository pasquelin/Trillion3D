import { resolve } from 'node:path';
import { chessPieces } from './chess-pieces.ts';
import { merge, moved, type Mesh } from './mesh.ts';
import { box } from './solids.ts';
import { usdMesh, writeUsdz } from './usdz.ts';

/**
 * `a-model-from-usdz`: a chess set written as one USD text layer — centimetres, Y up — its
 * thirty-two pieces instanced from six turned prototypes, packed as a USDZ.
 */
const SQUARE = 5,
  MATERIALS = '/ChessSet/Materials';

function material(name: string, [r, g, b]: readonly number[], roughness: number, clearcoat = 0) {
  return `        def Material "${name}"
        {
            token outputs:surface.connect = <${MATERIALS}/${name}/Surface.outputs:surface>
            def Shader "Surface"
            {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor = (${r}, ${g}, ${b})
                float inputs:roughness = ${roughness}
                float inputs:metallic = 0
                float inputs:clearcoat = ${clearcoat}
                token outputs:surface
            }
        }
`;
}

/** Light and dark squares, a frame around them and a plinth under the whole board. The pieces
 * stand at `z = (3.5 - rank) * SQUARE`, so a1 is `(i, j) = (0, 7)`: an odd sum is a dark square,
 * and h1, at white's right hand, a light one. */
function board() {
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
  return [
    usdMesh('LightSquares', merge(squares[0]), `${MATERIALS}/Maple`),
    usdMesh('DarkSquares', merge(squares[1]), `${MATERIALS}/Walnut`),
    usdMesh(
      'Frame',
      merge([...frame, moved(box(8 * SQUARE + 6, 1.2, 8 * SQUARE + 6), [0, -1, 0])]),
      `${MATERIALS}/Frame`,
    ),
  ].join('');
}

/** The pieces where 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 left them, each an instance of its shape. */
function pieces() {
  const back = ['Rook', 'Knight', 'Bishop', 'Queen', 'King', 'Bishop', 'Knight', 'Rook'],
    squares = new Map<string, [side: string, name: string]>(),
    key = (file: number, rank: number) => `${file}${rank}`;
  for (let f = 0; f < 8; f++) {
    squares.set(key(f, 0), ['White', back[f]]).set(key(f, 1), ['White', 'Pawn']);
    squares.set(key(f, 7), ['Black', back[f]]).set(key(f, 6), ['Black', 'Pawn']);
  }
  for (const move of ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6']) {
    const [from, to] = [move.slice(0, 2), move.slice(2)].map((square) =>
      key(square.charCodeAt(0) - 97, Number(square[1]) - 1),
    );
    squares.set(to, squares.get(from)!);
    squares.delete(from);
  }
  return [...squares]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([square, [side, name]]) => {
      const [f, r] = [Number(square[0]), Number(square[1])],
        // Knights look across the board at the other side; the rest turn a little, as by hand.
        turn = name === 'Knight' ? (side === 'White' ? -90 : 90) : ((f * 37 + r * 11) % 30) - 15;
      return `        def Xform "${side}${name}_${String.fromCharCode(97 + f)}${r + 1}" (
            instanceable = true
            prepend references = </ChessSet/Prototypes/${name}>
        )
        {
            rel material:binding = <${MATERIALS}/${side === 'White' ? 'Ivory' : 'Ebony'}>
            double3 xformOp:translate = (${(f - 3.5) * SQUARE}, 0, ${(3.5 - r) * SQUARE})
            float xformOp:rotateY = ${turn}
            uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateY"]
        }
`;
    })
    .join('');
}

/** Writes `chess-set.usdz` into `directory`. */
export async function writeChessSet(directory: string) {
  // One prototype per shape: each piece binds its side's material on its own instance root, and
  // the binding reaches the shape it references.
  const prototypes = Object.entries(chessPieces())
    .map(([name, mesh]) => `    class Xform "${name}"\n    {\n${usdMesh('Shape', mesh)}    }\n`)
    .join('');
  const layer = `#usda 1.0
(
    defaultPrim = "ChessSet"
    metersPerUnit = 0.01
    upAxis = "Y"
    doc = "A chess set turned in code for the Web Geometry examples. Self-made, CC0."
)

def Xform "ChessSet"
{
    def Scope "Materials"
    {
${material('Ivory', [0.93, 0.88, 0.78], 0.28, 0.5)}${material('Ebony', [0.16, 0.11, 0.09], 0.3, 0.5)}${material('Maple', [0.86, 0.72, 0.52], 0.45)}${material('Walnut', [0.36, 0.22, 0.13], 0.45)}${material('Frame', [0.24, 0.14, 0.08], 0.4)}    }

    def Scope "Prototypes"
    {
${prototypes}    }

    def Xform "Board"
    {
${board()}    }

    def Xform "Pieces"
    {
${pieces()}    }
}
`;
  await writeUsdz(resolve(directory, 'chess-set.usdz'), [['chess-set.usda', Buffer.from(layer)]]);
}
