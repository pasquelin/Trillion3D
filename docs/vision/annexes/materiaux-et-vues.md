# Matériaux, listes compactes et vues

> Conception Web Geometry : ce chapitre décrit des contrats et algorithmes proposés. Voir [l’état de l’implémentation](../../../packages/README.md).

Les champs d'une clé sont des descriptions comparables des états effectifs. Un lot rassemble du travail compatible ; il ne garantit pas à lui seul qu'un backend l'exécute en une commande. Le shader de couverture décide quels échantillons existent ; le shader de matériau peut ensuite être évalué séparément dans le chemin de visibilité différée. `etat_raster` est résolu pour l'élément, son instance et la vue : `cull_mode` distingue aucune face, faces avant et faces arrière ; `front_face` tient compte de l'orientation après transform et viewport. Une instance réfléchie ne partage pas aveuglément cet état avec une instance non réfléchie du même matériau. `etat_nuanceur` décrit les états effectifs de l'évaluation du matériau.

```text
cle_raster(element):
  m = element.etat_raster
  return (m.format_geometrie, m.programme_couverture, m.bindings_raster,
          m.cull_mode, m.front_face, m.masque, m.deformation, m.profondeur,
          m.formats_cibles, m.echantillons, m.blending)

cle_nuanceur(element):
  m = element.etat_nuanceur
  return (m.programme, m.bindings_materiau, m.textures, m.samplers,
          m.derivees, m.eclairage, m.formats_cibles)

indices(x):
  return range(len(x))

produit_scalaire(a, b):
  return a.x × b.x + a.y × b.y + a.z × b.z

id_cle(cles, cle):
  for i in indices(cles):
    if cles[i] == cle:
      return i
  cles.append(cle)
  return len(cles) - 1

classer(elements, champ):
  cles = []
  bins = []
  for e in elements:
    id = id_cle(cles, champ(e))
    bins.append(id)
  return cles, bins
```

```text
histogramme(bins, nombre):
  h = [0 for i in range(nombre)]
  for b in bins:
    require 0 <= b < nombre
    h[b] = h[b] + 1
  return h

scan_exclusif(h):
  offsets = []
  total = 0
  for x in h:
    offsets.append(total)
    total = total + x
  return offsets, total

disperser(elements, bins, offsets, comptes, total):
  sortie = [aucun for i in range(total)]
  curseurs = [x for x in offsets]
  for i in indices(elements):
    b = bins[i]
    require curseurs[b] < offsets[b] + comptes[b]
    sortie[curseurs[b]] = elements[i]
    curseurs[b] = curseurs[b] + 1
  return sortie
```

```text
lots(cles, comptes, offsets):
  sortie = []
  for b in indices(cles):
    if comptes[b] > 0:
      sortie.append((cles[b], offsets[b], comptes[b]))
  return sortie

preparer_raster(elements):
  cles, bins = classer(elements, cle_raster)
  comptes = histogramme(bins, len(cles))
  offsets, total = scan_exclusif(comptes)
  ordre = disperser(elements, bins, offsets, comptes, total)
  return ordre, lots(cles, comptes, offsets)

preparer_nuanceur(pixels):
  cles, bins = classer(pixels, cle_nuanceur)
  comptes = histogramme(bins, len(cles))
  offsets, total = scan_exclusif(comptes)
  ordre = disperser(pixels, bins, offsets, comptes, total)
  return ordre, lots(cles, comptes, offsets)
```

```text
Vue:
  id
  largeur
  hauteur
  projection
  near
  plans
  version

valider_vue(v):
  require v.largeur > 0 and v.hauteur > 0
  require finite(v.near)
  require v.projection in [perspective, orthographic]
  require v.near > 0 if v.projection == perspective else v.near >= 0
  require 5 <= len(v.plans) <= 6
  return v

visible(s, v):
  valider_vue(v)
  for p in v.plans:
    norme_plan = sqrt(produit_scalaire(p.normale, p.normale))
    require norme_plan > 0
    if produit_scalaire(p.normale, s.centre) + p.d < -s.rayon × norme_plan:
      return false
  return true

preparer_vues(vues, objets):
  listes = {}
  for v in vues:
    listes[v.id] = [o for o in objets if visible(o.borne, v)]
  return listes
```

```text
Ressource:
  id
  gen
  etat
  refs
  derniere_frame

creer(r):
  require r.etat == "absent"
  r.gen = r.gen + 1
  r.etat = "pret"
  r.refs = 0
  return r.gen

retenir(r, frame):
  require r.etat == "pret"
  r.refs = r.refs + 1
  r.derniere_frame = max(r.derniere_frame, frame)
  return (r.id, r.gen)

relacher(r):
  require r.refs > 0
  r.refs = r.refs - 1

retirer(r, frame_terminee):
  require r.etat == "pret"
  require r.refs == 0
  require r.derniere_frame <= frame_terminee
  r.etat = "absent"
  r.gen = r.gen + 1
```
