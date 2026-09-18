import { drawVis } from './webgpuVisibilityDrawer.ts';
import { skipsSecondaryPass } from './diagnosticGpuGeometry.ts';
import { restSlotCount } from './gpuDrawContract.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';
import type { ComputeRasterStages } from './webgpuPagesEncodeVisSetup.ts';
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
function encodeHizMidFrame(
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
 * Le tampon de visibilité, dans l'ordre de la référence : la passe matérielle primaire, la moitié
 * occulteurs du raster de calcul fondue dedans, la pyramide et son test, la passe secondaire, la
 * moitié testée du calcul, puis ses identifiants. Sans `compute` — pas de raster de calcul — le
 * matériel produit seul les mêmes attachements, et chaque étape du calcul est simplement absente.
 */
export function encodeWebgpuVisibilityPasses(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  twoPass: boolean,
  tableRows: number,
  useIndirect: boolean,
  compute: ComputeRasterStages,
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
  compute?.occluders(encoder);
  rt.run.hizPyramidFresh = false;
  const tested = twoPass && !!gpuHiz;
  if (tested) encodeHizMidFrame(rt, device, encoder, tableRows);
  // La seule variante de diagnostic qui touche aux commandes encodées : elle laisse la moitié
  // testée hors de l'image pour peser les occulteurs seuls, et rend donc une image incomplète.
  if (tested && !skipsSecondaryPass(rt.context?.diagnosticGpuVariant)) {
    const restPass = encoder.beginRenderPass({
      label: 'WG visibility secondary',
      colorAttachments: visColors('load'),
      depthStencilAttachment: { view: depthTarget, depthLoadOp: 'load', depthStoreOp: 'store' },
    });
    restPass.setViewport(0, 0, width, height, 0, 1);
    drawVis(rt, device, restPass, true, useIndirect);
    restPass.end();
    compute?.rest(encoder);
  }
  compute?.ids(encoder);
}
