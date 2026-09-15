# Reprise — session Calculateur

Vérifier le titre « Calculateur » par `get_session("self")` avant toute action. Règles : `AGENTS.md`. Plan : `SPEC_MOTEUR_SANS_THREE.md` R1a à R1f.

## Règles de travail

- Opus 5 code et écrit le banc ; Sonnet 5 écrit les tests ; Haiku lance les campagnes. Worktree parti de `develop`, merge-base vérifiée.
- Le Validateur seul lance `validate`, fusionne et pousse. Livraison = branche + tests ciblés + `check:changed` + banc + campagne 0 px si le rendu est touché. Jamais `git stash` ni push ; mots interdits d'`AGENTS.md`.
- Campagne 0 px : `scripts/mesure/banc.mjs` WebGPU trois vues et `--camera-mobile`, WebGL générale, `--pixelError 0,1`, avant = base develop. Aucune attente ni fichier partagé avant de mesurer.
- Chaque lot M : identique à Three au bit près, hiérarchies parent/enfant comprises ; tout écart expliqué et borné.
- Un seul banc : équivalence, puis comparatif Three contre nous, lancé sans attendre une machine calme, deux exécutions. Tableau : Three ns/op, nous ns/op, Three/nous, gain %, ✅ identique et plus rapide, ❌ sinon. Three importé par bancs et tests seulement.

## Ce que les tests ne prouvent pas

Les tests et bancs des lots M prouvent l'**identité** avec l'ancien code et avec Three, pas la **justesse** du calcul : un défaut antérieur est reproduit fidèlement. Audit externe du 15 sept. 2026 sur `f6ac76f`, cinq défauts, aucun venu des lots M ni d'un bug de Three.js (vérification par reproduction en cours) :

1. `pageCone.ts:19` et `isConformal` de `gpuDagShader.ts` : tolérance absolue `1e-12`, rejet de faces visibles à petite échelle (`5ae3b83`).
2. `webgpuPagesTransform.ts:51` : `decompose` puis recomposition perd le cisaillement sous un parent étiré, limite documentée de Three (`634e919`).
3. `projectionOracles.ts:142` : division par la distance euclidienne, erreur écran sous-estimée hors axe (`c5db466`).
4. `wrapTexel` de `visibilityMath.ts:89` et `visibilityPageWgsl.ts` : répétition miroir traitée comme répétition simple (`5ae3b83`).
5. `gpuSelection.ts:121` : vue copiée avant que `getWorldPosition` mette à jour les parents, caméra parentée incohérente (`5ae3b83`).

Corriger change le résultat : décision de l'utilisateur défaut par défaut, puis tests de justesse contre la projection et la géométrie réelles. 2 et 5 se corrigent avec la hiérarchie maison de M3a.

## État

- **M2 volumes** : fusionné dans develop, 0 px sur develop fusionné, 1,2 à 4× plus rapide que Three.
- **M1 socle** : `calculs/m1-socle` 2355e89, livré au Validateur, 0 px, plus rapide sauf produit seul et composition (≈ 1,0).
- **M3a hiérarchie et caméra** : `calculs/m3a-hierarchie` 594b97b (worktree `agent-a96ed1f11e7e723e6`), 0 écart, 55 tests, 1,1 à 10× plus rapide. À rebaser après M1, puis campagnes et livraison.
- **Ensuite** : produit 4×4 sur tampons plats (32 % de la mise à jour de hiérarchie) ; M3b après le lot de coupe de Geometry : rendu par image (`pageSelectionCut`, `gpuSelection`, `webgpuPagesEncode*`, `hiz*`), chargement, explorateur, diagnostic ; puis M4, M5. Appels Three restants : `git show ebba8de:orchestration/AUDIT_MATH_FORMULES.md`, section lot T1.
