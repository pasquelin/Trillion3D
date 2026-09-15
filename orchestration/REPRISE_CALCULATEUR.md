# Reprise — session Calculateur

Session titrée « Calculateur » : vérifier par `get_session("self")` avant toute action.

## Règles

- Règles du dépôt : `AGENTS.md`. Plan : `orchestration/SPEC_MOTEUR_SANS_THREE.md` R1a à R1f (lots M1 à M5).
- Opus 5 écrit le code de production et le banc, jamais de tests ; Sonnet 5 lit, écrit les tests, mesure. Opus parallèles sur périmètres disjoints, worktree parti de `develop` (merge-base vérifiée au lancement).
- Seul le Validateur lance `npm run validate`, fusionne et pousse. On lui livre une branche avec sa preuve : tests ciblés, `npm run check:changed`, banc, campagne 0 px si le rendu est touché.
- Verrou de mesure `.claude/mesure.lock` : règle commune d'`AGENTS.md` (`proprietaire` écrit dans la chaîne de prise, relu avant `rmdir`) ; « verrou rendu » à qui attendait.
- Jamais `git stash`, jamais de push. Mots interdits : les deux noms cités dans `AGENTS.md`.

## Exigences de l'utilisateur pour chaque lot M

- Résultat identique à Three au bit près, hiérarchies parent/enfant comprises (chaînes `Object3D` de profondeur 1 à 6, échelles négatives, non uniformes sous rotation, nulles). Un écart est expliqué et borné, jamais masqué.
- Même script de banc : équivalence puis comparatif de performance Three contre nous (ns/op, rapport, octets alloués, médiane et p95, lots de 1 000 à 100 000, en-tête Node/CPU/charge/commit). Chiffres officiels sous le verrou, machine calme ; une ligne plus lente est affichée telle quelle.
- Three n'est importé que par les bancs et tests, comme référence ; jamais par les fichiers `math*.ts` du moteur.

## État courant

- **M2 volumes** : branche `calculs/m2-volumes` (worktree `agent-af28d88c19262c447`), code et banc livrés (65 275 cas, dont 18 287 parent/enfant, 0 écart). Tests Sonnet en cours. Restent : comparatif de performance et campagne 0 px sous le verrou, puis livraison au Validateur.
- **M1 socle** : branche `calculs/m1-socle` (worktree `agent-a8fe9b43c4c40b33a`), Opus en cours (vecteurs, matrices, quaternions, couleurs). À vérifier au rapport : `webgpuPagesWinding.ts` touché (périmètre M3).
- **Ensuite** : tests Sonnet de M1, preuves, livraison ; puis M3 (hiérarchie et caméra maison, chemin WebGPU par image, restes signalés par M2 : `explorerScene`, `explorerCamera`, `replicateInstances`, `getNormalMatrix`/`getWorldPosition` de `pageCone`), M4, M5.
- Liste de travail des appels Three restants : lot T1, lu dans git (`git show ebba8de:orchestration/AUDIT_MATH_FORMULES.md`) et recopié dans le brief de chaque lot, jamais dans le dépôt.
