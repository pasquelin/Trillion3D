// Le bilan en tête du rapport : ce qu'il faut faire, dans l'ordre. Une ligne par point, chaque chiffre pris dans les relevés de la campagne.
import { moins, ms, nombre } from './rapportGlobalGraphes.mjs';
import { paire, trouve } from './rapportGlobalLecture.mjs';
import { OCTETS_PAR_TRIANGLE, UNREAL } from './rapportGlobalChiffres.mjs';
const li = (points) => points.map((p) => `<li>${p}</li>`).join('');

export function bilan(ex) {
  const [nuS, mS] = paire(ex, 'three-nu', 'sol');
  // Les octets par triangle de Three, mesurés sur la scène telle qu'il la lit (tout le glTF).
  const nuSans = trouve(ex, 'three-nu-sans-ombres', 'sol', 1, 'avant');
  const octetsThree =
    nuSans?.trianglesUniques > 0 ? nuSans.geometrieOctets / nuSans.trianglesUniques : null;
  const sol = trouve(ex, 'mobile', 'sol', 1);
  const sansLum = trouve(ex, 'sans-lumiere', 'sol', 1);
  const inst = trouve(ex, 'instances-12', 'generale', 1);
  const faire = [
    '<strong>La mémoire</strong> : quand elle manque, le moteur s’arrête au lieu de montrer une image moins fine ; et sa limite (288 Mo) est écrite en dur, la même pour toute machine. <em>Critique, en premier.</em>',
    sol && sansLum
      ? `<strong>Les ombres du soleil</strong> : ${ms(moins(sol.gpuP50, sansLum.gpuP50))} sur ${ms(sol.gpuP50)} depuis la rue. Les garder d’une image à l’autre au lieu de les redessiner.`
      : '',
    `<strong>La géométrie</strong> : ${OCTETS_PAR_TRIANGLE.nous} octets par triangle, ${nombre(OCTETS_PAR_TRIANGLE.nous / UNREAL.octetsParTriangle, 0)} fois Unreal (${nombre(UNREAL.octetsParTriangle, 1)}), ${octetsThree === null ? '' : `contre ${nombre(octetsThree, 0)} pour Three qui garde tout le glTF, tangentes comprises`}. Compresser à la cuisson, comme Unreal.${inst ? ` Et douze copies du modèle = ${nombre(inst.geometrieOctets / 1e6, 0, 'Mo')} : une seule copie, l’instance en index.` : ''}`,
    sol
      ? `<strong>Les textures</strong> : ${nombre(sol.texturesEngagees / 1e9, 1, 'Go')} en mémoire, sans compression. Unreal compresse et se fixe une réserve.`
      : '',
    nuS && mS && sansLum
      ? `<strong>Depuis la rue, le moteur vaut Three.js</strong> (${ms(mS.gpuP50)} contre ${ms(nuS.imageSyncP50)}) : même sans lampe, son socle coûte ${ms(sansLum.gpuP50)}. La passe matériaux, plein écran, est la suivante à mesurer.`
      : '',
  ].filter(Boolean);
  return `<div class="bilan"><div class="bilan-faire"><h3>Ce qu’il faut faire, dans l’ordre</h3><ol>${li(faire)}</ol></div></div>`;
}

export const STYLE_BILAN = `
.bilan{margin:16px 0 28px}.bilan>div{border-radius:12px;padding:20px 24px;background:var(--surface);border:1px solid var(--bord)}.bilan-faire{border-left:6px solid var(--mauvais)}.bilan h3{margin:0 0 10px;font-size:21px}.bilan ul,.bilan ol{margin:0;padding-left:22px}.bilan li{font-size:17px;line-height:1.45;margin:8px 0}
`;
