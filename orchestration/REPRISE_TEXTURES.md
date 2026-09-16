# Textures — todo

Règles : je (Fable) ne code pas, un Opus code dans un worktree depuis `develop`. Pas de tests, pas de campagne, pas de `validate` : l'utilisateur teste seul dans son Lab (port 5174, dist du checkout principal). Chaque lot : image identique (0 px) sauf décision de l'utilisateur ; par propriété de texture, jamais par scène ; l'image n'attend jamais une arrivée ; ≤ 200 lignes par fichier ; mots d'Epic interdits. Livrer : fusion locale dans `develop`, `npm run build`, puis dire où regarder et quoi voir. « ? » = question, pas un go.

Critère de tout lot : même rendu que le moteur d'Epic, sous contrainte du chargement web, à cache froid, en traversant la ville.

## Écarts avec le moteur d'Epic (textures) = la todo

| Epic | Nous | Tâche |
|---|---|---|
| petits niveaux toujours en mémoire | oui (aperçus 16×16) | — |
| ordre = ce que l'écran regarde | oui depuis T1 | verdict utilisateur |
| budget mémoire fixe, niveaux inutiles libérés | plafond d'engagement, rien libéré | T1c |
| l'image n'attend jamais, à cache froid | non mesuré | T2 |
| priorité exacte par lecture de l'image | estimation par taille à l'écran | T3 |
| tuiles : seulement le visible | non | T4 |
| compression GPU (BC/ASTC) | RGBA brut, 7,56 Go sur Emerald | T5, sans perte seulement |

## À faire, dans l'ordre

1. [ ] Verdict de l'utilisateur sur T1 (fusionné f43f6a44) : route `/?test=15-virtualized-integration`, ce que la caméra regarde net d'abord.
2. [ ] T1b — compteurs textures dans le Lab (octets résidents / budget, textures au bon niveau, niveaux manquants) : une ligne dans le panneau du banc 15, rien d'autre.
3. [ ] T1c — vraie libération : niveaux nets devenus inutiles rendus au budget (atlas alloué d'avance aujourd'hui) ; sans ça le budget ne tient pas sur petite machine.
4. [ ] T2 — traversée à cache froid : temps par image plafonné pour les transferts, report à l'image suivante, aperçu dessiné tant que le niveau manque ; regarder p95 et pic, pas la médiane.
5. [ ] T3 — priorité exacte par lecture de l'image rendue, si T1 se trompe sur des cas vus par l'utilisateur.
6. [ ] T4 — tuiles, seulement si la mémoire reste le problème après T1c.
7. [ ] T5 — compression GPU sans perte de pixel visible : à étudier seulement avec un format qui rend la même image (les formats avec perte sont refusés : 19 500× le bruit).
8. [ ] Décisions à demander, une ligne chacune : `atlasClasses` 2 (−872 Mo, 15 142 px changent au loin) ; go T4 ; go T5.
