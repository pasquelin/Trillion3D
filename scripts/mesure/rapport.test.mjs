// Lot « compteurs honnêtes du harnais de mesure » : `resume()` gagne trois colonnes (triangles
// soumis, image tenue, repli sélection GPU) et n'écrit jamais 0 pour une mesure absente — seul un
// tiret le fait, comme pour les colonnes déjà en place (`num`, `mo`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { resume } from './rapport.mjs';

/** Un rapport minimal : une série, un côté, juste ce que `resume()` lit. */
function rapport(cote) {
  return {
    engine: 'moteur-test',
    scene: 'scene-test',
    commande: 'npm run mesure',
    head: 'abc123',
    sides: { a: { from: 'develop' } },
    settings: { frames: 8, warmup: 2, width: 640, height: 360, maxPages: 32 },
    startedAt: 't0',
    finishedAt: 't1',
    errors: [],
    series: [
      {
        view: 'salon',
        pixelError: 1,
        temoinAA: null,
        ecartAvantApres: null,
        sides: { a: cote },
      },
    ],
  };
}

const cotéDeBase = {
  moteur: null,
  cpuFrameMs: null,
  cpuSelectMs: null,
  gpuFrameMs: null,
  profilParEtape: null,
  selectedTriangles: null,
  uncoveredTriangles: null,
  drawnTriangles: null,
  submittedTriangles: null,
  totalSubmittedTriangles: null,
  imageTenue: null,
  repliSelectionGpu: null,
  hiZ: { tested: null, rejected: null, beyond16Texels: null, image: null },
  selection: { source: null, sha256: null, taille: 0 },
  budgetPages: { demande: 32, residentes: null },
  geometrieOctets: null,
  charge: { debut: null, fin: null },
};

test('resume() publie les trois nouvelles colonnes, chacune sous son propre en-tête', () => {
  const texte = resume(rapport({ ...cotéDeBase }));
  assert.match(texte, /\| triangles soumis opaque\/total \| image tenue \|/);
  assert.match(texte, /\| repli sélection GPU \|/);
  assert.match(texte, /\| Hi-Z testés\/rejetés\/>16 \(image\) \|/);
});

test('des compteurs mesurés s’affichent tels quels, jamais réduits à un tiret', () => {
  const texte = resume(
    rapport({
      ...cotéDeBase,
      submittedTriangles: 1500,
      totalSubmittedTriangles: 1800,
      imageTenue: true,
      repliSelectionGpu: false,
      hiZ: { tested: 200, rejected: 40, beyond16Texels: 5, image: 42 },
    }),
  );
  assert.match(texte, /\| 1500\/1800 \| oui \|/, 'triangles soumis, opaque puis total');
  assert.match(texte, /\| non \|/, 'repli sélection GPU à faux');
  assert.match(texte, /\| 200\/40\/5 \(42\) \|/, 'Hi-Z testés/rejetés/>16, puis l’image comptée');
});

test('un compteur absent est un tiret, jamais un zéro : `imageTenue`, `repliSelectionGpu`, triangles soumis, Hi-Z', () => {
  const texte = resume(
    rapport({
      ...cotéDeBase,
      submittedTriangles: null,
      totalSubmittedTriangles: null,
      imageTenue: null,
      repliSelectionGpu: null,
      hiZ: { tested: null, rejected: null, beyond16Texels: null, image: null },
    }),
  );
  assert.match(
    texte,
    /\| —\/— \| — \|/,
    'aucun triangle soumis compté : deux tirets, pas deux zéros',
  );
  assert.match(texte, /\| — \| —\/—\/— \(—\) \|/, 'ni repli GPU ni Hi-Z ne sont un zéro déduit');
  assert.doesNotMatch(
    texte,
    /\| 0\/0 \| non \|/,
    'un `null` ne se lit jamais comme un `0` ou un `non`',
  );
});

test('l’image tenue à vrai se distingue de l’image tenue à faux, pas seulement de l’absence', () => {
  const tenue = resume(rapport({ ...cotéDeBase, imageTenue: true }));
  const relachee = resume(rapport({ ...cotéDeBase, imageTenue: false }));
  assert.match(tenue, /\| oui \|/);
  assert.match(relachee, /\| non \|/);
  assert.notEqual(tenue, relachee);
});

// Lot triangles synchrones : la colonne « couverture » affiche `selected − drawn − uncovered`,
// attendue à zéro, et un tiret dès qu'un des trois compteurs manque — jamais une valeur déduite.
test('la colonne couverture affiche selected − drawn − uncovered, et drawnTriangles à côté', () => {
  const texte = resume(
    rapport({
      ...cotéDeBase,
      selectedTriangles: 900,
      drawnTriangles: 800,
      uncoveredTriangles: 100,
    }),
  );
  assert.match(texte, /\| drawnTriangles \| couverture \|/, 'les deux en-têtes, dans cet ordre');
  assert.match(texte, /\| 900 \| 800 \| 0 \|/, 'selected, drawn, puis la couverture calculée');
});

test('la couverture est un tiret dès qu’un seul des trois compteurs manque', () => {
  const sansSelected = resume(
    rapport({
      ...cotéDeBase,
      selectedTriangles: null,
      drawnTriangles: 800,
      uncoveredTriangles: 100,
    }),
  );
  const sansDrawn = resume(
    rapport({
      ...cotéDeBase,
      selectedTriangles: 900,
      drawnTriangles: null,
      uncoveredTriangles: 100,
    }),
  );
  const sansUncovered = resume(
    rapport({
      ...cotéDeBase,
      selectedTriangles: 900,
      drawnTriangles: 800,
      uncoveredTriangles: null,
    }),
  );
  // Les trois cellules (selected, drawn, couverture) ensemble : un tiret pour la couverture, jamais
  // une soustraction dont un opérande `null` a été traité comme zéro.
  assert.match(sansSelected, /\| — \| 800 \| — \|/);
  assert.match(sansDrawn, /\| 900 \| — \| — \|/);
  assert.match(sansUncovered, /\| 900 \| 800 \| — \|/);
});

test('une couverture non nulle s’affiche telle quelle, sans être réduite à un tiret', () => {
  const texte = resume(
    rapport({
      ...cotéDeBase,
      selectedTriangles: 900,
      drawnTriangles: 750,
      uncoveredTriangles: 100,
    }),
  );
  assert.match(
    texte,
    /\| 50 \|/,
    'selected − drawn − uncovered = 50, un vrai trou dans la relation',
  );
});

test('resume() ouvre la section du chemin de calcul, même quand aucun côté n’en publie', () => {
  const texte = resume(rapport({ ...cotéDeBase }));
  assert.match(texte, /## Chemin de calcul en lot/);
  assert.match(texte, /\| relevé absent de ce dist \|/);
});
