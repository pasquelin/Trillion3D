# Reprise — Geometry (session sans-threejs)

## Identité

- Vérifier `get_session("self")` : ce fichier est celui de la session titrée « Geometry ». Validateur = session titrée « Validateur », seule à pousser origin. Voisines : Lumière, Calculateur, Compilateur.
- Rôles : Fable orchestre sans coder ; Opus 5 code ; Sonnet 5 lit/mesure, ne commite jamais ; Haiku jamais. Réponses à l'utilisateur en 5 lignes, jamais de notification d'attente relayée.

## Règles par lot (ordre de l'utilisateur, 15 sept. 22 h)

- Coder TOUS les lots du plan d'affilée ; une seule passe à la fin : tests (un par comportement modifié), portes tsc / check:changed / check:unused / check:lines / check:duplicates, puis UNE campagne d'image (`scripts/mesure/banc.mjs`, vue generale seuil 0 + caméra mobile seuil 1, 60 images, A/A). Jamais de mesure entre deux lots ni après un rebase. Mesurer plus est une faute de temps.
- Aucune attente, aucune file, aucun verrou de mesure : chaque session mesure quand elle veut ; les pixels sont la preuve, les durées machine chargée sont marquées non mesurées.
- `npm run validate` = Validateur seul. Livraison : branche + SHA de tête au Validateur, qui fusionne ; jamais de fusion ni de push soi-même, jamais de `git stash`. Ne jamais tuer une campagne en cours (Chrome orphelin).
- `orchestration/` : une reprise par session + `SPEC_*.md` ouverts, 200 lignes max, jamais de journal ; preuves dans les messages de commit et de livraison.

## État courant (15 sept. 2026, 22 h 30)

- Livrés au Validateur, tous à 0 px : coupe WebGL2 (fusionné 7aacf6f + simplify b2a3266, prouvé 14/14) ; boîtes Hi-Z tenues (fusionné 8498cd3, CPU fixe WebGPU générale 6,1 → 4,7 ms, mobile inchangé) ; correctif banc f-cones (0fd6834) ; `lot/selection-boxclip` e95abbb (coupe 4,17 → 3,00 ms, −25,7 %) ; `lot/coplanaires` 0d274e3 (historique d'occlusion vivant en mouvement, R5c réécrite). Worktrees supprimés, branches jusqu'à fusion.
- CPU fixe image générale seuil 0 : 33,6 (14 sept.) → 4,7 ms. GPU 29 ms seuil 0 = goulot. Profil CPU restant : fiches 1,3 ms, adoption de la coupe 0,9, historique occulteurs 0,4.
- Coupe WebGL2 : `inside` couvre déjà 100 % des pages, boxClip 3 % ; reste `keep` 29 % et `traverse` 30 % = la fiche de page, chantier tableaux typés désormais justifié. Instrument Node de la coupe (rejoue le banc chiffre pour chiffre, sans navigateur) dans `.mesure/out/lot-selection-boxclip/instrument/`.
- Coplanaires : vainqueur fixe abandonné (pixels = intersections mur/plan, pas de plan commun) ; contrat R5c : vainqueur d'égalité exacte dépendant de l'historique, ≤ 0,007 %.

## Suite (par ordre)

1. Coplanaires levier 2, Hi-Z temporelle (−27 % GPU attendu) : code d'origine 986ea50, reprendre `gpuHizFactory.ts` et `webgpuVisibilityItems.ts` dans leur version d'après blend-encodage (octets tenus).
2. CPU fixe 4,7 → 4 ms : fiches et adoption. Projection GPU des boîtes Hi-Z rejetée (pas de double en WGSL, borne minorante non reproductible) sauf test plus conservateur assumé.
3. Coupe WebGL2 < 2 ms : tableaux typés sur la fiche de page (`essai/4c-tableaux-types` à relire, préalables livrés).
4. Durées au calme ; témoin Three sur `transmission` ; rembourrage 64 entrées/transparent ; phase 3 première image ; phase 2 sans Three dans l'hôte.
- Preuves à garder : branches `essai/*`, tag `essai/visibilite-levier2-mesure`, images `.mesure/out/<lot>/`.
