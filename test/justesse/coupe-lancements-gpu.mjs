// Lot « sélection persistante, coupe en une passe », moitié LANCEMENTS : la descente se lance à plat
// sur les étages que le rangement compte, tient dans la passe de tête, et une image n'ouvre plus que
// six commandes au lieu de 3·profondeur+3.
//
// La coupe LIVRÉE est appelée pour de vrai — `createDagResources` et `encodeDagKernels`, empaquetés
// par esbuild et exécutés dans Chromium. Seul l'oracle, la coupe de `develop`, est recopié
// (`oracles/coupe-lancements.mjs`) : il n'existe plus ailleurs. La mesure n'est recevable que si les
// deux retiennent les mêmes pages et dessinent les mêmes, au bit près.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dansPageWebgpu, empaquetePage } from './pageWebgpu.mjs';

const ici = dirname(fileURLToPath(import.meta.url));

/** La profondeur livrée de la hiérarchie du banc, puis deux profondeurs ALLONGÉES : les étages de
 *  trop sont vides, la descente n'y fait rien, mais leurs commandes sont bien ouvertes. Ce sont donc
 *  des mesures de PENTE en commandes, pas des scènes profondes, et le relevé les nomme ainsi. */
const PROFONDEURS = [13, 21];
const TOURS = 200,
  RONDES = 5;
/** Le balayage du garde-fou : la largeur d'étage sur laquelle chaque niveau est lancé à plat. */
const BORNES = [0, 1000, 100000, 1000000];

const mediane = (valeurs, champ) => {
  const triees = valeurs.map((v) => v[champ]).sort((a, b) => a - b);
  return Number(triees[triees.length >> 1].toFixed(4));
};

test('la coupe ouvre moins de commandes et retient exactement les mêmes pages', async () => {
  const script = await empaquetePage(resolve(ici, 'coupeLancementsPage.mjs'), 'coupeLancements');
  const erreursPage = [];
  const releve = await dansPageWebgpu(
    (argument) => globalThis.coupeLancements.executer(argument),
    {
      feuilles: 12000,
      niveaux: 8,
      profondeurs: PROFONDEURS,
      tours: TOURS,
      rondes: RONDES,
      bornes: BORNES,
    },
    { titre: 'Lancements de la coupe', script, erreursPage },
  );
  assert.equal(releve.indisponible, undefined, 'WebGPU doit être disponible');
  assert.deepEqual(releve.compilation ?? [], [], 'les deux noyaux doivent compiler');
  assert.deepEqual([...(releve.erreurs ?? []), ...erreursPage], []);

  const [avant, apres] = releve.sorties;
  assert.ok(avant.pages.length > 0, 'la coupe doit retenir des pages');
  assert.deepEqual(apres.pages, avant.pages, 'mêmes pages voulues, au bit près');
  assert.deepEqual(apres.dessinees, avant.dessinees, 'mêmes pages dessinées, au bit près');
  assert.equal(apres.overflow, avant.overflow);
  assert.equal(apres.frustumRejected, avant.frustumRejected);
  // Un étage plus large ne change aucun verdict : les fils de trop sortent sur la garde de compte.
  for (const ligne of releve.balayage)
    assert.deepEqual(
      ligne.sortie.pages,
      apres.pages,
      `borne ${ligne.borneParNiveau} : la coupe doit être inchangée`,
    );

  const lignes = releve.profondeurs.map((profondeur, p) => ({
    profondeur,
    etages: profondeur === releve.profondeurLivree ? 'de la scène' : 'allongée (étages vides)',
    // Comptées sur les encodeurs eux-mêmes, pas déduites d'une formule.
    commandesAvant: releve.comptes[0][p].passes + releve.comptes[0][p].copies,
    commandesApres: releve.comptes[1][p].passes + releve.comptes[1][p].copies,
    passesApres: releve.comptes[1][p].passes,
    copiesApres: releve.comptes[1][p].copies,
    msTotalAvant: mediane(releve.mesures[0][p], 'total'),
    msTotalApres: mediane(releve.mesures[1][p], 'total'),
    msEncodageAvant: mediane(releve.mesures[0][p], 'encodage'),
    msEncodageApres: mediane(releve.mesures[1][p], 'encodage'),
  }));
  for (const ligne of lignes)
    ligne.gainPourCent = Number((100 * (1 - ligne.msTotalApres / ligne.msTotalAvant)).toFixed(1));
  // La PENTE, prise entre la profondeur la plus courte et la plus longue : ce qu'un niveau de plus
  // coûte de chaque côté. C'est la seule attribution que ce banc soutienne — un niveau d'avant
  // ouvre sa passe DERRIÈRE deux copies hors passe, un niveau d'après est un lancement à plat dans
  // la passe de tête, et rien ici ne sépare proprement la copie de la passe qu'elle coupe : retirer
  // l'armement changerait aussi la taille du lancement, donc le travail fait.
  const bornes = [lignes[0], lignes[lignes.length - 1]];
  const pente = (champ) =>
    Number(
      (
        (1000 * (bornes[1][champ] - bornes[0][champ])) /
        (bornes[1].profondeur - bornes[0].profondeur)
      ).toFixed(1),
    );
  const pentes = {
    usParNiveauAvant: pente('msTotalAvant'),
    usParNiveauApres: pente('msTotalApres'),
  };
  console.log(
    JSON.stringify(
      {
        adaptateur: releve.adaptateur,
        pages: releve.pages,
        noeuds: releve.noeuds,
        profondeurLivree: releve.profondeurLivree,
        etagesLivres: releve.etagesLivres,
        pagesRetenues: avant.pages.length,
        pagesDessinees: avant.dessinees.length,
        imagesParMesure: TOURS,
        rondes: RONDES,
        lignes,
        pentes,
        // Le garde-fou : ce que coûtent les fils qui sortent aussitôt, quand un étage enfle.
        balayageDesBornes: releve.balayage.map(({ borneParNiveau, ms }) => ({
          borneParNiveau,
          ms,
        })),
      },
      null,
      2,
    ),
  );
  // Le banc publie des temps et des comptes de commandes ; il n'assert que ce qui ne dépend pas de
  // la machine : les deux coupes retiennent et dessinent les mêmes pages, et un étage plus large ne
  // change rien. Le contrat du nombre de commandes est tenu par `gpuDagEncode.test.ts`, qui compte
  // le même encodeur sans monter d'appareil ; le redire ici ne ferait que comparer deux littéraux.
});
