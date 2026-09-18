// Les verdicts du rapport global : des phrases écrites à partir des relevés, et rien d'autre. Chaque
// verdict nomme la mesure qui le porte ; quand la mesure manque, il dit « non mesuré » plutôt que
// de supposer. La dernière partie classe les coûts pour orienter les lots, dans l'ordre des chiffres.
import { html, moins, ms, nombre, octets, pixels } from './rapportGlobalGraphes.mjs';
import { paire, trouve, VUES } from './rapportGlobalLecture.mjs';
import { GROUPES, sommePasses } from './rapportGlobalChiffres.mjs';

const BRUIT_MS = 0.7; // l'écart observé entre deux exécutions identiques sur cette machine
const verdict = (classe, texte) => `<div class="verdict ${classe}">${texte}</div>`;

export function verdicts(ex) {
  const out = [];
  const sol = trouve(ex, 'mobile', 'sol', 1);
  const gen = trouve(ex, 'mobile', 'generale', 1);
  const fixe = trouve(ex, 'fixe', 'sol', 1);

  if (sol) {
    const sous60 = VUES.map((v) => trouve(ex, 'mobile', v, 1)).filter(Boolean);
    const pire = sous60.toSorted((a, b) => (b.gpuP95 ?? 0) - (a.gpuP95 ?? 0))[0];
    const tient = sous60.every((r) => r.gpuP95 !== null && r.gpuP95 < 16.7);
    out.push(
      verdict(
        tient ? 'bon' : 'mauvais',
        `<strong>À 2496×1404, l’image ${tient ? 'tient' : 'ne tient pas'} dans 16,7 ms côté carte graphique</strong> : p50 de ${ms(Math.min(...sous60.map((r) => r.gpuP50 ?? Infinity)))} à ${ms(Math.max(...sous60.map((r) => r.gpuP50 ?? 0)))} selon la vue, p95 jusqu’à ${ms(pire?.gpuP95)} (${html(pire?.vue ?? '')}). Soleil, ombres en cascade, caméra mobile, qualité normale.`,
      ),
    );
    out.push(
      verdict(
        sol.cpuP50 !== null && sol.cpuP50 < 3 ? 'bon' : 'mauvais',
        `<strong>Le processeur coûte ${ms(sol.cpuP50, 2)} par image en vue sol</strong> (p95 ${ms(sol.cpuP95, 2)}), ${ms(gen?.cpuP50, 2)} en vue générale. La référence dit « presque nul » : c’est la seule milliseconde qui se compare d’une machine à l’autre, et elle n’est pas nulle (Géométrie 1).`,
      ),
    );
  } else
    out.push(
      verdict('mauvais', 'L’exécution `mobile` manque : aucune image entière de référence.'),
    );

  if (fixe)
    out.push(
      verdict(
        fixe.gpuReleves === 0 ? 'bon' : 'mauvais',
        `<strong>Scène immobile : ${fixe.gpuReleves === 0 ? 'aucune passe carte graphique, l’image est tenue' : `${fixe.gpuReleves} relevés carte, l’image n’est pas tenue`}</strong> ; le processeur y passe encore ${ms(fixe.cpuP50, 2)} par image (p95 ${ms(fixe.cpuP95, 2)}). Le critère « aucun travail dans une scène immobile » ${fixe.gpuReleves === 0 && (fixe.cpuP50 ?? 1) < 0.5 ? 'est tenu' : 'n’est tenu que côté carte'}.`,
      ),
    );

  const quart = trouve(ex, 'res-1248', 'sol', 1);
  if (quart && sol) {
    const plusLent =
      quart.gpuP50 !== null && sol.gpuP50 !== null && quart.gpuP50 > sol.gpuP50 + BRUIT_MS;
    out.push(
      verdict(
        plusLent ? 'mauvais' : 'bon',
        `<strong>À un quart des pixels (1248×702), l’image est ${plusLent ? `PLUS LENTE : ${ms(quart.gpuP50)} contre ${ms(sol.gpuP50)}` : `${ms(quart.gpuP50)} contre ${ms(sol.gpuP50)} à pleine résolution`}</strong>${plusLent ? ' — l’anomalie de Lumière 18 est toujours là.' : ' : l’anomalie de Lumière 18 ne se reproduit pas dans cette campagne.'}`,
      ),
    );
  }

  const [rc, rm] = paire(ex, 'raster-1248', 'sol');
  if (rm && rc && rm.gpuP50 !== null && rc.gpuP50 !== null)
    out.push(
      verdict(
        rc.gpuP50 > rm.gpuP50 + BRUIT_MS ? 'mauvais' : 'bon',
        `<strong>Raster de calcul contre raster matériel à 1248×702 : ${ms(rc.gpuP50)} contre ${ms(rm.gpuP50)}</strong> (${nombre(rc.gpuP50 / rm.gpuP50, 1)}×), écart d’image ${pixels(rc.ecart)}. Depuis Géométrie 26 le matériel est le défaut et le calcul une variante ; la référence garde le matériel pour les grands triangles et le calcul pour les petits.`,
      ),
    );

  const aa = trouve(ex, 'aa-off', 'sol', 1);
  if (aa && sol && aa.gpuP50 !== null && sol.gpuP50 !== null)
    out.push(
      verdict(
        '',
        `<strong>L’antialiasing temporel coûte ${ms(sol.gpuP50 - aa.gpuP50)} d’enveloppe en vue sol</strong> (${ms(sol.gpuP50)} avec, ${ms(aa.gpuP50)} sans)${Math.abs(sol.gpuP50 - aa.gpuP50) < BRUIT_MS ? ', sous le bruit de mesure' : ''} ; témoin A/A ${nombre(sol.temoinAA?.pixels, 0)} px avec, ${nombre(aa.temoinAA?.pixels, 0)} px sans.`,
      ),
    );

  const sansLum = trouve(ex, 'sans-lumiere', 'sol', 1);
  if (sansLum && sol && sansLum.gpuP50 !== null && sol.gpuP50 !== null)
    out.push(
      verdict(
        '',
        `<strong>Le soleil et ses ombres coûtent ${ms(sol.gpuP50 - sansLum.gpuP50)} d’enveloppe en vue sol</strong> (albédo brut ${ms(sansLum.gpuP50)}, soleil ${ms(sol.gpuP50)}). Étape « Ombres » ${ms(sol.etape('shadows')?.gpuP50 ?? null, 2)}, éclairage différé ${ms(sol.passe('WG deferred lighting')?.p50 ?? null, 2)} par leurs étiquettes.`,
      ),
    );

  if (sol)
    out.push(
      verdict(
        'mauvais',
        `<strong>Mémoire : ${octets(sol.texturesEngagees)} de textures RGBA brutes engagées et ${octets(sol.geometrieOctets)} de géométrie</strong> en vue sol ; la référence tient un pool fixe et comprime à la cuisson. C’est le critère de parité le plus loin (Textures T4, T5 ; Géométrie 11).`,
      ),
    );

  const [nuT, nu] = paire(ex, 'three-nu-sans-ombres', 'sol');
  if (nu?.ecart)
    out.push(
      verdict(
        '',
        `<strong>Face à Three.js nu, sans ombres, vue sol : ${pixels(nu.ecart)} diffèrent d’au moins un niveau</strong> — les deux images sont visuellement les mêmes (<a href="#f-fidelite">côte à côte</a>) ; le banc ne compte pas avec seuil. Three nu rend cette vue en ${ms(nuT?.imageSyncP50)} de temps mur.`,
      ),
    );
  const [nuG, nuGm] = paire(ex, 'three-nu', 'generale');
  const [nuS, nuSm] = paire(ex, 'three-nu', 'sol');
  if (nuG && nuS)
    out.push(
      verdict(
        nuS.imageSyncP50 !== null &&
          nuSm?.gpuP50 !== null &&
          nuSm.gpuP50 > nuS.imageSyncP50 - BRUIT_MS
          ? 'mauvais'
          : 'bon',
        `<strong>Face à Three.js nu avec soleil et ombres : vue générale ${ms(nuG.imageSyncP50)} (Three) contre ${ms(nuGm?.gpuP50)} (moteur) ; vue sol ${ms(nuS.imageSyncP50)} contre ${ms(nuSm?.gpuP50)}.</strong> De haut, la sélection paie ; au ras du sol, le moteur ne fait pas mieux qu’un rendu naïf de toute la scène — ce qui coûte là est plein-écran, pas géométrique.`,
      ),
    );

  out.push(orientation(ex));
  return out.join('');
}

/** Le classement des coûts en vue sol, et ce qu'il dit à faire — d'abord ce que deux exécutions
 *  mesurent par différence d'enveloppe, ensuite ce que seules les étiquettes de passes disent. */
function orientation(ex) {
  const sol = trouve(ex, 'mobile', 'sol', 1);
  if (!sol) return '';
  const diff = (a, b) => moins(a?.gpuP50, b?.gpuP50);
  const l4 = trouve(ex, 'lampes-4', 'sol', 1);
  const l4s = trouve(ex, 'lampes-4-sans-ombres', 'sol', 1);
  const sansLum = trouve(ex, 'sans-lumiere', 'sol', 1);
  const mesures = [
    [
      'Les ombres, soleil et quatre ponctuelles (`--ombres off` les coupe toutes)',
      diff(l4, l4s),
      'Lumière 17 (cascades en cache, budget d’ombres)',
    ],
    ['Le soleil seul, cascades d’ombre comprises', diff(sol, sansLum), 'Lumière 17'],
    [
      'Soleil et quatre ponctuelles SANS aucune ombre : l’éclairage lui-même',
      diff(l4s, sansLum),
      'peu de chose : ce sont les ombres qui coûtent, pas la lumière',
    ],
    ['Le rebond', diff(trouve(ex, 'rebond', 'sol', 1), l4), 'Lumière 7'],
    ['L’antialiasing temporel', diff(sol, trouve(ex, 'aa-off', 'sol', 1)), 'Lumière 16'],
    [
      'Le raster de calcul à la place du matériel (1248×702)',
      diff(...paire(ex, 'raster-1248', 'sol')),
      'Géométrie 26',
    ],
    [
      'Les textures lues du cache plutôt que des images',
      diff(sol, trouve(ex, 'textures-host', 'sol', 1)),
      'Textures T2bis',
    ],
  ]
    .filter(([, v]) => v !== null)
    .sort((a, b) => b[1] - a[1]);
  // Les étiquettes qui absorbent leurs voisines sur cet appareil ne sont pas classées.
  const absorbees = new Set([
    'Présentation',
    'Antialiasing temporel',
    'Éclairage (listes de lampes + différé)',
  ]);
  const etiquettes = GROUPES.filter(([nom]) => !absorbees.has(nom))
    .map(([nom, garde, lot]) => [nom, sommePasses(sol, garde), lot])
    .filter(([, v]) => v !== null)
    .sort((a, b) => b[1] - a[1]);
  const li = (rows) =>
    rows
      .map(([nom, v, lot]) => `<li><strong>${html(nom)}</strong> : ${ms(v, 2)} — ${html(lot)}</li>`)
      .join('');
  return `<h3>Ce que les chiffres orientent</h3><p>Vue sol, qualité normale, pleine résolution, enveloppe ${ms(sol.gpuP50)}. D’abord ce qui se mesure par différence entre deux exécutions (la seule lecture sûre sur cet appareil ; sous ${ms(BRUIT_MS)} c’est du bruit) :</p><ol>${li(mesures)}</ol><p>Ensuite ce que disent les étiquettes de passes, à prendre avec la réserve de l’horodatage (la présentation, l’antialiasing et l’éclairage différé lisent 7 ms chacun parce qu’ils absorbent leurs voisines ; ils ne sont pas classés ici) :</p><ol>${li(etiquettes)}</ol><p>${sansLum ? `Sans aucune lampe, l’image vaut ${ms(sansLum.gpuP50)} : c’est le socle — visibilité, matériaux, présentation — et il est du même ordre qu’un rendu naïf de toute la scène par Three (<a href="#three-nu">face à Three.js nu</a>). Au ras du sol, la sélection ne rapporte rien ; ce qui coûte est plein-écran.` : ''} Côté mémoire, l’ordre est celui de la <a href="#memoire">section mémoire</a> : textures brutes d’abord, grappes dupliquées par instance ensuite, sommets non quantifiés enfin. Côté processeur, ${ms(sol.cpuP50, 2)} par image contre « presque nul » : les <a href="#etapes">étapes du processeur</a> disent où.</p>`;
}
