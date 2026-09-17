// Le chemin d'avant le lot « pompe de textures », recopié tel quel : la mesure d'une image
// reconstruisait, PAR PAGE ET PAR IMAGE, la sphère de la boîte, les couches du matériau (hachage
// compris) et l'étendue uv de la géométrie. Rien ici ne doit être « amélioré » : c'est la référence.
import { maxStretch } from '../../../sdk-core/index.ts';
import { boundsScreenRadius, pixelScaleOf, worldBoxScreenRadius } from '../../streamingPriority.ts';
import { openUvSpanBudget, uvSpanOf } from '../../textureUvSpan.ts';
import { createFrameViews } from '../../textureFrameViews.ts';

export function createReferenceMeasure(color, data) {
  const frames = createFrameViews();
  const pixelScale = [1, 1];
  const deposit = (layers, pixels, uvSpan) => {
    if (!layers || !(pixels > 0)) return;
    const areaPixels = pixels * pixels;
    color.add(layers.color, pixels, areaPixels, uvSpan);
    data.add(layers.data, pixels, areaPixels, uvSpan);
  };
  return (inputs) => {
    const { index, requested, blend, cam, viewport, colorTexels, dataTexels } = inputs;
    color.reset();
    data.reset();
    frames.reset();
    openUvSpanBudget();
    const camStretch = cam ? maxStretch(cam.view) : 0;
    let measured = false;
    if (index && cam && camStretch > 0) {
      measured = true;
      pixelScaleOf(cam.projection, viewport, pixelScale);
      const focal = Math.max(pixelScale[0], pixelScale[1]),
        near = cam.near || 1e-3;
      for (let i = 0; i < requested.length; i++) {
        const page = requested[i];
        const at = frames.of(page.matrix, cam.view);
        const radius = boundsScreenRadius(page, frames.view(at), frames.stretch(at), focal, near);
        deposit(index.get(page.material), 2 * radius, uvSpanOf(page.attributes));
      }
      for (let i = 0; i < blend.length; i++) {
        const item = blend[i];
        if (!item.bounds) continue;
        const radius = worldBoxScreenRadius(item.bounds, cam.view, camStretch, focal, near);
        deposit(index.get(item.material), 2 * radius, uvSpanOf(item.sourceGeometry?.attributes));
      }
    }
    color.settle(colorTexels);
    data.settle(dataTexels);
    return measured;
  };
}

/** Ce que les deux côtés doivent rendre identique : le niveau voulu et le poids de chaque couche. */
export function releve(color, data, slots) {
  const lignes = [];
  for (let slot = 0; slot < slots; slot++)
    lignes.push([color.gapOf(slot), color.areaOf(slot), data.gapOf(slot), data.areaOf(slot)]);
  return { lignes, couleur: { ...color.counters }, donnees: { ...data.counters } };
}
