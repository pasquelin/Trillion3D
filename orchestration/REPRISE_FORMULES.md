# Prompt de reprise — session Formules (15 sept. 2026, soir)

Colle ce fichier tel quel dans la nouvelle session. Les agents de la session précédente sont morts avec elle ; leur travail est sur disque.

## Rôles et règles (rappel ferme)

Fable = chef : ne code pas, ne lit que des résumés, décide et brief. Opus 5 = code de production, jamais de tests. Sonnet 5 = lecture, tests, mesures. Aucun agent sans « go » explicite de l'utilisateur, sauf enchaînement déjà autorisé (simplify, fusion, lot suivant d'un plan validé). Réponses de 5 à 10 lignes. Règles du dépôt : AGENTS.md. Jamais de git stash, fusion locale seule, jamais de push : le Validateur (session webgeometry-8c ce soir) pousse `origin/develop` et nettoie les worktrees fusionnés. Verrou de mesure : `mkdir .claude/mesure.lock && echo "<qui> <quoi> <date>" > .claude/mesure.lock/proprietaire` en une seule commande, sans `-p` ; si mkdir échoue, on n'écrit rien et on attend (cinq essais de 60 s, jamais plus) ; libération = supprimer `proprietaire` puis `rmdir`. Mots interdits : les deux noms d'AGENTS.md (technologie de géométrie virtualisée d'Epic et son moteur), même pour citer la règle.

## Fait, tout dans develop et poussé (origin/develop = 8a5beca, puis docs 7930314)

- `orchestration/AUDIT_MATH_FORMULES.md` : catalogue de toutes les formules et fonctions de calcul du dépôt (dix Sonnet, 577 fichiers, ~2 000 lignes), 26 doublons transversaux en tête, et lot T1 = les ~150 appels aux calculs de Three.js dans `sdk-browser` avec formule équivalente et chemin (WebGPU par image / chargement / témoin / diagnostic).
- Lot `formules-communes-rust` (3979661) : 28 copies → 8 fonctions dans `packages/asset-compiler-rust/src/shared_math.rs`, bancs `to_bits` identiques, 12 tests.
- Lot `formules-communes-ts` (0b2fa1a) : 18 doublons TS/WGSL factorisés (`signedArea`, `barycentricAt`, `nanosecondsToMs`, fragments `MASK_KEEP_WGSL`, `BARY_WEIGHTS_WGSL`, `WRAP_COORD_WGSL`, `INVERSE_PI_WGSL`…), banc `packages/sdk-browser/bench/formules-ts.bench.mjs`, 35 tests, 0 px WebGPU sur trois vues fixes et caméra mobile, deux seuils. 21 doublons laissés séparés avec raison (relevés dans `orchestration/mesures/formules-communes-{rust,ts}-2026-09-15.md`).
- Spec `orchestration/SPEC_MOTEUR_SANS_THREE.md` R1a à R1f : plan validé avec l'utilisateur pour sortir les calculs de Three.js du moteur.

## Demande de l'utilisateur : migration hors Three.js (validée le 15 sept. au soir, en attente de « go »)

Principes retenus : socle mathématique maison dans `sdk-core` (pas un clone des classes Three), réutiliser les calculs maison existants (`extractPlanes`/`boxClip`, `hizCorners.ts`, `projectionOracles.ts`, `sceneLightShadowMath.ts`, fonctions communes), écrire les opérations manquantes, comparer à Three sur cas dégénérés pour inversion/décomposition/orientation ; sorties passées en paramètre, zéro allocation par image, opérations par lots ; transformations et caméra possédées par le moteur (parent/enfant, échelles négatives, conventions de profondeur WebGL/WebGPU) ; `LOD.update` suit le moteur témoin Three hors du SDK ; workers et WebAssembly seulement pour des traitements lourds par lots mesurés (jamais une matrice isolée), en s'appuyant sur `pageDecodePool.ts`, `pageDecodeTask.ts`, `geometryPageWasm.ts` ; à chaque lot : banc d'équivalence contre Three, 0 px au banc commun (trois vues + caméra mobile, deux seuils), `tri = selected`, test de structure interdisant `three`. Gain de vitesse : mesuré, jamais supposé.

Lots (détail et critères dans la spec R1f) : M1 socle vecteurs/matrices/quaternions/couleurs ; M2 volumes (boîte, sphère depuis boîte, frustum, sphère/cône) ; M3 hiérarchie de transformations et caméra, remplacement de tous les appels Three du chemin WebGPU par image ; M4 chargement, diagnostic, moteurs témoins Three déplacés dans un adaptateur hors du moteur ; M5 workers/Wasm après mesure. M1 et M2 en parallèle (deux Opus, worktrees, périmètres disjoints), M3 après les deux, M4 après M3, M5 après mesure. Liste de travail = lot T1 du catalogue.

## À faire ensuite, dans l'ordre

1. Sur « go » : lancer M1 et M2 (brief = spec R1a à R1f + brief commun des formules : nom générique parlant, remplacement partout, identique au bit près, aucun test écrit par Opus, Sonnet écrit les tests après, validate à la livraison).
2. Enchaîner M3, M4, M5 selon l'ordre ci-dessus, une entrée de journal avec chiffres par lot, message au Validateur à chaque fusion locale.
3. Restes du catalogue non traités : les paires CPU/GPU en miroir (à retirer avec M3 quand le CPU passe sur le socle), l'oracle Hi-Z reste témoin.
