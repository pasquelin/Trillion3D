# Reprise — session Calculateur

Vérifier le titre « Calculateur » par `get_session("self")`. Règles : `AGENTS.md`. Plan : `SPEC_MOTEUR_SANS_THREE.md` R1a à R1f.

## Règles de travail

- Opus code et écrit reproductions et bancs ; Sonnet écrit les tests ; Haiku lance les campagnes. Worktree parti de `develop`. Jamais `git stash` ni push.
- Le Validateur seul lance `validate`, fusionne et pousse. Livraison : tête et merge-base sur develop récent, tests, `check:changed`, campagne `scripts/mesure/banc.mjs` (WebGPU trois vues et `--camera-mobile`, WebGL générale, `--pixelError 0,1`), sans attente préalable.
- Lots M (sans Three) : identiques à Three au bit près, parent/enfant compris ; banc équivalence puis comparatif (Three ns, nous ns, rapport, gain %, ✅/❌).
- Correctifs : reproduction avant, CPU et **GPU exécuté** (Chromium WebGPU, `LAB_ROOT`), test de justesse après, campagne, écarts d'image expliqués. Tout « 0 écart » nomme sa comparaison ; un contre-exemple fourni se rejoue avant de conclure.

## Lots M

- M2 volumes : dans develop. M1 socle : `calculs/m1-socle` 2355e89, livré, pas fusionné. M3a hiérarchie : `calculs/m3a-hierarchie` 594b97b (worktree `agent-a96ed1f…`), à rebaser après M1. Puis produit 4×4 sur tampons plats, M3b, M4, M5 (appels Three : `git show ebba8de:orchestration/AUDIT_MATH_FORMULES.md`, lot T1).
- Leurs tests prouvent l'identité, pas la justesse : les défauts antérieurs sont reproduits fidèlement.

## Correctifs de l'audit du 15 sept. (agents arrêtés par l'utilisateur ; WIP commités, non vérifiés)

1. Cône à petite échelle : **fusionné et poussé** (948aa29).
2. `setTransform` perd le cisaillement (`webgpuPagesTransform.ts`) : pas commencé, attend M1.
3. Erreur écran hors axe (`projectionOracles.ts:142`) : `fix/defaut3-erreur-ecran` bebdba6 (worktree `agent-a0b556ff…`), WIP. Borne pour **toutes** les directions, profondeur et plan proche compris ; coût en triangles et temps ; rebase.
4. Répétition miroir : `fix/defaut4-miroir` 1558d04 corrigé, tests en WIP d1470bb (worktree `agent-adb78848…`). Référence : la carte graphique (texel 2), pas `transformUv` (texel 3). Campagne 0 px, aucun miroir au banc. Restent tests, rebase, campagne.
5. Caméra parentée : `fix/defaut5-camera` 2ef1171 + WIP c7f2324 (worktree `agent-a9ca1348…`), 14 sites, CPU 13/14 → 0, GPU 8/12 → 0, campagne 0 px. Restent tests, rebase (`pageSelectionCut*`, `hiz*`), campagne.
6. Seuil `1e-20` d'`inverseTranspose3` WGSL : `repro/defaut6-inverse-transposee` 7211fd6 (worktree `agent-a701ed76…`), non exécutée. Prouver ou non la suppression de faces visibles contre l'orientation réelle ; si oui, corriger dans la vague.
7. et 8. Trouvés par le lot 4, en attente de l'utilisateur : couture de `Repeat` en filtrage linéaire (180 écarts) ; mode de répétition par carte ignoré côté GPU.
