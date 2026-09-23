import { resolve } from 'node:path';
import { boardMeshes, playOpening, SQUARE } from './chess-game.ts';
import { chessPieces } from './chess-pieces.ts';
import { usdMesh, writeUsdz } from './usdz.ts';

/**
 * `a-model-from-usdz`: a chess set written as one USD text layer — centimetres, Y up — its
 * thirty-two pieces instanced from six turned prototypes, packed as a USDZ.
 */
const MATERIALS = '/ChessSet/Materials';

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

/** Light and dark squares, a frame around them and a plinth under the whole board. */
function board() {
  const { light, dark, frame } = boardMeshes();
  return [
    usdMesh('LightSquares', light, `${MATERIALS}/Maple`),
    usdMesh('DarkSquares', dark, `${MATERIALS}/Walnut`),
    usdMesh('Frame', frame, `${MATERIALS}/Frame`),
  ].join('');
}

/** The pieces where 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 left them, each an instance of its shape. */
function pieces() {
  return playOpening(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6'])
    .pieces.map(
      ({
        side,
        name,
        file,
        rank,
        turn,
      }) => `        def Xform "${side}${name}_${String.fromCharCode(97 + file)}${rank + 1}" (
            instanceable = true
            prepend references = </ChessSet/Prototypes/${name}>
        )
        {
            rel material:binding = <${MATERIALS}/${side === 'White' ? 'Ivory' : 'Ebony'}>
            double3 xformOp:translate = (${(file - 3.5) * SQUARE}, 0, ${(3.5 - rank) * SQUARE})
            float xformOp:rotateY = ${turn}
            uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateY"]
        }
`,
    )
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
