# Reprise — Geometry (session sans-threejs)

## Identité et rôles
- `get_session("self")` d'abord : ce fichier est celui de la session titrée « Geometry ». Validateur = session « Validateur », seule à pousser. Voisines : Lumière, Calculateur, Compilateur.
- Fable orchestre sans coder ; Opus 5 code ; Sonnet 5 lit et vérifie, ne commite jamais ; Haiku jamais. Réponses à l'utilisateur en 5 lignes, aucune notification d'attente relayée.

## Règles (ordres de l'utilisateur du 15 sept. 2026)
- Coder TOUS les lots du plan d'affilée. Une seule passe à la fin : tests (un par comportement modifié), portes tsc / check:changed / check:unused / check:lines / check:duplicates, puis UNE campagne d'image (`scripts/mesure/banc.mjs`, vue generale seuil 0 + caméra mobile seuil 1, 60 images, A/A). Jamais de mesure entre deux lots ni après un rebase.
- Aucune attente, aucune file, aucun verrou : chaque session mesure quand elle veut. Pixels = preuve ; durées machine chargée = non mesurées. Ne jamais tuer une campagne en cours (Chrome orphelin).
- `npm run validate` = Validateur seul. Livraison = branche + SHA au Validateur, qui fusionne ; jamais de fusion, de push ni de `git stash` soi-même.
- `orchestration/` : une reprise par session + `SPEC_*.md` ouverts, 200 lignes max, jamais de journal ; preuves dans les messages de commit et de livraison.

## Défauts confirmés (audit du 15 sept. 23 h, script `/tmp/webgeometry-audit-20260915.mjs`, 7/7 rejoués sur c47231d)
1. P1 WebGL : boîte de visibilité figée à la préparation (`pageSelectionCollect.ts` ~95, `pageSelectionCut.ts` ~83) : objet déplacé devant la caméra reste invisible. Actualiser la boîte avec la transformation.
2. P1 cône : tolérance absolue 1e-12 (`pageCone.ts` ~19, et le WGSL) rejette une face visible à petite échelle. Vérification relative conservatrice.
3. P1 budget WebGL : compte les placements, pas les pages uniques (`pageSelectionCutVisit.ts` ~49, `pageSelectionCut.ts` ~97) : instances dégradées à tort. Séparer budget de résidence et nombre de dessins.
4. P2 `dropPage()` garde `rec.attributes` (`autonomousResidency.ts` ~61) : mémoire CPU qui s'accumule.
5. P2 décomposition PRS perd le cisaillement sous parent étiré (`webgpuPagesTransform.ts` ~51) : garder la matrice locale.
6. P2 erreur écran divisée par la distance euclidienne (`projectionOracles.ts` ~105 et ~142, versions CPU/GPU) : sous-estimée hors axe.
7. P2 vue copiée avant `getWorldPosition()` (`gpuSelection.ts` ~121) : caméra parentée incohérente une image.

## État (15 sept. 23 h 15)
- Livrés à 0 px : coupe WebGL2 (7aacf6f, b2a3266), boîtes Hi-Z tenues (8498cd3, CPU fixe WebGPU générale 5,9 → 4,7 ms), banc f-cones (0fd6834), `lot/selection-boxclip` e95abbb (coupe 4,17 → 3,00 ms, non fusionné, touche les fichiers des défauts 1 à 3 sans les corriger), `lot/coplanaires` 0d274e3 (historique d'occlusion, R5c : vainqueur d'égalité exacte dépendant de l'historique, ≤ 0,007 %, non fusionné).
- GPU 29 ms seuil 0 = goulot. CPU fixe restant : fiches 1,3 ms, adoption 0,9, historique occulteurs 0,4. Coupe WebGL2 : `keep` 29 % + `traverse` 30 % = la fiche de page ; instrument Node dans `.mesure/out/lot-selection-boxclip/instrument/`.

## Suite, dans l'ordre, en un seul enchaînement de lots puis une passe de preuve
1. Défauts 1, 2, 3 (P1), après fusion de `lot/selection-boxclip` (mêmes fichiers) ; puis 4 à 7.
2. Mémoire : indices WebGL de tous les niveaux réservés (`clusterBatchPrimitive.ts` ~35), 48 o/sommet WebGPU (`webgpuGeometryPrepare.ts` ~18) : allocation selon la résidence. Résidence GPU : cônes renvoyés en entier à chaque changement (`gpuDagRuntime.ts` ~115) : plages modifiées seules. Sélection GPU : passes d'escalade lancées même tout résident (`gpuDagDispatch.ts` ~95).
3. Hi-Z temporelle (tag `essai/hiz-temporelle` = 986ea50, reprendre `gpuHizFactory.ts` et `webgpuVisibilityItems.ts` dans leur version d'après boîtes tenues). Fiches et adoption pour 4 ms. Tableaux typés sur la fiche de page pour la coupe < 2 ms.
4. Durées au calme ; témoin Three sur `transmission` ; phase 3 première image ; phase 2 sans Three dans l'hôte. Preuves gardées : tags `essai/*`, images `.mesure/out/<lot>/`.
