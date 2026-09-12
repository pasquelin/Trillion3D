# Pages et cache

> Conception Web Geometry : ce chapitre décrit des contrats et algorithmes proposés. Voir [l’état de l’implémentation](../../../packages/README.md).

Cet exemple représente un cache d'asset géré par un seul ordonnanceur. Le validateur contrôle les octets avant `recevoir`. Les messages sont préalablement filtrés par identité d'asset et de job ; `generation` protège ensuite la réservation locale. Les noms d'états abrégés correspondent au cycle décrit dans le chapitre mémoire.

Les tables épinglent toutes leurs entrées pour leur durée de vie. Le suivi conservatif des soumissions concerne donc toute la table. La récence LRU est mise à jour séparément par `toucher`, à partir des pages sélectionnées ou demandées ; un simple parcours de table n'est pas une preuve d'utilisation. Une annulation en attente est reprise après complétion de la soumission.

```text
Page:
    id, generation, etat, parents, priorite, slot
    racine, pins, lecteurs, derniereSoumission, annule
    parentsEpingles, octets

Table:
    version, entrees, active, fermee, derniereSoumission

Cache:
    proprietaires, acces, horloge, soumissionTerminee, table
```

```text
visiter(pages, id, couleurs, ordre):
    require id in pages
    if couleurs.get(id, 0) == 1:
        return cycle
    if couleurs.get(id, 0) == 2:
        return ok
    couleurs[id] = 1
    for parent in pages[id].parents:
        if visiter(pages, parent, couleurs, ordre) == cycle:
            return cycle
    couleurs[id] = 2
    ordre.append(id)
    return ok

demander(pages, id, priorite):
    require finite(priorite) and priorite >= 0
    ordre = []
    if visiter(pages, id, {}, ordre) == cycle:
        return invalid
    for cible in ordre:
        page = pages[cible]
        page.priorite = max(page.priorite, priorite)
        if page.etat == absent:
            page.etat = demande
    return ordre
```

```text
libererParents(pages, page):
    if page.parentsEpingles:
        for id in page.parents:
            require pages[id].pins > 0
            pages[id].pins -= 1
        page.parentsEpingles = false

slotLibre(cache, pages):
    candidats = []
    for slot, id in enumerate(cache.proprietaires):
        if id == aucun:
            return slot
        page = pages[id]
        if page.racine or page.pins > 0 or page.lecteurs > 0:
            continue
        if page.etat != pret or page.derniereSoumission > cache.soumissionTerminee:
            continue
        candidats.append(slot)
    if empty(candidats):
        return aucun
    return min(candidats, key=lambda slot: [cache.acces[slot], slot])

reserver(cache, pages, id):
    page = pages[id]
    require page.etat == demande
    slot = slotLibre(cache, pages)
    if slot == aucun:
        return attente
    ancien = cache.proprietaires[slot]
    if ancien != aucun:
        libererParents(pages, pages[ancien])
        pages[ancien].etat = absent
        pages[ancien].slot = aucun
        pages[ancien].generation += 1
    cache.proprietaires[slot] = id
    page.generation += 1
    page.slot = slot
    page.etat = lecture
    page.annule = false
    cache.horloge += 1
    cache.acces[slot] = cache.horloge
    return [id, page.generation]
```

```text
recevoir(page, generation, octets):
    if page.generation != generation or page.annule or page.etat != lecture:
        return obsolete
    page.octets = octets
    page.etat = recu
    return ok

lireMots(octets):
    require size(octets) % 4 == 0
    mots = []
    for offset in range(0, size(octets), 4):
        mots.append(sum(octets[offset + byte] * 2^(8 * byte) for byte in range(4)))
    return mots

preparer(pages, page):
    require page.etat == recu and not page.annule
    if any(pages[id].etat != pret for id in page.parents):
        return attente
    mots = lireMots(page.octets)
    for id in page.parents:
        pages[id].pins += 1
    page.parentsEpingles = true
    page.etat = prepare
    return mots

enregistrerUpload(page, soumission):
    require page.etat == prepare and not page.annule
    page.derniereSoumission = soumission
    page.etat = transfert

terminerUpload(cache, pages, page):
    require page.etat == transfert
    if cache.soumissionTerminee < page.derniereSoumission:
        return attente
    if page.annule:
        return annuler(cache, pages, page.id, page.generation)
    page.etat = pret
    return ok

annuler(cache, pages, id, generation):
    page = pages[id]
    if page.generation != generation:
        return obsolete
    if page.pins > 0 or page.lecteurs > 0 or page.racine:
        return utilise
    page.annule = true
    if page.derniereSoumission > cache.soumissionTerminee:
        return attente
    libererParents(pages, page)
    if page.slot != aucun:
        require cache.proprietaires[page.slot] == id
        cache.proprietaires[page.slot] = aucun
    page.slot = aucun
    page.etat = absent
    page.generation += 1
    return ok
```

```text
nouvelleTable(ancienne, ajouts, retraits, pages):
    require not ancienne.fermee
    entrees = copy(ancienne.entrees)
    for id in retraits:
        require not pages[id].racine
        entrees.remove(id)
    for id in ajouts:
        page = pages[id]
        require page.etat == pret and not page.annule
        entrees[id] = [page.slot, page.generation]
    for id, handle in entrees:
        require pages[id].etat == pret and not pages[id].annule
        require handle == [pages[id].slot, pages[id].generation]
    table = Table(ancienne.version + 1, entrees, false, false, 0)
    for id in entrees.keys():
        pages[id].pins += 1
    return table

activer(cache, table):
    require not table.fermee and not table.active
    cache.table.active = false
    table.active = true
    cache.table = table

utiliser(cache, table, pages, soumission):
    require table.active and not table.fermee
    table.derniereSoumission = max(table.derniereSoumission, soumission)
    for id in table.entrees.keys():
        page = pages[id]
        page.derniereSoumission = max(page.derniereSoumission, soumission)

toucher(cache, pages, idsUtilises):
    cache.horloge += 1
    for id in set(idsUtilises):
        page = pages[id]
        if page.slot != aucun and not page.annule:
            cache.acces[page.slot] = cache.horloge

fermerTable(cache, table, pages):
    require not table.active and not table.fermee
    if table.derniereSoumission > cache.soumissionTerminee:
        return attente
    for id in table.entrees.keys():
        require pages[id].pins > 0
        pages[id].pins -= 1
    table.fermee = true
    return ok
```
