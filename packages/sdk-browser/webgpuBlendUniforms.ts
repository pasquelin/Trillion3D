import { viewProj } from './webgpuPagesHelpers.ts';
import { FLAG_UNLIT_VIEW } from './visibilityBuffer.ts';
import { writeBlendDiagnostic } from './webgpuBlendDiagnostic.ts';
import { directTiles } from './webgpuPagesEncodeLights.ts';
import { wantsContractLighting } from './webgpuPagesLightResources.ts';
import type { DiagnosticMode } from '../sdk-core/index.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Le pas des uniformes du chemin de repli, qui garde un enregistrement par primitive. */
export const UNIFORM_STRIDE = 256;
/** `viewProj`, l'oeil, les tuiles de lampes, les drapeaux de vue et le decalage d'item : 96 octets. */
export const BLEND_VIEW_SIZE = 96;

/** Les bits de diagnostic que TOUTE la passe porte : ils ne dependent pas de l'item. */
function diagnosticBits(diagnostic: DiagnosticMode) {
  if (diagnostic === 'beauty') return 0;
  const mode =
    diagnostic === 'wireframe'
      ? 0x20000000
      : diagnostic === 'clusters'
        ? 0x10000000
        : diagnostic === 'lod'
          ? 0x08000000
          : diagnostic === 'screen-error'
            ? 0x04000000
            : 0;
  return (0x40000000 | mode) >>> 0;
}

/**
 * L'uniforme de VUE de la passe transparente : quatre-vingt-seize octets, une fois par image.
 *
 * Tout ce qui appartenait a un item — sa matrice, sa couleur, ses six cartes — vit maintenant dans
 * la fiche que le nuanceur lit au rang porte par l'indice de sommet (`webgpuBlendItems.ts`). Il ne
 * reste ici que ce qui change d'une image a l'autre et vaut pour tous les items a la fois : la
 * projection, l'oeil, les tuiles de lampes de cette image et les drapeaux de diagnostic. Aucune
 * boucle sur les items, aucune allocation, une seule ecriture de tampon.
 */
export function writeBlendView(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { run, blendState } = rt,
    buffer = blendState.viewBuffer;
  if (!buffer) return;
  const packed = blendState.viewPacked,
    ints = blendState.viewInts;
  const { diagnostic, lastCamera, diagnosticPixelError } = run,
    { viewport } = rt.setup;
  // L'oeil en repere monde, pris dans la camera du moteur : la position locale d'une camera
  // parentee n'est pas ou elle regarde.
  const eye = lastCamera ? run.gate.cam.eye : undefined;
  const tiles = directTiles();
  writeBlendDiagnostic(
    blendState,
    rt.layout.packedPages,
    diagnostic,
    eye && run.gate.cam,
    viewport,
    diagnosticPixelError,
  );
  packed.set(viewProj, 0);
  packed[16] = eye?.[0] ?? 0;
  packed[17] = eye?.[1] ?? 0;
  packed[18] = eye?.[2] ?? 0;
  packed[19] = 1;
  // Les tuiles de lampes de cette image-ci : sans elles, la boucle du pixel retombe sur les lampes
  // declarees. Zero quand aucune liste n'a ete encodee, jamais celles d'une autre image.
  packed[20] = tiles[1];
  packed[21] = tiles[2];
  // Une seule question par image, pas par maillage : l'image est-elle eclairee par des lampes
  // declarees ? Sinon les transparents sortent leur albedo brut, comme les opaques (P6).
  ints[22] = ((wantsContractLighting(rt) ? 0 : FLAG_UNLIT_VIEW) | diagnosticBits(diagnostic)) >>> 0;
  ints[23] = blendState.vertexShift;
  device.queue.writeBuffer(
    buffer,
    0,
    packed.buffer as ArrayBuffer,
    packed.byteOffset,
    BLEND_VIEW_SIZE,
  );
}
