import { clusterHash, visMaterial } from './visibilityBuffer.ts';
import { wrapModes } from './visibilityWrapModes.ts';
import type { VisMaterial } from './visibilityTypes.ts';

/** Le matériau tel que la fiche le reçoit de l'hôte : le type que `visMaterial` accepte déjà. */
type HostMaterial = Parameters<typeof visMaterial>[0];

/** Ce qu'un matériau apporte à une fiche de page : ses champs lus, et son mot d'adressage. */
type MaterialRow = { version: number; mat: VisMaterial; wrap: number };

/**
 * Ce que l'écriture d'une fiche de page recalculait à chaque fois alors que rien n'en dépend que le
 * catalogue compilé : les champs du matériau — un objet et quatre tableaux neufs par écriture —,
 * son mot d'adressage et le hachage du cluster — un tableau de points de code par écriture.
 *
 * Douze placements d'une même scène partagent leurs matériaux et leurs clusters : une mémoire par
 * matériau et une par identifiant de cluster suffisent à ne les calculer qu'une fois pour toutes,
 * quel que soit le nombre de pages qui arrivent dans l'image. La mémoire d'un matériau est relue
 * quand Three en change la version, la seule mutation que le moteur lui fasse subir.
 */
export function createPageRowConstants() {
  const materials = new Map<HostMaterial, MaterialRow>();
  const hashes = new Map<string, number>();
  return {
    /** Les champs et le mot d'adressage d'un matériau, calculés à sa première fiche. */
    materialOf(material: HostMaterial) {
      const version = (Array.isArray(material) ? material[0] : material).version;
      const held = materials.get(material);
      if (held && held.version === version) return held;
      const mat = visMaterial(material);
      const row = { version, mat, wrap: wrapModes(mat) };
      materials.set(material, row);
      return row;
    },
    /** Le hachage d'un identifiant de cluster, calculé à sa première fiche. */
    hashOf(clusterId: string) {
      const held = hashes.get(clusterId);
      if (held !== undefined) return held;
      const hash = clusterHash(clusterId);
      hashes.set(clusterId, hash);
      return hash;
    },
  };
}
