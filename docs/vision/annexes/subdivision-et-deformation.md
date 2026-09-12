# Subdivision, déformation et bornes

> Conception Web Geometry : ce chapitre décrit des contrats et algorithmes proposés. Voir [l’état de l’implémentation](../../../packages/README.md).

La subdivision ci-dessous conserve les positions et IDs géométriques ; elle illustre les motifs conformes, pas un compilateur complet d'attributs. Chaque coin doit en plus transporter ses attributs dans son domaine continu, interpoler les valeurs à l'arête et conserver les copies de couture. Deux copies partagent l'ID géométrique du milieu mais peuvent garder des UV, normales ou tangentes différents. Une extension avec déplacement doit définir leur continuité avant activation. `atteint` signifie que toutes les longueurs respectent le seuil, même à la dernière passe autorisée ; `limite` indique que des arêtes restent trop longues.

```text
cle_arete(a, b):
  return (a, b) if a < b else (b, a)

entier(b):
  return 1 if b else 0

produit_scalaire(a, b):
  return a.x × b.x + a.y × b.y + a.z × b.z

produit_vectoriel(a, b):
  return (a.y × b.z - a.z × b.y, a.z × b.x - a.x × b.z, a.x × b.y - a.y × b.x)

aire2(a, b, c):
  return produit_scalaire(produit_vectoriel(b - a, c - a), produit_vectoriel(b - a, c - a))

normaliser(v):
  n = sqrt(produit_scalaire(v, v))
  require n > 0
  return v / n

sommet(id, p):
  return (id, p)

triangle(a, b, c):
  return (a, b, c)

CacheAretes:
  prochain_id
  par_arete

milieu(a, b):
  return (0.5 × (a.x + b.x), 0.5 × (a.y + b.y), 0.5 × (a.z + b.z))

longueur2(a, b):
  d = a - b
  return d.x × d.x + d.y × d.y + d.z × d.z

choisir_aretes(triangles, seuil):
  partagees = {}
  for t in triangles:
    for a, b in [(t.a, t.b), (t.b, t.c), (t.c, t.a)]:
      cle = cle_arete(a.id, b.id)
      partagees[cle] = partagees.get(cle, false) or longueur2(a.p, b.p) > seuil × seuil
  return partagees

point_arete(cache, a, b):
  cle = cle_arete(a.id, b.id)
  if cle not in cache.par_arete:
    cache.par_arete[cle] = sommet(cache.prochain_id, milieu(a.p, b.p))
    cache.prochain_id = cache.prochain_id + 1
  return cache.par_arete[cle]
```

```text
scinder_triangle(t, marques, cache):
  ab = marques[cle_arete(t.a.id, t.b.id)]
  bc = marques[cle_arete(t.b.id, t.c.id)]
  ca = marques[cle_arete(t.c.id, t.a.id)]
  n = entier(ab) + entier(bc) + entier(ca)
  require aire2(t.a.p, t.b.p, t.c.p) > 0
  if n == 0:
    return [t]
  if n == 3:
    m_ab = point_arete(cache, t.a, t.b)
    m_bc = point_arete(cache, t.b, t.c)
    m_ca = point_arete(cache, t.c, t.a)
    return [triangle(t.a, m_ab, m_ca), triangle(m_ab, t.b, m_bc), triangle(m_ca, m_bc, t.c), triangle(m_ab, m_bc, m_ca)]
  if n == 1 and ab:
    m = point_arete(cache, t.a, t.b)
    return [triangle(t.a, m, t.c), triangle(m, t.b, t.c)]
  if n == 1 and bc:
    m = point_arete(cache, t.b, t.c)
    return [triangle(t.b, m, t.a), triangle(m, t.c, t.a)]
  if n == 1:
    m = point_arete(cache, t.c, t.a)
    return [triangle(t.c, m, t.b), triangle(m, t.a, t.b)]
  if not ca:
    m_ab = point_arete(cache, t.a, t.b)
    m_bc = point_arete(cache, t.b, t.c)
    return [triangle(t.a, m_ab, t.c), triangle(m_ab, m_bc, t.c), triangle(m_ab, t.b, m_bc)]
  if not ab:
    m_bc = point_arete(cache, t.b, t.c)
    m_ca = point_arete(cache, t.c, t.a)
    return [triangle(t.b, m_bc, t.a), triangle(m_bc, m_ca, t.a), triangle(m_bc, t.c, m_ca)]
  m_ca = point_arete(cache, t.c, t.a)
  m_ab = point_arete(cache, t.a, t.b)
  return [triangle(t.c, m_ca, t.b), triangle(m_ca, m_ab, t.b), triangle(m_ca, t.a, m_ab)]

prochain_id(triangles):
  maximum = -1
  for t in triangles:
    maximum = max(maximum, t.a.id, t.b.id, t.c.id)
  return maximum + 1

subdiviser(triangles, seuil, profondeur_max, capacite):
  require seuil > 0 and profondeur_max >= 0
  require capacite >= len(triangles)
  courant = triangles
  for niveau in range(profondeur_max):
    marques = choisir_aretes(courant, seuil)
    if not any(marques.values()):
      return courant, atteint
    cache = CacheAretes(prochain_id(courant), {})
    suivant = []
    for t in courant:
      suivant.extend(scinder_triangle(t, marques, cache))
      if len(suivant) > capacite:
        return courant, budget
    courant = suivant
  if not any(choisir_aretes(courant, seuil).values()):
    return courant, atteint
  return courant, limite
```

```text
point_squelette(p, influences, matrices):
  require all(est_fini(i.poids) and i.poids >= 0 for i in influences)
  require abs(sum(i.poids for i in influences) - 1) <= tol
  q = (0, 0, 0, 0)
  for i in influences:
    q = q + i.poids × matrices[i.os] × p
  return q

deformer_sommets(sommets, matrices):
  sortie = {}
  for s in sommets:
    sortie[s.id] = point_squelette((s.p.x, s.p.y, s.p.z, 1), s.influences, matrices).xyz
  return sortie

normales_deformees(triangles, positions):
  sommes = {}
  for t in triangles:
    a, b, c = positions[t.a.id], positions[t.b.id], positions[t.c.id]
    n = produit_vectoriel(b - a, c - a)
    require produit_scalaire(n, n) > 0
    for coin in [t.a, t.b, t.c]:
      cle = (coin.id, coin.lissage)
      sommes[cle] = sommes.get(cle, (0, 0, 0)) + n
  for cle in sommes:
    sommes[cle] = normaliser(sommes[cle])
  return sommes

aabb_skinnee(sommets, matrices):
  positions = deformer_sommets(sommets, matrices)
  require len(positions) > 0
  mins = (infini, infini, infini)
  maxs = (-infini, -infini, -infini)
  for p in positions.values():
    mins = (min(mins.x, p.x), min(mins.y, p.y), min(mins.z, p.z))
    maxs = (max(maxs.x, p.x), max(maxs.y, p.y), max(maxs.z, p.z))
  return (mins, maxs)
```

```text
position_barycentrique(t, b):
  require b.x >= 0 and b.y >= 0 and b.z >= 0
  require abs(b.x + b.y + b.z - 1) <= tol
  return b.x × t.a.p + b.y × t.b.p + b.z × t.c.p

deformation_lineaire(t, b, deplace):
  return b.x × deplace(t.a.p) + b.y × deplace(t.b.p) + b.z × deplace(t.c.p)

erreur_deformation(t, echantillons, deplace):
  e = 0
  for b in echantillons:
    p = position_barycentrique(t, b)
    d = deplace(p) - deformation_lineaire(t, b, deplace)
    e = max(e, sqrt(d.x × d.x + d.y × d.y + d.z × d.z))
  return e

borne_deplacee(s, amplitude):
  require amplitude >= 0
  return (s.centre, s.rayon + amplitude)
```
