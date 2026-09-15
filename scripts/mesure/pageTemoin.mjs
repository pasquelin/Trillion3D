// Les lampes du contrat posées dans le témoin Three, côté page.
//
// Ce module est SERVI à la page (montage `/mesure/`) et importé par son URL : `measureView` est
// sérialisée par Playwright et ne peut appeler aucune fonction de module, mais un `import()` d'URL
// lui reste ouvert. C'est la seule raison de la découpe.
//
// Le harnais est un hôte comme un autre. Les adaptateurs Three ne lisent pas le magasin
// `SceneLight` : ils recopient les lampes du graphe source, et rien d'autre. L'hôte pose donc
// lui-même, en Three, les lampes que le magasin déclare — celles du fichier importé comme celles du
// banc —, par l'option publique `sceneLighting` de `createExplorer`. Aucune lampe n'est écrite ici :
// tout vient de `explorer.lights()`, donc du cache compilé et du contrat, jamais d'une scène nommée
// ni d'une position posée à la main.
//
// Les deux moteurs reçoivent alors la même lumière, et leur écart au pixel mesure enfin les
// matériaux et le rendu, non plus la convention d'éclairage.
//
// Ce que le témoin ne rend pas, nommé plutôt que deviné : aucune ombre portée. Le renderer Three du
// SDK n'allume pas ses cartes d'ombre, et une lampe qui les demanderait ferait compiler un nuanceur
// qui lit une carte absente. Une campagne de fidélité se joue donc `--ombres off` des deux côtés,
// sinon l'écart mesuré porte d'abord les ombres que seul le moteur dessine.
import * as THREE from 'three';

/** Le carré inverse physique du contrat : `directIncidence` ne connaît pas d'autre décroissance. */
const DECAY = 2;

/**
 * La pénombre Three qui reproduit le bord de cône du contrat. Le moteur adoucit le cône par
 * `smoothstep(cos θ, cos θ + douceur, cos α)` ; Three par `smoothstep(cos θ, cos(θ(1 − p)), cos α)`.
 * Les deux bords coïncident donc pour `p = 1 − acos(cos θ + douceur) / θ`, borné à [0, 1].
 */
function penombre(coneAngle, douceur) {
  const interieur = Math.acos(Math.min(1, Math.cos(coneAngle) + douceur));
  return Math.min(1, Math.max(0, 1 - interieur / Math.max(coneAngle, 1e-6)));
}

/** La lampe Three du type déclaré. Trois types au contrat, trois ici, et rien d'autre. */
function creer(light) {
  if (light.kind === 'directional') return new THREE.DirectionalLight();
  if (light.kind === 'spot') return new THREE.SpotLight();
  return new THREE.PointLight();
}

/**
 * Les valeurs du contrat appliquées à la lampe Three, dans les unités de Three : couleur linéaire,
 * intensité radiométrique sans facteur, `distance` = portée et `decay` = 2, ce qui donne exactement
 * l'atténuation fenêtrée du moteur. Une directionnelle n'a ni position ni portée : seule compte la
 * direction, que Three lit comme `position − cible`, donc l'opposée de la propagation.
 */
function appliquer(objet, light, douceur) {
  objet.color.setRGB(light.color[0], light.color[1], light.color[2], THREE.LinearSRGBColorSpace);
  objet.intensity = light.intensity;
  objet.castShadow = false;
  if (light.kind === 'directional') {
    objet.position.set(-light.direction[0], -light.direction[1], -light.direction[2]);
    objet.target.position.set(0, 0, 0);
    return;
  }
  objet.position.fromArray(light.position);
  objet.distance = light.range;
  objet.decay = DECAY;
  if (light.kind !== 'spot') return;
  objet.angle = light.coneAngle;
  objet.penumbra = penombre(light.coneAngle, douceur);
  objet.target.position.set(
    light.position[0] + light.direction[0] * light.range,
    light.position[1] + light.direction[1] * light.range,
    light.position[2] + light.direction[2] * light.range,
  );
}

/** Le résumé publié dans le relevé : ce que le témoin a reçu, jamais ce qu'on suppose qu'il a reçu. */
const resume = (lights) => ({
  nombre: lights.length,
  ponctuelles: lights.filter((light) => light.kind === 'point').length,
  projecteurs: lights.filter((light) => light.kind === 'spot').length,
  directionnelles: lights.filter((light) => light.kind === 'directional').length,
  ids: lights.map((light) => light.id),
  ombres: false,
});

/**
 * Le groupe de lampes Three que l'hôte passe en `sceneLighting`, et son suivi du magasin.
 *
 * `suivre` relit le magasin et remet le groupe en accord : il ne recrée les objets que si
 * l'ensemble des lampes a changé — sinon il n'écrit que leurs valeurs, que l'adaptateur Three
 * recopie déjà à chaque image. Un dist antérieur au contrat n'a pas `lights()` : le suivi rend
 * alors `null`, jamais un compte inventé.
 */
export function creerEclairageTemoin() {
  const groupe = new THREE.Group();
  const poses = new Map();
  let signature = null;
  return {
    groupe,
    suivre(explorer) {
      if (typeof explorer.lights !== 'function') return null;
      const lights = explorer.lights();
      const douceur = explorer.lightSettings ? explorer.lightSettings.spotEdgeSoftness : 0;
      const clef = lights.map((light) => `${light.id}:${light.kind}`).join('|');
      const change = clef !== signature;
      if (change) {
        for (const objet of poses.values()) groupe.remove(objet);
        poses.clear();
        for (const light of lights) {
          const objet = creer(light);
          poses.set(light.id, objet);
          groupe.add(objet);
        }
        signature = clef;
      }
      for (const light of lights) appliquer(poses.get(light.id), light, douceur);
      // Seul un changement d'ensemble demande une reprise : l'adaptateur recopie les valeurs seul.
      if (change) for (const backend of explorer.backends) backend.refreshSceneLighting?.();
      return resume(lights);
    },
  };
}
