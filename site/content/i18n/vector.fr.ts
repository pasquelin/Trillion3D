export const vectorFr = {
  srgbToLinear: {
    description:
      'Courbe sRGB exacte et son inverse, les valeurs négatives étant ramenées à zéro avant l’exposant.',
  },
  hslToLinearRgb: {
    description:
      'Convertit teinte, saturation et luminosité en trois composantes linéaires écrites dans `out[o..o+2]`. La teinte boucle, saturation et luminosité sont bornées à `[0, 1]`, et aucune courbe de transfert n’est appliquée.',
  },
  dotVector3: {
    description:
      '`a · b` sur trois composantes lues aux décalages `aAt` et `bAt` : un tampon et un décalage, jamais une vue temporaire.',
  },
  crossVector3: {
    description:
      '`out = a × b`. Les six composantes sont lues avant la première écriture ; `out` peut donc être `a` ou `b`.',
  },
  lengthSqVector3: {
    description:
      '`x² + y² + z²`, dans le même ordre que la référence. Sa racine carrée reproduit `length()` bit pour bit.',
  },
  normalizeVector3: {
    description:
      '`v / ‖v‖` sur place : chaque composante est multipliée par `1 / (length || 1)`, donc un vecteur nul reste inchangé.',
  },
  scaleVector3: {
    description:
      'Multiplie les trois composantes sur place ; écrit `out = a · s` à un décalage ; ou accumule `out += a · s`.',
  },
  transformAffinePoint: {
    description:
      '`M · (x, y, z, 1)` sans division perspective, pour une matrice affine. Les coordonnées arrivent en paramètres ; `out` peut donc être le vecteur d’entrée.',
  },
  transformHomogeneousPoint: {
    description:
      'Écrit les quatre composantes homogènes sans division : le point en espace de clip lorsque `M` est une vue-projection. L’appelant divise par la quatrième après avoir écarté zéro et les valeurs non finies.',
  },
  transformDirectionVector3: {
    description:
      'Applique le bloc 3×3 d’une matrice affine à une direction puis la normalise, sans translation. La seconde fonction calcule `M · (x, y, z)` pour une matrice 3×3 en ordre colonne.',
  },
};
