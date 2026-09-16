# Textures — todo

Règles : je (Fable) ne code pas, un Opus code dans un worktree depuis `develop`. Pas de tests, pas de campagne, pas de `validate` : l'utilisateur teste seul dans son Lab (port 5174, dist du checkout principal). Chaque lot : image identique (0 px) sauf décision de l'utilisateur ; par propriété de texture, jamais par scène ; l'image n'attend jamais une arrivée ; ≤ 200 lignes par fichier ; mots d'Epic interdits. Livrer : fusion locale dans `develop`, `npm run build`, puis dire où regarder et quoi voir. « ? » = question, pas un go.

Critère de tout lot : même rendu que le moteur d'Epic, sous contrainte du chargement web, à cache froid, en traversant la ville.

## À faire, dans l'ordre

1. [ ] Attendre le verdict de l'utilisateur sur T1 (mips chargés selon ce que l'écran regarde, fusionné f43f6a44) : route `/?test=15-virtualized-integration`, ce que la caméra regarde net d'abord.
2. [ ] T1b — afficher les compteurs textures dans le Lab (octets résidents / budget, textures au bon niveau, niveaux manquants) : une ligne dans le panneau du banc 15, rien d'autre au Lab.
3. [ ] T1c — vraie éviction : libérer les niveaux nets devenus inutiles (aujourd'hui seul l'engagement est plafonné, l'atlas reste alloué d'avance) ; sans ça le budget ne tient pas sur petite machine.
4. [ ] T2 — traversée à cache froid : temps par image plafonné pour les transferts de textures, report à l'image suivante, aperçu dessiné tant que le niveau manque ; mesurer p95 et pic en navigation, pas la médiane.
5. [ ] T3 — priorité exacte par retour d'image (lire l'image rendue pour connaître les mips voulus) si l'estimation de T1 se trompe sur des cas vus par l'utilisateur.
6. [ ] T4 — tuiles (ne charger que les morceaux visibles d'une texture) seulement si la mémoire reste le problème après T1c.
7. [ ] Décisions à demander à l'utilisateur, une ligne chacune : `atlasClasses` 2 (−872 Mo, 15 142 px changent au loin) ; go T4.
