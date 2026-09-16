// L'erreur écran annoncée par `clusterErrorPixels` est un contrat : elle majore le déplacement, en
// pixels, de tout point de la sphère déplacé d'au plus ε. Le défaut 3 la prenait sur la distance du
// centre à l'œil, ce qui l'ignorait la direction du déplacement et la distance à l'axe de vue :
// hors axe, la valeur annoncée passait sous la valeur réelle. Ces tests tiennent la borne contre une
// vraie projection perspective, et `clusterErrorAtDepth` contre `clusterErrorPixels`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterErrorAtDepth, clusterErrorPixels, screenErrorBound } from './index.ts';

const FOCALE = 640,
  PROCHE = 0.25;

/** L'ancienne formule, telle que le moteur l'appliquait : `ε·s·f / (|C| − r·s)`. */
function ancienne(error: number, stretch: number, c: number[], radius: number) {
  const distance = Math.hypot(c[0], c[1], c[2]) - radius * stretch;
  return distance > PROCHE ? (error * stretch * FOCALE) / distance : Infinity;
}

const pixel = (p: number[]) => [(FOCALE * p[0]) / -p[2], (FOCALE * p[1]) / -p[2]];

/** Points répartis sur la sphère (spirale de Fibonacci), centre compris. */
function surface(centre: number[], radius: number, n = 240) {
  const points = [centre.slice()],
    or = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * i + 1) / n,
      r = Math.sqrt(Math.max(0, 1 - z * z)),
      a = or * i;
    points.push([
      centre[0] + radius * r * Math.cos(a),
      centre[1] + radius * r * Math.sin(a),
      centre[2] + radius * z,
    ]);
  }
  return points;
}

/** Directions unitaires : les six axes, les diagonales, et la spirale, pour le pire déplacement. */
function directions(n = 120) {
  const liste = [];
  for (const axe of [0, 1, 2])
    for (const signe of [-1, 1]) {
      const v = [0, 0, 0];
      v[axe] = signe;
      liste.push(v);
    }
  const or = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * i + 1) / n,
      r = Math.sqrt(Math.max(0, 1 - z * z)),
      a = or * i;
    liste.push([r * Math.cos(a), r * Math.sin(a), z]);
  }
  return liste;
}

/** Le pire déplacement écran réel : tout point de la sphère, toute direction, de longueur ε. */
function pireDeplacement(centre: number[], radius: number, epsilon: number) {
  let pire = 0;
  for (const p of surface(centre, radius)) {
    if (-p[2] <= PROCHE) continue;
    const avant = pixel(p);
    for (const d of directions()) {
      const apres = [p[0] + epsilon * d[0], p[1] + epsilon * d[1], p[2] + epsilon * d[2]];
      if (-apres[2] <= PROCHE) return Infinity;
      const q = pixel(apres);
      pire = Math.max(pire, Math.hypot(q[0] - avant[0], q[1] - avant[1]));
    }
  }
  return pire;
}

const annonce = (centre: number[], radius: number, epsilon: number, stretch = 1) =>
  clusterErrorPixels(epsilon, stretch, centre[0], centre[1], centre[2], radius, FOCALE, PROCHE);

test('la borne majore le déplacement écran réel, hors axe comme sur l axe', () => {
  const cas: Array<{ nom: string; centre: number[]; radius: number; epsilon: number }> = [
    { nom: 'sur l axe', centre: [0, 0, -10], radius: 1, epsilon: 0.05 },
    { nom: 'hors axe', centre: [8, 0, -10], radius: 1, epsilon: 0.05 },
    { nom: 'hors axe en diagonale', centre: [6, -7, -12], radius: 2, epsilon: 0.2 },
    { nom: 'près du plan proche', centre: [0.4, 0.3, -2], radius: 0.5, epsilon: 0.01 },
    { nom: 'grande sphère lointaine', centre: [-40, 15, -300], radius: 30, epsilon: 1.5 },
  ];
  for (const { nom, centre, radius, epsilon } of cas) {
    const reel = pireDeplacement(centre, radius, epsilon);
    assert.ok(
      reel <= annonce(centre, radius, epsilon),
      `${nom} : réel ${reel} px au-dessus de l'annoncé ${annonce(centre, radius, epsilon)} px`,
    );
  }
});

test('hors axe, l ancienne formule annonçait moins que le déplacement réel', () => {
  const centre = [8, 0, -10],
    radius = 1,
    epsilon = 0.05;
  const reel = pireDeplacement(centre, radius, epsilon);
  assert.ok(
    reel > ancienne(epsilon, 1, centre, radius),
    `le défaut 3 suppose un réel ${reel} px au-dessus de l'ancien annoncé`,
  );
  assert.ok(reel <= annonce(centre, radius, epsilon), 'et la borne corrigée le couvre');
});

test('clusterErrorAtDepth est clusterErrorPixels dont l axe et la profondeur sont déjà pris', () => {
  const centres: Array<[number, number, number]> = [
    [0, 0, -10],
    [-30, 4, -120],
    [0.001, 0, -0.2],
    [0, 0, 0],
    [0, 0, 10],
  ];
  for (const [x, y, z] of centres)
    for (const error of [0, 1e-6, 0.5, 9, Infinity])
      for (const radius of [0, 1, 40])
        assert.ok(
          Object.is(
            clusterErrorAtDepth(error, 1.25, Math.sqrt(x * x + y * y), -z, radius, FOCALE, PROCHE),
            clusterErrorPixels(error, 1.25, x, y, z, radius, FOCALE, PROCHE),
          ),
          `erreur ${error}, rayon ${radius}, centre ${x},${y},${z}`,
        );
});

test('une sphère derrière l œil ou touchant le plan proche annonce l infini', () => {
  assert.equal(annonce([0, 0, 10], 1, 0.05), Infinity, 'derrière l œil');
  assert.equal(annonce([0, 0, -0.3], 1, 0.05), Infinity, 'à cheval sur le plan proche');
  assert.equal(annonce([0, 0, -1], 0, 2), Infinity, 'déplacée jusque sur le plan proche');
});

test('une erreur nulle ne projette rien et une erreur infinie reste sélectionnable', () => {
  assert.equal(annonce([8, 0, -10], 1, 0), 0);
  assert.equal(annonce([8, 0, -0.1], 1, 0), 0, 'même contre le plan proche');
  assert.equal(annonce([8, 0, -10], 1, Infinity), Infinity);
});

test('la borne décroît avec la distance et croît avec la sphère englobante', () => {
  const centre = [6, -7, -12];
  let precedent = Infinity;
  for (const k of [1, 1.5, 2, 4, 8]) {
    const loin = annonce(
      centre.map((v) => v * k),
      1,
      0.05,
    );
    assert.ok(loin < precedent, `le rayon ${k} annonce ${loin} px, pas moins que ${precedent} px`);
    precedent = loin;
  }
  let englobant = 0;
  for (const radius of [0, 0.5, 1, 3]) {
    const valeur = annonce(centre, radius, 0.05);
    assert.ok(valeur > englobant, `rayon ${radius} : ${valeur} px n'englobe pas ${englobant} px`);
    englobant = valeur;
  }
});

test('clusterErrorAtDepth refuse les mêmes paramètres malformés que clusterErrorPixels', () => {
  assert.throws(() => clusterErrorAtDepth(1, 1, NaN, 10, 1, 600, 0.1), /Parametres de cluster/);
  assert.throws(() => clusterErrorAtDepth(1, 1, 0, NaN, 1, 600, 0.1), /Parametres de cluster/);
  assert.throws(() => clusterErrorAtDepth(-1, 1, 0, 10, 1, 600, 0.1), /Parametres de cluster/);
  assert.throws(() => clusterErrorAtDepth(1, 1, 0, 10, -1, 600, 0.1), /Parametres de cluster/);
  assert.throws(() => clusterErrorPixels(1, 1, NaN, 0, -10, 1, 600, 0.1), /Parametres de cluster/);
});

test('screenErrorBound ne garde aucune garde : l appelant a déjà trié ses paramètres', () => {
  assert.equal(screenErrorBound(0.05, 1, Infinity, 10, 1, FOCALE, PROCHE), Infinity);
  assert.equal(screenErrorBound(0.05, 1, 8, Infinity, 1, FOCALE, PROCHE), Infinity);
  assert.ok(Number.isFinite(screenErrorBound(0.05, 1, 8, 10, 1, FOCALE, PROCHE)));
});
