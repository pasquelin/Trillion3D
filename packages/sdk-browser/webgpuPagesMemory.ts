import { texturePoolFor, type GeometryPool, type TexturePool } from './webgpuMemoryBudgets.ts';
import { dropPoolBindGroups } from './webgpuPagesDrops.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Ce qu'un hôte peut changer en cours de session ; un champ absent garde sa valeur. */
export type MemoryBudgets = { geometryPoolBytes?: number; texturePoolBytes?: number };

/** Les réservoirs tels que le moteur les tient après le réglage, et ce que le réglage a coûté. */
export type MemoryBudgetsReport = {
  geometryPool: GeometryPool;
  texturePool: TexturePool;
  /** Pages et tuiles que le nouveau réservoir n'a pas pu garder : elles reviendront si l'image
   *  les redemande, leur niveau grossier tenant la place entre-temps. */
  evictedPages: number;
  evictedTiles: number;
  /** Ce qui résidait juste avant le réglage et juste après. */
  residentPages: { before: number; after: number };
  residentTiles: { before: number; after: number };
  durationMs: number;
};

/**
 * Change les réservoirs de mémoire en cours de session, comme les variables de la référence — mais
 * sans vider ce qu'ils tiennent : les pages et les tuiles qui entrent dans le nouveau réservoir y
 * sont copiées sur la carte, seules celles qui n'y tiennent plus s'en vont, et l'image reste
 * complète pendant tout le réglage. Une valeur qui ne peut pas être tenue est ramenée à ce qui peut
 * l'être, et le rapport dit pourquoi (`clamp`) ; le pool de géométrie ne dépasse jamais le plafond
 * de la session (`geometryPoolCeilingBytes`), que les tables par page dessinable ont fixé.
 */
export async function setWebgpuMemoryBudgets(
  rt: WebgpuPagesRuntime,
  budgets: MemoryBudgets,
): Promise<MemoryBudgetsReport> {
  const { setup, gpu, vis, run, diag } = rt;
  const started = performance.now();
  let evictedPages = 0,
    evictedTiles = 0;
  const residentTiles = () =>
    vis.textures ? vis.textures.color.pool.resident + vis.textures.data.pool.resident : 0;
  const residentPages = () => gpu.cache?.stats().residentPages ?? 0;
  const before = { pages: residentPages(), tiles: residentTiles() };
  // Les tuiles d'abord : leur copie est synchrone, celle des pages attend les chargements en vol.
  if (budgets.texturePoolBytes !== undefined) {
    const pool = texturePoolFor(budgets.texturePoolBytes, setup.gpuDevice);
    if (pool.layers !== setup.texturePool.layers && vis.textures && !run.lost) {
      evictedTiles = vis.textures.resize(pool.layers);
      // Tout de suite, avant qu'une image ne passe : les groupes nomment un pool détruit.
      dropPoolBindGroups(rt);
    }
    setup.texturePool = pool;
  }
  if (budgets.geometryPoolBytes !== undefined) {
    const pool = setup.geometryPoolFor(budgets.geometryPoolBytes);
    if (pool.slots !== setup.slots && gpu.cache && !run.lost) {
      const evicted = await gpu.cache.resize(pool.slots);
      // Une page épinglée qui vient d'être évincée : la trace des pins le sait, et le pas des pins la
      // remet dans la file si l'image la garde encore — le chemin d'un abandon de page de l'hôte.
      for (const url of evicted) {
        const key = setup.tracking.pageCatalogIds.get(url);
        if (key !== undefined) setup.tracking.unmarkPinned(key);
      }
      evictedPages = evicted.length;
      dropPoolBindGroups(rt);
    }
    setup.geometryPool = pool;
  }
  // Origine du changement de ressources : ce que l'image tient a changé de place ou de taille.
  run.gate.resourcesChanged();
  const report = {
    geometryPool: setup.geometryPool,
    texturePool: setup.texturePool,
    evictedPages,
    evictedTiles,
    residentPages: { before: before.pages, after: residentPages() },
    residentTiles: { before: before.tiles, after: residentTiles() },
    durationMs: performance.now() - started,
  };
  diag.engineDiagnostic('memory-budgets', 'Réservoirs de mémoire réglés', report);
  return report;
}
