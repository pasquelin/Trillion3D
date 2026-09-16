import { drawVis } from './webgpuVisibilityDrawer.ts';
import { skipsSecondaryPass } from './diagnosticGpuGeometry.ts';
import { restSlotCount } from './gpuDrawContract.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';
import { DEPTH_CLEAR } from './depthConvention.ts';

/**
 * La pyramide Hi-Z, son test d'occultation et la recompaction qu'il permet : ce qui sépare la moitié
 * occulteurs de la moitié testée, quel que soit le producteur de l'image.
 *
 * Aucune de ces décisions ne dépend d'un compte que le processeur aurait établi ligne par ligne : le
 * noyau d'occultation lit lui-même le nombre de boîtes que la partition lui a compactées. Une image
 * dont la carte a tout mis du côté des occulteurs encode donc quand même cette étape, qui n'élimine
 * rien — et l'image est la même.
 *
 * Le verdict qu'elle écrit est à trois valeurs et c'est ce que le raster de calcul lit : `0` pour une
 * ligne de la moitié occulteurs, `1` pour une ligne testée que la pyramide rejette, `2` pour une
 * ligne testée qu'elle garde. La partition a posé les `0` et les `2` avant cette étape ; le test ne
 * fait que ramener certains `2` à `1`.
 */
export function encodeHizMidFrame(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  tableRows: number,
) {
  const { vis } = rt,
    { rows } = rt.layout,
    { gpuHiz } = vis;
  if (!gpuHiz) return;
  gpuHiz.encodePyramid(encoder);
  rt.run.hizPyramidFresh = true;
  gpuHiz.encodeTest(device, encoder, rows.packedCount, tableRows);
  // Le verdict existe maintenant : le suffixe de lignes rejetées sort du compte d'instances avant
  // que la seconde passe ne lance leurs sommets. Il n'y posait aucun pixel, l'image ne bouge pas.
  if (vis.gpuRestCompact && vis.pageTable)
    vis.gpuRestCompact.encode(
      encoder,
      restSlotCount(vis.drawLayerSlots),
      rows.packedCount,
      vis.pageTable,
    );
}

/**
 * Le raster matériel du tampon de visibilité : la passe primaire, puis, quand les ressources de la
 * moitié testée existent, la pyramide, le test d'occultation et la passe secondaire.
 *
 * C'est le repli de l'appareil qui ne peut pas héberger le raster de calcul — il n'y a plus qu'ici
 * que la géométrie opaque passe par des appels de dessin. Quand le raster de calcul existe, c'est
 * lui qui produit ces mêmes attachements, et aucun de ces appels n'est encodé.
 */
export function encodeWebgpuVisibilityPasses(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  twoPass: boolean,
  tableRows: number,
  useIndirect: boolean,
) {
  const { vis, gpu } = rt,
    { gpuHiz } = vis,
    idsView = vis.visView!,
    depthTarget = gpu.depthView!,
    [width, height] = gpu.targetSize;
  const visColors = (loadOp: 'clear' | 'load') => {
    const ids: {
      view: GPUTextureView;
      loadOp: 'clear' | 'load';
      storeOp: 'store';
      clearValue?: GPUColor;
    } = { view: idsView, loadOp, storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } };
    if (!gpuHiz) return [ids];
    return [
      ids,
      {
        // Le niveau 0 de la pyramide est une PROFONDEUR : son fond est le lointain, pas 1. En Z
        // inversé, l'effacer à 1 remplissait chaque texel non couvert avec le plan proche, et la
        // réduction au minimum rendait alors 1 sur tout un bloc de fond — assez pour rejeter toute
        // page qui s'y projette. Ce sont les trous qu'une campagne voyait par milliers de pixels.
        view: gpuHiz.level0View,
        loadOp,
        storeOp: 'store' as const,
        clearValue: { r: DEPTH_CLEAR, g: 0, b: 0, a: 1 },
      },
    ];
  };
  const visPass = encoder.beginRenderPass({
    label: 'WG visibility primary',
    colorAttachments: visColors('clear'),
    depthStencilAttachment: {
      view: depthTarget,
      depthClearValue: DEPTH_CLEAR,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });
  visPass.setViewport(0, 0, width, height, 0, 1);
  drawVis(rt, device, visPass, false, useIndirect);
  visPass.end();
  rt.run.hizPyramidFresh = false;
  if (!twoPass || !gpuHiz) return;
  encodeHizMidFrame(rt, device, encoder, tableRows);
  // La seule variante de diagnostic qui touche aux commandes encodées : elle laisse la moitié
  // testée hors de l'image pour peser les occulteurs seuls, et rend donc une image incomplète.
  if (skipsSecondaryPass(rt.context?.diagnosticGpuVariant)) return;
  const restPass = encoder.beginRenderPass({
    label: 'WG visibility secondary',
    colorAttachments: visColors('load'),
    depthStencilAttachment: { view: depthTarget, depthLoadOp: 'load', depthStoreOp: 'store' },
  });
  restPass.setViewport(0, 0, width, height, 0, 1);
  drawVis(rt, device, restPass, true, useIndirect);
  restPass.end();
}
