# Programme d'optimisation mesurable — Web Geometry

Spécification de conception, à distinguer des [capacités actuellement implémentées](../../../packages/README.md). Les numéros historiques des sections sont conservés.

## 3. Identités algébriques sans validation de performance

Les transformations suivantes sont des hypothèses de recherche conservées pour leur explication mathématique. **Aucune n'est une optimisation adoptée.** Leur équivalence dans les réels ne prouve ni l'identité des décisions en flottants, ni un gain après compilation. Elles ne doivent pas remplacer les oracles sans comparaison recevable et sans respecter les conditions de la section 7.

### Projection centrale sans division

Pour `error>=0`, `depth>0`, `focal>=0`, `threshold>=0` :

```text
focal*error/depth <= threshold
équivaut à focal*error <= threshold*depth
```

L'équivalence algébrique ne rend pas le modèle central conservatif hors axe. Elle ne s'applique pas à une profondeur négative et nécessite une politique d'overflow/NaN en f32.

### Borne perspective sans racine carrée

Pour la borne jacobienne du document des calculs, sous les mêmes hypothèses et `Zmin>near` :

```text
error² * fmax² * (Zmin² + Rmax²) <= threshold² * Zmin⁴
```

Cette comparaison élimine la racine et les divisions de la formule développée. Elle peut cependant augmenter la plage dynamique et le nombre de multiplications. Tester une version normalisée pour éviter overflow/underflow; une formule mathématiquement équivalente peut être numériquement moins sûre.

### Frustum sans normaliser les plans

Le test AABB `dot(n,center)+offset+dot(abs(n),extent)<0` ne nécessite pas de plans unitaires. Si les plans sont extraits une seule fois par vue, économiser leur normalisation peut être négligeable. Comparer à une version avec plans prétraités, pas à six normalisations par cluster artificiellement coûteuses.

### Produits et normes

Comparer des distances carrées évite une racine lorsque les deux côtés sont non négatifs. Préserver les tolérances relatives et le comportement au zéro. Le matériel/compilateur peut déjà effectuer certaines transformations; inspecter le profil avant de multiplier les variantes source.

