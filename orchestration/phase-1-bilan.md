# Bilan de la phase 1 — WebGPU (R5, R6) et sélection WebGL2

Arrêté le 14 septembre 2026, worktree `chantier-phase1-3`, branche partie de develop `3011323`.
« Avant journée » = l'état de develop au matin, tel que les entrées de journal du lot 2, du lot 4 et
du lot 4b le donnent ; « après » = les mesures de ce chantier, harnais commun `scripts/mesure/banc.mjs`,
Emerald, 1 instance, 1280×720, 60 images par série, budget 100 000 pages.

| mesure | avant journée | après | seuil | verdict | preuve |
|---|---|---|---|---|---|
| WebGPU CPU par image (générale, seuil 0) | 28,0 ms | 28,0 ms | < 4 ms | **non atteint**, aucun levier posé | `.mesure/out/webgpu-2026-09-14T20-25-23-002Z/` |
| WebGPU GPU par image (générale, seuil 0) | 20,88 ms | 15,26 ms (**−27 %**), non conservé | < 6 ms | **non atteint** ; le gain existe mais coûte 67 px | idem, et branche `chantier-phase1-3-hiz-temporelle` |
| WebGL2 sélection CPU (générale, seuil 0) | 5,2 ms (lot 4b) puis 4,90 ms mesuré ici | 4,80 ms ; **2,40 ms au seuil 1** (avant 3,00) | < 2 ms | **non atteint** | `.mesure/out/webgl-2026-09-14T20-45-20-908Z/` |
| WebGL2 CPU par image (générale, seuil 0) | 29,5 ms | 30,3 ms | — (R7 : < 8 ms) | non atteint, hors périmètre des lots 3 et 4c | idem |
| Pixels différents (0 px et 1 px) | 0 px | **0 px** sur les six séries WebGL2 ; 67/37/173/1 px sur WebGPU si la partition temporelle est conservée | 0 px | **OK sur la branche livrée** | tableaux « témoin A/A » des deux résumés |
| Tests | 410 tests, 0 échec (lot 4b) | **non rejoués** | 0 échec | **non fait** — voir `livraison-chantier-phase1-3.md` | — |

## Ce que la journée a établi, au-delà des chiffres

1. **La partition Hi-Z par moitié était bien le verrou WebGPU, et le lever donne 20 à 38 % de GPU.**
   Tester toutes les lignes contre la pyramide complète de l'image précédente, plutôt que d'en
   dessiner la moitié sans test, fait baisser `gpuFrameMs` sur **six séries sur six**. La prémisse
   « le test temporel ne décide que de la passe, jamais du dessin » est vraie de la partition et
   fausse de la couverture du test : develop ne testait jamais la moitié occluder, donc tester tout
   rejette davantage et **change l'ensemble dessiné**. 67 à 173 pixels isolés en découlent.
2. **Le témoin A/A ne suffit pas à innocenter le harnais**, et un contrôle `develop` contre
   `develop` dans le même triplet le fait : il rend 0 px partout. La piste « artefact d'horloge de
   prélecture » que le lot 4b avait laissée ouverte ne couvre pas cet écart-ci.
3. **Le coût de la sélection CPU n'est pas là où le diagnostic le plaçait.** Supprimer toutes les
   projections de la descente à seuil nul — ce qui est faisable exactement — ne rend rien de
   mesurable. Les 60 ns par cluster sont dans la retenue par cluster, pas dans la décision de niveau.
4. **La charge de la machine (6 à 11 pendant toute la journée) est au-dessus de ce que ces cibles
   demandent.** Un écart de 15 % entre deux séries du même côté a été relevé ; aucune cible à
   quelques millisecondes ne peut être tranchée dans ces conditions. Les verdicts « non atteint »
   ci-dessus le sont largement (4,8 contre 2 ; 15,3 contre 6), donc ils tiennent malgré le bruit.

## Ce qui reste de la phase 1

- **WebGPU GPU < 6 ms** : la partition temporelle est écrite et mesurée ; il manque de trancher entre
  les deux causes des pixels — départage de surfaces coplanaires, ou `nearestDepth` qui n'est pas un
  minorant strict de la profondeur rastérisée depuis des positions quantifiées. Dans le second cas
  un biais de test dérivé de l'erreur de quantification suffit, et il ne peut que réduire les rejets.
- **WebGPU CPU < 4 ms** : intouché. 28 ms par image, dont la part de la préparation des lignes, de
  l'encodage et des téléversements n'a pas été profilée ici.
- **WebGL2 sélection < 2 ms** : l'émission de plages jusqu'au consommateur, nommée par le lot 4 puis
  par le lot 4b, reste le seul levier crédible.
