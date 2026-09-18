// Le PRIX DU RELEVÉ, mesuré sur la carte : ce qu'une image paie à rapatrier la coupe, et ce que le
// pire cas y ajoute pour rien.
//
// Le tampon de relevé est taillé sur `pageCount`, et la copie d'image en emporte la totalité
// (`gpuDagResources.ts`, `gpuDagDispatch.ts`). La coupe utile, elle, ne fait que quelques dizaines
// de milliers de rangs. Ce banc appelle la coupe LIVRÉE — `createDagResources` et
// `encodeDagKernels` — et ne change qu'une chose entre les deux variantes : le nombre d'octets que
// la copie emporte. L'écart est donc exactement le prix du pire cas, sur le même travail de noyau.
//
//   node --experimental-strip-types packages/sdk-browser/test/justesse/releve-coupe-gpu.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dansPageWebgpu, empaquetePage } from './pageWebgpu.mjs';
import {
  SELECTION_HEADER_WORDS,
  SELECTION_LIST_CAP,
} from '../../packages/sdk-browser/gpuDagLayout.ts';

const ici = dirname(fileURLToPath(import.meta.url));

/** Les tailles de scène balayées, en FEUILLES : la pyramide en rend à peu près le double en pages.
 *  La dernière vise l'ordre de grandeur de la scène à douze instances, 1 959 792 grappes. */
const TAILLES = [12000, 120000, 500000, 1000000];
const NIVEAUX = 8;
const TOURS = 120,
  RONDES = 7;
/** Le plafond LIVRÉ, lu là où il est écrit : le banc ne le restate pas, il le vérifie. */
const PLAFOND = SELECTION_LIST_CAP;
/** Les seuils d'écran balayés : c'est le seuil qui décide la taille de la coupe, donc ce qu'un
 *  plafond peut perdre. La scène du banc a toutes ses pages résidentes et en vue, si bien qu'à
 *  seuil bas elle retient une part du catalogue qu'aucune scène réelle ne retient. */
const ERREURS = [1, 4, 16, 64];

test('le relevé livré tient sous son plafond quelle que soit la taille du catalogue', async () => {
  const script = await empaquetePage(resolve(ici, 'releveCoupePage.mjs'), 'releveCoupe');
  const erreursPage = [];
  const releve = await dansPageWebgpu(
    (argument) => globalThis.releveCoupe.executer(argument),
    {
      tailles: TAILLES,
      niveaux: NIVEAUX,
      tours: TOURS,
      rondes: RONDES,
      plafond: PLAFOND,
      erreurs: ERREURS,
    },
    { titre: 'Prix du relevé de coupe', script, erreursPage },
  );
  assert.equal(releve.indisponible, undefined, 'WebGPU doit être disponible');
  assert.deepEqual([...(releve.erreurs ?? []), ...erreursPage], []);
  const mesurees = releve.lignes.filter((ligne) => !ligne.refus);
  assert.ok(mesurees.length >= 2, 'au moins deux tailles doivent tenir sur la carte');
  const arrondi = (x) => Number(x.toFixed(4));
  const mo = (octets) => Number((octets / 1048576).toFixed(2));
  const table = mesurees.map((ligne) => {
    const [seul, livre, pireCas] = ligne.variantes.map((v) => v.ms);
    return {
      pages: ligne.pages,
      // La coupe retenue par seuil d'écran : `1` sature la scène du banc — toutes ses pages sont
      // résidentes et en vue —, `64` l'approche d'une scène réelle, où la coupe est de l'ordre du
      // centième du catalogue. C'est sur cette colonne que le plafond se choisit.
      coupeParErreur: Object.fromEntries(ligne.coupes.map((c) => [c.erreur, c.coupe])),
      moLivre: mo(ligne.octetsLivre),
      moPireCas: mo(ligne.octetsPireCas),
      // Les deux variantes de relevé se comparent ENTRE ELLES : même chemin, même `mapAsync`, et
      // elles alternent à chaque ronde pour que la dérive tombe des deux côtés. `msNoyauxSeuls`
      // n'est publié que comme contexte — il attend la file au lieu de mapper, donc il ne se
      // soustrait pas honnêtement des deux autres.
      msNoyauxSeuls: seul,
      msImageLivree: arrondi(livre),
      msImagePireCas: arrondi(pireCas),
      // La bande de bruit de la carte sur cette ligne : l'étendue des rondes, prise sur celle des
      // deux variantes qui varie le plus.
      bruit: arrondi(Math.max(ligne.variantes[1].etendue, ligne.variantes[2].etendue)),
    };
  });
  console.log(
    JSON.stringify(
      {
        adaptateur: releve.adaptateur,
        plafond: releve.plafond,
        refus: releve.lignes.filter((ligne) => ligne.refus),
        table,
      },
      null,
      2,
    ),
  );
  // Ce que ce banc AFFIRME, et rien de plus :
  // ① le relevé livré est borné par le plafond, quelle que soit la taille du catalogue ;
  // ② au-delà du plafond, le dimensionnement d'hier coûte strictement plus cher par image.
  // Le plafond lui-même se choisit sur `coupeParErreur`, pas ici.
  const capOctets = 2 * (SELECTION_HEADER_WORDS * 4 + PLAFOND * 4);
  for (const ligne of table)
    assert.ok(
      ligne.moLivre <= mo(capOctets),
      `à ${ligne.pages} pages, le relevé livré (${ligne.moLivre} Mo) doit tenir sous le plafond (${mo(capOctets)} Mo)`,
    );
  // ② N'EST PAS ASSERTÉ, et il faut le dire. Sur apple metal-3 — mémoire unifiée, où une copie ne
  // traverse aucun bus —, l'écart de temps entre un relevé de 15,2 Mo et un de 2,0 Mo est DU MÊME
  // ORDRE que la bande de bruit de la carte : environ 0,4 ms d'écart pour une bande de 0,17 à
  // 0,65 ms selon les exécutions. L'affirmer serait affirmer du bruit. Le banc le publie avec sa
  // bande, pour que le lecteur en juge, et n'affirme que ce qui est déterministe : les octets.
  //
  // Ce que cela dit du lot : le plafond rend de la MÉMOIRE — 30,4 Mo de fentes relisibles ramenées
  // à 4,0 — et borne le pire cas, pas des millisecondes. Les millisecondes se gagnent en supprimant
  // le relevé, pas en le rétrécissant. Sur une carte discrète, où la copie traverse un bus, le même
  // écart d'octets se paierait tout autrement : ce verdict vaut pour CETTE machine, et le dit.
  const plusGrande = table[table.length - 1];
  assert.ok(
    plusGrande.moPireCas > plusGrande.moLivre * 4,
    'la plus grande scène doit dépasser largement le plafond',
  );
});
