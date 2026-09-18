// le lot de sondes qu'une image de rebond encode, et l'asservissement de ce lot sur la durée de
// l'étape « Rebond » relevée sur la carte graphique.
import { bounceBatchOf, createBounceBudget } from '../bounceBudget.ts';
import { graine, mesure, rapport } from './socle.mjs';
import { referenceBounceBatch, referenceBudgetSequence } from './oracles/rebond-sondes.mjs';

const alea = graine(101);

// La sortie appartient au cas : le chronomètre n'encadre que les appels du moteur.
const paires = (liste) => ({ liste, sortie: new Float64Array(liste.length) });
const lot =
  (calcule) =>
  ({ liste, sortie }) => {
    for (let i = 0; i < liste.length; i++) sortie[i] = calcule(liste[i].ceiling, liste[i].load);
    return sortie;
  };

const mesureLot = await mesure({
  nom: 'lot de rebond',
  fichier: 'packages/sdk-core/bounceBudget.ts',
  cas: [
    {
      nom: '10 000 paires',
      entree: paires(
        Array.from({ length: 10000 }, () => ({
          ceiling: 100 + Math.floor(alea() * 1000),
          load: alea(),
        })),
      ),
      taille: 10000,
    },
    {
      nom: 'extrêmes',
      entree: paires([
        { ceiling: 0, load: 0 },
        { ceiling: -1, load: -1 },
        { ceiling: NaN, load: 0 },
        { ceiling: Infinity, load: 1 },
      ]),
      taille: 4,
    },
  ],
  calcul: lot(bounceBatchOf),
  attendu: lot(referenceBounceBatch),
  options: { tours: 100 },
});

// Les relevés arrivent une image sur trois ou sur douze, parfois pas du tout, parfois faux : la
// suite mêle des durées, des `null`, des zéros et des non-finis, et l'oracle rejoue la boucle
// fermée relevé par relevé. Trois tableaux de sortie, un par champ publié.
const SANS_RELEVE = [null, 0, -1, NaN, Infinity];
const observations = (nombre) => ({
  liste: Array.from({ length: nombre }, () =>
    alea() < 0.3 ? SANS_RELEVE[Math.floor(alea() * SANS_RELEVE.length)] : 1 + alea() * 4,
  ),
  loads: new Float64Array(nombre),
  lasts: new Float64Array(nombre),
  samples: new Float64Array(nombre),
});
const suit = (observe) => (entree) => {
  const budget = observe(2);
  for (let i = 0; i < entree.liste.length; i++) {
    budget.observe(entree.liste[i]);
    entree.loads[i] = budget.load;
    entree.lasts[i] = budget.lastMs ?? -1;
    entree.samples[i] = budget.samples;
  }
  return [entree.loads, entree.lasts, entree.samples];
};

const mesureBudget = await mesure({
  nom: 'asservissement du budget',
  fichier: 'packages/sdk-core/bounceBudget.ts',
  cas: [
    { nom: '100 observations', entree: observations(100), taille: 100 },
    { nom: 'aucun relevé', entree: observations(20), taille: 20 },
  ],
  calcul: suit(createBounceBudget),
  attendu: suit(referenceBudgetSequence),
  options: { tours: 100 },
});

rapport(
  'rebond-sondes',
  [mesureLot, mesureBudget],
  'le lot et le budget de rebond rendent les mêmes valeurs',
);
