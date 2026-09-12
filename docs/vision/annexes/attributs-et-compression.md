# Attributs, repères et compression entière

> Conception Web Geometry : ce chapitre décrit des contrats et algorithmes proposés. Voir [l’état de l’implémentation](../../../packages/README.md).

```text
signe(x):
  return -1 if x < 0 else 1

indices(x):
  return range(len(x))

borner(x, bas, haut):
  return min(max(x, bas), haut)

arrondir(x):
  return floor(x + 0.5)

normaliser(v):
  n = sqrt(v.x × v.x + v.y × v.y + v.z × v.z)
  require n > 0
  return (v.x / n, v.y / n, v.z / n)

oct_encoder(n, m):
  require entier(m) and m > 0
  n = normaliser(n)
  s = abs(n.x) + abs(n.y) + abs(n.z)
  p = (n.x / s, n.y / s)
  if n.z < 0:
    p = ((1 - abs(p.y)) × signe(p.x), (1 - abs(p.x)) × signe(p.y))
  qx = arrondir(borner(p.x, -1, 1) × m)
  qy = arrondir(borner(p.y, -1, 1) × m)
  return qx, qy

oct_decoder(qx, qy, m):
  require entier(m) and m > 0
  x = qx / m
  y = qy / m
  z = 1 - abs(x) - abs(y)
  if z < 0:
    x, y = (1 - abs(y)) × signe(x), (1 - abs(x)) × signe(y)
  return normaliser((x, y, z))
```

```text
produit_scalaire(a, b):
  return a.x × b.x + a.y × b.y + a.z × b.z

produit_vectoriel(a, b):
  return (a.y × b.z - a.z × b.y, a.z × b.x - a.x × b.z, a.x × b.y - a.y × b.x)

axe_secours(n):
  if abs(n.x) <= abs(n.y) and abs(n.x) <= abs(n.z):
    return (1, 0, 0)
  if abs(n.y) <= abs(n.z):
    return (0, 1, 0)
  return (0, 0, 1)

repere(n, t, orientation):
  require orientation in {-1, 1}
  n = normaliser(n)
  t = t - n × produit_scalaire(n, t)
  if produit_scalaire(t, t) == 0:
    t = produit_vectoriel(axe_secours(n), n)
  t = normaliser(t)
  b = orientation × produit_vectoriel(n, t)
  return n, t, b
```

```text
zigzag(n):
  return 2 × n if n >= 0 else -2 × n - 1

dezigzag(u):
  return floor(u / 2) if u % 2 == 0 else -floor(u / 2) - 1

puissance2(k):
  require k >= 0
  r = 1
  for i in range(k):
    r = 2 × r
  return r

empaqueter_entiers(champs, bits):
  require len(champs) == len(bits)
  mot = 0
  decalage = 0
  for i in indices(champs):
    require entier(bits[i]) and 0 <= bits[i] <= 32
    require decalage + bits[i] <= 32
    limite = puissance2(bits[i])
    require entier(champs[i]) and 0 <= champs[i] < limite
    mot = mot + champs[i] × puissance2(decalage)
    decalage = decalage + bits[i]
  require decalage <= 32
  return mot

depaqueter_entiers(mot, bits):
  require entier(mot) and 0 <= mot < puissance2(32)
  champs = []
  decalage = 0
  for largeur in bits:
    require entier(largeur) and 0 <= largeur <= 32
    require decalage + largeur <= 32
    champs.append(floor(mot / puissance2(decalage)) % puissance2(largeur))
    decalage = decalage + largeur
  return champs

mot32(x):
  require 0 <= x < puissance2(32)
  return x
```

```text
ordre_reste(reste):
  ordre = [i for i in indices(reste)]
  for i in range(len(ordre)):
    meilleur = i
    for j in range(i + 1, len(ordre)):
      a = ordre[j]
      b = ordre[meilleur]
      if reste[a] > reste[b] or (reste[a] == reste[b] and a < b):
        meilleur = j
    ordre[i], ordre[meilleur] = ordre[meilleur], ordre[i]
  return ordre

quantifier_poids(poids, max_entier):
  require entier(max_entier) and max_entier > 0
  require all(est_fini(x) and x >= 0 for x in poids)
  total = sum(poids)
  require est_fini(total) and total > 0
  p = [x / total for x in poids]
  brut = [x × max_entier for x in p]
  q = [floor(x) for x in brut]
  ordre = ordre_reste([brut[i] - q[i] for i in indices(q)])
  reste = max_entier - sum(q)
  require 0 <= reste <= len(q)
  for i in range(reste):
    q[ordre[i]] = q[ordre[i]] + 1
  assert sum(q) == max_entier
  return q
```

```text
entier(x):
  return floor(x) == x

cle_sommet(position, normale, tangente, signe, influences, uvs, couleur):
  return (position, normale, tangente, signe, influences, uvs, couleur)

indexer_sommets(corners):
  table = {}
  sommets = []
  indices = []
  for c in corners:
    cle = cle_sommet(c.position, c.normale, c.tangente, c.signe, c.influences, c.uvs, c.couleur)
    if cle not in table:
      table[cle] = len(sommets)
      sommets.append(c)
    indices.append(table[cle])
  return sommets, indices

couture(uv_a, uv_b):
  return uv_a != uv_b

verifier_couture(p, n, t, signe, influences, uv_a, uv_b, c):
  if couture(uv_a, uv_b):
    require cle_sommet(p, n, t, signe, influences, uv_a, c) != cle_sommet(p, n, t, signe, influences, uv_b, c)
```
