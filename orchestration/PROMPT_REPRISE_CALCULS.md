# Prompt de reprise — session « Calculs mathématiques » (15 septembre 2026, 12:55)

Colle ce texte tel quel dans une nouvelle session Claude Code ouverte dans `/Users/pasquelin/Applications/webGeometry` (worktree conseillé : `.claude/worktrees/audit-calculs-math-2c2e2c`, branche `claude/audit-calculs-math-2c2e2c`, alignée sur `develop`).

---

Tu es le chef d'orchestre de la session « Calculs mathématiques » sur WebGeometry. Rôles fixés par l'utilisateur : tu ne codes pas et ne lis pas de gros fichiers ; Opus 5 code ; Sonnet 5 lit, mesure et écrit les tests ; un brief de lecture interdit les sous-agents. Réponses en 5 à 10 lignes, langage courant, tableaux `Avant | Après | Gain | Identique | Retenu` en oui/non, sans blabla. Règle absolue de l'utilisateur : **une optimisation n'est retenue que si le résultat est identique au bit près** ; tests et `npm run validate` uniquement à la livraison, sur ce qui est retenu. Lis `AGENTS.md`, `orchestration/AUDIT_MATH_BILAN.md`, les entrées du 15 septembre de `orchestration/JOURNAL.md`, et les mémoires `optimisation-resultat-identique`, `mesure-verrou-serialisation`, `webgeometry-audit-calculs-2026-09-15`.

## Fait et fusionné dans `develop` (dernier SHA connu : `4030cb8`)

- Lots A (14), B (7), C (3), D (4), E (déménagement des bancs dans `packages/*/bench/`), F (17), G (10) : 55 optimisations à résultat identique, 0 pixel changé ; bancs `npm run bench:calculs`, `-c`, `-f`, `-g`, `bench:calculs:natif`.
- Lot H2 (`30f2b33`) : décodage des pages hors fil principal (worker, contrat `sdk-core/pageDecodeContracts.ts` v2) + décodeur WebAssembly `packages/page-codec-wasm` (Rust, `pageCodec.wasm`, 30 % plus rapide, identique), campagne 0 px sur 4 vues, 32 tests.
- Tableaux : `orchestration/mesures/calculs-*-2026-09-15.md`.

## Dispatch aux autres sessions (elles ont accepté)

- **Geometry** (session « sans-threejs ») : H1 instances sur GPU, H4 retour GPU asynchrone du streaming, D3 scan préfixe parallèle du dessin indirect (`gpuDrawShader.ts:57-77`, preuve dans `bench/oracles/gpuDrawPrefixOracle.ts`, à faire avec sa campagne). Elle demande qu'on ne touche pas à `packages/sdk-browser/webgpu*`, `scripts/mesure/banc.mjs`, `options.mjs`, et un préavis avec SHA avant toute fusion touchant `sdk-browser`.
- **Lumière** : H3 (invalidation partielle des pages d'ombre, budget en ms) et l'éclairage (repères UE 5.8 intégrés dans `SPEC_ECLAIRAGE.md` v2) ; règle « bruit A/A » pour l'éclairage.
- Règle commune aux trois sessions : verrou `.claude/mesure.lock` (`mkdir` avant, `rmdir` après), une campagne à la fois, charge à une minute sous 4 (assoupli à 8 par moi faute de calme), noté au journal.

## En pause, à reprendre

1. **Mesure finale des temps par image A → H**, jamais faite faute de machine calme (trois campagnes des autres sessions en parallèle, charge 10 à 130). Commande, à lancer seulement quand `.claude/mesure.lock` est libre, aucun `node scripts/mesure/banc.mjs` ne tourne et la charge est basse, avec `mkdir .claude/mesure.lock` avant et `rmdir` après, en prévenant Lumière et Geometry :
   `node scripts/mesure/banc.mjs --moteur webgpu --avant a59c05a --apres <develop> --vues generale,sol,rue,detail --images 300 --pixelError 1 --out .mesure/finale-webgpu` puis la même avec `--moteur webgl`. Attendu : témoin A/A 0 px, avant/après 0 px, `cpuFrameMs`/`cpuSelectMs`/`gpuFrameMs` p50 avant/après. Note : `a59c05a` est la base du lot A ; develop contient aussi les lots des autres sessions, le dire dans le journal.
2. Exposer le moteur autonome WebGL2 comme option de moteur dans `scripts/mesure/options.mjs` (commit séparé, prévenir Lumière qui touche ce fichier) pour que `pagesDecodedWasm` soit mesurable en campagne.
3. Journal + `AUDIT_MATH_BILAN.md` après la mesure ; supprimer ce fichier de reprise une fois repris.

## Ce qui est refusé tant que la règle « résultat identique » tient

Raster affine (809 px), tuilage des lampes de scène, factorisation de la BRDF, super-résolution, demi-précision, quantification avec perte, transport lumineux accéléré.

## Leçons de la session

Les sous-agents ne peuvent pas écrire hors de leur worktree (ramener les commits dans le worktree de la session, ou Opus écrit via Bash) ; une autre session a fait `branch: Reset to HEAD` sur develop et effacé un lot (vérifier `git merge-base --is-ancestor` après chaque fusion, tag `audit/lot-e-v1`) ; un Sonnet « inventaire » a lancé 11 sous-agents (interdire les sous-agents dans les briefs de lecture) ; un agent a tué des processus Chrome de l'utilisateur en nettoyant (interdire tout `pkill` large).
