# Pages, mémoire et cache

> Conception Web Geometry : ce chapitre décrit des contrats et algorithmes proposés. Voir [l’état de l’implémentation](../../../packages/README.md).

## 1. Trois organisations distinctes

Le format disque privilégie transfert et compression. Le format de travail CPU privilégie construction et validation. Le format GPU privilégie accès aléatoire borné. Une même structure mémoire n'est pas imposée aux trois.

Une page est un bloc adressable. Une région LOD est une unité de remplacement géométrique. Un cluster est une unité de dessin/culling. Un bin est une unité de compatibilité de pipeline. Aucun de ces identifiants n'est interchangeable.

## 2. Format minimal proposé

La V1 utilise little-endian, sections versionnées et flux explicites sans codec obligatoire. Les choix suivants sont un format de départ à implémenter et tester, pas une description d'un format extérieur.

En-tête de 64 octets :

| Offset | Champ | Type |
|---:|---|---|
| 0 | signature `VGE1` | 4 octets ASCII |
| 4 | version majeure | u16 |
| 6 | version mineure | u16 |
| 8 | taille en-tête = 64 | u32 |
| 12 | nombre de sections | u32 |
| 16 | taille totale | u64 |
| 24 | offset table des sections | u64 |
| 32 | flags reconnus | u32 |
| 36 | réservé zéro | u32 |
| 40 | offset manifeste | u64 |
| 48 | taille manifeste | u64 |
| 56 | réservé zéro | u64 |

Descripteur de section de 40 octets : type u32 à 0, version u16 à 4, flags u16 à 6, offset u64 à 8, taille u64 à 16, nombre u32 à 24, stride u32 à 28, CRC32 u32 à 32, réservé u32 à 36. Le bit 0 des flags indique une section obligatoire. Les autres bits inconnus rendent la version incompatible sauf politique explicitement définie.

Types de section V1 : 1 sommets, 2 indices, 3 clusters, 4 régions, 5 relations, 6 pages, 7 matériaux, 8 identités. Le manifeste encode configuration, unités, type d'erreur, version de compilateur et hash des entrées en UTF-8. Sa canonicalisation est versionnée pour obtenir la même clé de cache.

Cette enveloppe ne constitue pas encore un format d'échange complet entre deux implémentations indépendantes. Avant d'écrire le writer et le reader, figer les records de chaque section, listes et sentinelles, alignements disque, représentations des bornes/erreurs, flux d'attributs et paramètres de quantification, ainsi que la grammaire et la canonicalisation du manifeste. Les relations et invariants sont définis dans les chapitres ; leur disposition binaire reste une décision de spécification, sans dépendance à un format extérieur. Toute signature de format effectivement publiée doit identifier aussi ces choix.

Vérifier toutes les plages par `offset<=total` puis `size<=total-offset`. Refuser les recouvrements non déclarés, les strides impossibles, offsets non alignés, réservés non nuls et sections obligatoires inconnues. Pour tableaux fixes, exiger `count*stride==size` avec multiplication contrôlée. Pour flux variables, vérifier un index de plages séparé.

CRC32 sert à détecter une corruption accidentelle, pas à authentifier un asset. Référence : polynôme réfléchi `0xEDB88320`, initialisation `0xFFFFFFFF`, XOR final `0xFFFFFFFF`. Les opérations portent sur mots u32.

```text
crc(bytes):
    value = 0xFFFFFFFF
    for byte in bytes:
        value = value xor byte
        for bit in range(8):
            low = value and 1
            value = value >> 1
            if low == 1:
                value = value xor 0xEDB88320
    return value xor 0xFFFFFFFF
```

Les offsets u64 exigent BigInt ou deux mots côté JavaScript ; refuser ce qui dépasse les limites réelles de la plateforme avant conversion en Number. Les tailles admissibles sont bornées par les budgets du chargeur, pas seulement par le format.

## 3. Allocation et adressage

Référence : pool de slots fixes de taille configurable. `address=poolBase+slot*slotSize+localOffset`. Vérifier `localOffset<=slotSize` et `length<=slotSize-localOffset`, puis les bornes du pool. Ne pas confondre nombre de slots et nombre de pages actives.

Les alignements dépendent de l'usage effectif. Fonction générale : `align(size,alignment)=ceil(size/alignment)*alignment`, avec entiers positifs et multiplication contrôlée. L'alignement d'une structure WGSL, d'une copie et d'un offset dynamique sont trois contraintes distinctes.

Budget total : géométrie résidente + tables + candidats + arguments + cibles de rendu + Hi-Z + staging + readback + marge. Le pic CPU comprend entrée, sortie, graphe, simplification, tas WASM éventuel, copies et compression. Une page de 64 Kio n'implique pas un coût total de 64 Kio.

Un pool à slots fixes limite la fragmentation externe, mais laisse une fragmentation interne `slots*slotSize-usedBytes`. Mesurer les deux avant d'ajouter taille variable ou défragmentation.

## 4. Dépendances

Séparer : dépendances de décodage, pages nécessaires à une représentation, et relations LOD. Une page fine n'a pas nécessairement besoin des octets de son parent si l'encodage est indépendant.

La V1 peut encoder chaque page indépendamment : plus simple à charger, annuler et tester. Une variante avec réutilisation interpage doit construire un graphe de décodage acyclique. Faire un tri topologique ; s'il reste des nœuds sans progrès, rejeter le cycle. Les racines doivent se charger avec leur fermeture de dépendances complète et épinglée.

Demande d'une page : calculer d'abord la fermeture sans modifier l'état public, valider les identifiants et l'absence de cycles, puis fusionner les demandes. Priorité proposée : erreur écran dépassée, visibilité probable et âge ; l'âge évite la famine. Les dépendances requises héritent au moins de la priorité du demandeur. La formule et ses unités sont des paramètres d'expérience, pas un oracle de visibilité.

## 5. États et génération

Une page suit `absent → requested → reserved → loading → decoded → uploading → ready → retiring → absent`. Échec et annulation portent une raison. Un drapeau racine ne remplace jamais l'état `ready`.

Dans l'exemple de cache, l'ordonnanceur CPU est l'unique écrivain des états. Les callbacks de lecture/transfert lui envoient des résultats ; ils ne modifient pas directement les slots. Initialiser générations à 1, compteurs et dernière soumission à 0, flags à faux, slot à `aucun`, état à `absent`. La table initiale est vide, active, non fermée, version 0. Charger puis épingler les racines avant de rendre une instance virtualisée.

Identité d'un résultat : `(assetId,assetGeneration,pageId,slotGeneration,jobId)`. Toute réponse dont un champ ne correspond plus est ignorée. Réutiliser le même numéro de slot ne permet pas de réutiliser une ancienne réponse asynchrone.

La réservation s'effectue après admission mémoire. Une tâche annulée n'écrit plus dans un slot réattribué ; tant qu'un transfert ne peut être arrêté, le slot reste réservé jusqu'à sa complétion. L'annulation d'un calcul monolithique ne signifie pas qu'il a effectivement cessé.

## 6. Publication cohérente

Préparer la prochaine table de pages et de régions hors des tables consommées. Ordre : données transférées, décodage des dépendances, décodage de la page, raccordements, puis passes de sélection utilisant la nouvelle version.

Il n'est pas nécessaire de bloquer le CPU entre toutes les étapes : une soumission ordonnée peut assurer la dépendance GPU. En revanche, l'éviction et le recyclage exigent de connaître les dernières soumissions susceptibles de lire l'ancienne version.

L'annexe emploie une référence volontairement simple : une page n'est déclarée prête qu'après complétion de son upload. La boucle de rendu continue avec la table précédente pendant cette attente. Les tables sont des snapshots immuables ; préparer et transférer leurs enregistrements GPU avant de les activer. Chaque soumission note sa dernière utilisation, puis la fermeture d'une table inactive relâche ses pins une seule fois. L'activation ordonnée sans attendre la fin d'upload est une optimisation distincte à recetter.

Une région ne devient fine que lorsque l'ensemble de ses pages est utilisable. En sens inverse, rendre sa représentation de secours accessible avant de retirer les pages fines. La cohérence porte sur une version complète observée entre passes, pas sur une prétendue instruction atomique remplaçant tout l'asset.

Si plusieurs opérations modifient la même adresse, appliquer leur composition dans l'ordre. L'écriture finale n'écrase les précédentes que si elle couvre tous les bits modifiés ; une écriture partielle n'annule pas arbitrairement une autre écriture partielle.

## 7. Éviction sûre

Une page évictable n'est ni racine, ni requise par une dépendance active, ni épinglée par une vue/table, ni lue par CPU, ni utilisée par une soumission GPU en vol. Sa dernière soumission doit être terminée avant réutilisation physique.

Politique de référence : retirer logiquement les candidats froids, publier une table sans eux, attendre la fin des derniers lecteurs puis libérer les slots. LRU utilise une horloge globale d'accès ; un compteur incrémenté séparément par slot mesure une fréquence, pas la récence.

Si aucun slot n'est libérable : reporter les demandes, réduire le budget de détail ou conserver le fallback. Ne pas arracher une page encore nécessaire pour respecter artificiellement un budget de chargement.

## 8. Feedback et readback

Le GPU produit compteur, demandes et overflow. Le CPU lit une copie ancienne terminée dans un anneau de buffers, sans attendre l'image en cours. Chaque entrée suit `free → copying → ready → reading → free`. Ne jamais écraser une copie en vol.

Si capacité utile `capacity`, lire `min(rawCount,capacity)` demandes et conserver `rawCount>capacity` comme saturation. Dédupliquer et fusionner les priorités côté CPU. Une demande perdue doit pouvoir être réémise ; une coupure de feedback ne doit pas retirer la représentation déjà visible.

La copie doit précéder le reset du buffer producteur. Un buffer mappé côté CPU ne sert pas simultanément d'entrée GPU. Les stats et captures synchrones sont autorisées dans les tests de correction, hors fenêtre de performance.

## 9. Cache persistant et reprise

Clé = hash des données pertinentes + configuration normalisée + importeur + compilateur + version de format + cible d'encodage. Inclure textures de déplacement et règles d'adressage si elles modifient la géométrie. Un changement de couleur uniforme ne doit pas invalider un cache de positions indépendant.

Écrire dans une entrée temporaire, relire/valider, puis publier par remplacement atomique sur le même volume. Un crash avant publication laisse au plus une entrée incomplète non reconnue. Au démarrage, reconstruire uniquement les entrées invalides ; ne pas purger tous les assets sains.

Les entrées chargées sont des données non fiables : limiter tailles décompressées, profondeur des graphes, nombre de dépendances et durée de travail. Vérifier les chemins des ressources contre le domaine autorisé ; ne jamais lancer une commande fournie par un asset.

## 10. Tests indispensables

Page vide/tronquée, CRC incorrect, section inconnue, offset débordant, cycle, dépendance manquante, racine non prête, budget insuffisant, annulation avant/après transfert, réponse de génération ancienne, slot réutilisé, changement de vue pendant éviction, perte de device, saturation de feedback et crash pendant commit.

Exemple de recette : budget deux slots, racine dans le premier, page fine dans le second, une frame en vol lit la page fine. Une troisième page attend ; elle ne remplace pas le second slot avant la fin de cette frame et la publication du fallback.
