// La scène de la preuve « un transparent suit `setTransform` » : un fond opaque plein cadre, et un
// carreau transparent nommé `vitre` sous un nœud `pivot`. Le moteur ne le distingue que par la
// passe déclarée et par son matériau.
import * as THREE from 'three';
import { batisseur, carre } from './preuveSceneCommune.mjs';

/** Demi-largeur du carreau transparent : la fenêtre d'échantillonnage en dépend, pas l'inverse. */
export const DEMI = 0.35;

/**
 * `pagine` choisit la passe du carreau — `clustered-blend` le fait passer par les pages du DAG,
 * `shared-blend` par le chemin non paginé.
 */
export function sceneTransparente(pagine) {
  const bati = batisseur();
  const fond = new THREE.Mesh(
    carre(4),
    new THREE.MeshBasicMaterial({ color: 0x1b3a5c, side: THREE.DoubleSide }),
  );
  fond.name = 'fond';
  fond.position.z = -2;
  bati.source.add(fond);
  bati.ajoute(fond, 'exact-clusters', 4);
  const vitre = new THREE.Mesh(
    carre(DEMI),
    new THREE.MeshBasicMaterial({
      color: 0xff2020,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    }),
  );
  vitre.name = 'vitre';
  const pivot = new THREE.Group();
  pivot.name = 'pivot';
  pivot.add(vitre);
  bati.source.add(pivot);
  bati.ajoute(vitre, pagine ? 'clustered-blend' : 'shared-blend', DEMI);
  return bati.fini();
}
