# Reprise — Geometry (session sans-threejs)

## Identité
- Vérifier `get_session("self")` : ce fichier est celui de la session titrée « Geometry ». Validateur = session titrée « Validateur », seule à pousser origin. Voisines : Lumière, Compilateur.
- Rôles : Fable orchestre sans coder ; Opus 5 code ; Sonnet 5 lit/mesure, ne commite jamais ; Haiku jamais. Toujours un Opus sur le lot suivant.

## Règles par lot
- Code d'abord, tests écrits à la fin (un par comportement modifié). Portes : tsc, check:changed, check:unused, check:lines, check:duplicates.
- Preuve 0 px au harnais (`scripts/mesure/banc.mjs`) : vues generale/sol/rue, caméra mobile aux deux seuils obligatoire pour toute liste ou résultat tenu, scène classes-materiaux, témoin A/A.
- `npm run validate` = Validateur seul, jamais nous.
- Livraison : fusion locale ff-only dans develop, SHA envoyé au Validateur, jamais de push, jamais de `git stash`.
- Orchestration (`orchestration/`) : une reprise par session + plans ouverts (`SPEC_*.md`), 200 lignes max par fichier, jamais de journal. Les preuves d'un lot sont ses messages de commit et de livraison (SHA, chiffres, pixels), pas un fichier séparé.

## Verrou de mesure
- Prise : `mkdir` sans `-p` ; `proprietaire` écrit seulement dans la même chaîne `&&` après la mkdir réussie.
- Libération : seulement chaînée en `&&` après relecture de `proprietaire`, jamais après un `;`. Ne jamais retirer le verrou d'autrui.
- Attente : `until mkdir …` en arrière-plan, jamais `pgrep -f`.

## État courant
- develop = 73b9e4b. CPU fixe image générale seuil 0 : 5,9 ms (14 sept. : 33,6). GPU 29 ms seuil 0 = goulot.
- Profil du CPU fixe : boîtes Hi-Z + fiches ~3,0 ms, historique occulteurs 0,4, uniformes mélange 0,4, encodage passe de mélange 0,2 (la prémisse « 2,7-3,1 ms » était fausse).

## Lots en cours (Opus, worktrees `.claude/worktrees/lot-*`, branches `lot/*`, à ne pas supprimer)
- `lot/selection-webgl2` : coupe WebGL2 4,5 → < 2 ms, cône et résidence hors chemin chaud ; tableaux typés refusés (preuve `essai/4c-tableaux-types`).
- `lot/blend-encodage` : boîtes Hi-Z résidentes projetées GPU ou octets tenus (gpuHizTest/gpuHizFactory/webgpuVisibilityItems), rebase sur le reflet de Lumière avant preuve.
- `lot/coplanaires` : vainqueur fixé à la compilation, DEPTH_LAYER_BIAS_UNITS = 16, référence déplacée 0,007 % acceptée sous délégation ; fusion en dernier.

## Suite
- Durées à rejouer au calme (charge < 4) ; témoin Three sur `transmission` ; rembourrage 64 entrées/transparent ; phase 3 première image ; phase 2 sans Three dans l'hôte.
- Preuves à garder : branches `essai/*`, tag `essai/visibilite-levier2-mesure`, images `.mesure/out/<lot>/`.
