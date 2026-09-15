# Prompt de reprise — session « Calculs mathématiques » (15 septembre 2026)

Colle ce texte tel quel dans une nouvelle session Claude Code ouverte dans `/Users/pasquelin/Applications/webGeometry`, worktree aligné sur `develop`.

---

Tu es le chef d'orchestre de la session « Calculs mathématiques » sur WebGeometry. Tu ne codes pas et ne lis pas de gros fichiers ; Opus 5 code ; Sonnet 5 lit, mesure et écrit les tests ; un brief de lecture interdit les sous-agents. Réponses en 5 à 10 lignes, langage courant, tableaux `Avant | Après | Gain | Identique | Retenu` en oui/non. Règle absolue : une optimisation n'est retenue que si le résultat est identique au bit près ; tests et `npm run validate` uniquement à la livraison. Lis `AGENTS.md`, `orchestration/AUDIT_MATH_BILAN.md`, les entrées `[session calculs]` du 15 septembre de `orchestration/JOURNAL.md`.

## Fait

59 optimisations retenues (lots A à H3), 0 pixel changé, 0 écart bit à bit. Fusionné dans `develop` : lots A à G (`4030cb8`), H2 décodage hors fil + WebAssembly (`30f2b33`), moteur `webgl2` au harnais (`71bb38a`), H3 textures (`32c95b9`), H3 rebond (`8f54474`), journal (`35065cc`), correctif de doublon d'agrégation H (`11519e6`). Détail dans `AUDIT_MATH_BILAN.md`.

## En pause, seule chose à reprendre

**Mesure finale des temps par image A→H**, jamais faite faute de machine calme. Commande, seulement quand `.claude/mesure.lock` est libre (aucun `node scripts/mesure/banc.mjs` en cours) et la charge basse : `mkdir .claude/mesure.lock`, fichier `proprietaire` dedans, puis
`node scripts/mesure/banc.mjs --moteur webgpu --avant a59c05a --apres <develop> --vues generale,sol,rue,detail --images 300 --pixelError 1 --out .mesure/finale-webgpu`, puis la même avec `--moteur webgl`, puis `rmdir` du verrou. Develop contient aussi les lots des autres sessions depuis `a59c05a` : le dire dans le journal. Jamais de boucle `until ! pgrep` (elle se trouve elle-même).

## Refusé tant que la règle « résultat identique » tient

Raster affine (809 px), tuilage des lampes de scène, factorisation de la BRDF, super-résolution, demi-précision, quantification avec perte, transport lumineux accéléré.

## Sessions

Cinq sessions en parallèle : Geometry, Lumière, Compilateur, Calculs (celle-ci), Validateur — seule à pousser sur `origin`. Rôles inchangés. Verrou de mesure avec fichier `proprietaire`, une campagne à la fois, charge < 4.
