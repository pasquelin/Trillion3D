# Reprise — Geometry (session sans-threejs)

## Identité et rôles
- `get_session("self")` d'abord : fichier de la session titrée « Geometry ». Validateur = session « Validateur », seule à fusionner et pousser. Voisines : Lumière, Calculateur, Compilateur.
- Fable orchestre sans coder ; Opus 5 code ; Sonnet 5 lit et vérifie, ne commite jamais ; Haiku jamais. Réponses à l'utilisateur en 5 lignes, aucune notification d'attente relayée.

## Règles (ordres de l'utilisateur, 15 sept. 2026)
- Coder tous les lots d'affilée ; une seule passe à la fin : tests, portes (tsc, check:changed, check:unused, check:lines, check:duplicates), puis une campagne d'image (`scripts/mesure/banc.mjs`, generale seuil 0 + caméra mobile seuil 1, 60 images, A/A). Jamais de mesure entre deux lots ni après rebase ; aucune attente ni verrou ; pixels = preuve, durées machine chargée = non mesurées ; ne jamais tuer une campagne (Chrome orphelin).
- Corrections de défaut : l'ancien résultat n'est plus un oracle ; le contre-exemple devient le test de non-régression, un par défaut. Optimisations : comparaison à qualité identique, 0 px.
- `npm run validate` = Validateur seul. Livraison = branche + SHA au Validateur ; jamais de fusion, push ni `git stash`. `orchestration/` = une reprise par session + `SPEC_*` ouverts, 200 lignes max, jamais de journal ; preuves dans les messages de commit et de livraison.

## Défauts ouverts (audit du 15 sept. 23 h, `/tmp/webgeometry-audit-20260915.mjs`, 7/7 confirmés par rejeu indépendant sur c47231d ; 872 tests verts = état de la suite, pas correction)
1. P1 WebGL : boîte de visibilité figée à la préparation (`pageSelectionCollect.ts` ~95, `pageSelectionCut.ts` ~83) ; objet déplacé devant la caméra invisible. Actualiser avec la transformation.
2. P1 cône : tolérance absolue 1e-12 (`pageCone.ts` ~19 et WGSL) rejette une face visible à petite échelle. Vérification relative conservatrice.
3. P1 budget WebGL : compte les placements, pas les pages uniques (`pageSelectionCutVisit.ts` ~49, `pageSelectionCut.ts` ~97) ; instances dégradées à tort. Séparer résidence et dessins.
4. P2 `dropPage()` garde `rec.attributes` (`autonomousResidency.ts` ~61) ; mémoire CPU accumulée.
5. P2 décomposition PRS perd le cisaillement sous parent étiré (`webgpuPagesTransform.ts` ~51) ; garder la matrice locale.
6. P2 erreur écran divisée par la distance euclidienne (`projectionOracles.ts` ~105, `clusterErrorPixels`, versions CPU/GPU) ; sous-estimée hors axe.
7. P2 vue copiée avant `getWorldPosition()` (`gpuSelection.ts` ~121) ; caméra parentée incohérente une image.

## État (15 sept. 23 h 30)
- Fusionnés à 0 px : coupe WebGL2 (7aacf6f, b2a3266), boîtes Hi-Z tenues (8498cd3, CPU fixe WebGPU générale 5,9 → 4,7 ms), banc f-cones (0fd6834). Livrés non fusionnés : `lot/selection-boxclip` e95abbb (coupe 4,17 → 3,00 ms ; touche les fichiers des défauts 1-3 sans les corriger), `lot/coplanaires` 0d274e3 (historique d'occlusion ; R5c : vainqueur d'égalité exacte dépendant de l'historique, ≤ 0,007 %).
- GPU 29 ms seuil 0 = goulot. CPU fixe restant : fiches 1,3 ms, adoption 0,9, occulteurs 0,4. Coupe : `keep` + `traverse` = la fiche de page (59 %) ; instrument Node `.mesure/out/lot-selection-boxclip/instrument/`.

## Ordre retenu
1. Fusion de `lot/selection-boxclip` et `lot/coplanaires` (Validateur).
2. Défauts 1 à 3, puis 4 à 7, un test de justesse par défaut, en un seul enchaînement.
3. Mémoire et résidence : indices WebGL de tous les niveaux (`clusterBatchPrimitive.ts` ~35), 48 o/sommet WebGPU (`webgpuGeometryPrepare.ts` ~18), cônes renvoyés en entier (`gpuDagRuntime.ts` ~115), passes d'escalade lancées tout résident (`gpuDagDispatch.ts` ~95). Puis Hi-Z temporelle (tag `essai/hiz-temporelle`, sur la version d'après boîtes tenues), fiches et adoption pour 4 ms, tableaux typés pour la coupe < 2 ms.
4. Validation finale et preuve navigateur sur le contenu intégré. Ensuite : durées au calme, témoin Three sur `transmission`, phase 3 première image, phase 2 sans Three. Preuves gardées : tags `essai/*`, images `.mesure/out/<lot>/`.
