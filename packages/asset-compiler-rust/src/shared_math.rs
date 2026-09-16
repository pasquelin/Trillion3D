//! Formules partagées par plusieurs étages du compilateur natif.
//!
//! Chaque fonction est le seul exemplaire d'un calcul qui vivait auparavant en plusieurs copies :
//! mêmes opérations flottantes, dans le même ordre, à la même précision qu'à l'endroit d'origine.
//! Un site dont la formule diffère d'un détail reste chez lui plutôt que d'être aligné sur un autre.

/// Étend une boîte englobante d'une autre boîte, axe par axe et dans l'ordre des axes.
///
/// `f64::min` et `f64::max` gardent leur sémantique : un NaN dans la boîte lue laisse la borne
/// telle quelle, un NaN dans la borne est remplacé par la coordonnée. Le coin bas n'est comparé
/// qu'au coin bas et le coin haut qu'au coin haut : aucune comparaison de plus, qui trancherait
/// autrement entre `+0.0` et `−0.0`.
pub(crate) fn merge_aabb<const N: usize>(
    low: &mut [f64; N],
    high: &mut [f64; N],
    other_low: [f64; N],
    other_high: [f64; N],
) {
    for axis in 0..N {
        low[axis] = low[axis].min(other_low[axis]);
        high[axis] = high[axis].max(other_high[axis]);
    }
}

/// Étend une boîte englobante d'un point : la boîte réduite à ce point.
pub(crate) fn extend_aabb<const N: usize>(
    low: &mut [f64; N],
    high: &mut [f64; N],
    point: [f64; N],
) {
    merge_aabb(low, high, point, point);
}

/// L'axe sur lequel une boîte est la plus large. À égalité, le premier axe l'emporte : la
/// comparaison est un `>` strict, donc un NaN d'étendue ne déplace jamais le choix.
pub(crate) fn longest_axis(low: &[f64; 3], high: &[f64; 3]) -> usize {
    let mut axis = 0;
    for a in 1..3 {
        if high[a] - low[a] > high[axis] - low[axis] {
            axis = a;
        }
    }
    axis
}

/// Trie un groupe d'identifiants sur l'axe le plus large de leurs barycentres : la médiane tombe
/// ensuite sur `slice.len() / 2`, qui coupe le groupe en deux moitiés spatiales.
///
/// Le comparateur ordonne par coordonnée (`total_cmp`, donc un NaN a une place), puis par
/// identifiant : deux barycentres confondus gardent le même ordre d'une compilation à l'autre.
pub(crate) fn bisect_centres(slice: &mut [usize], centres: &[[f64; 3]]) {
    let mut low = [f64::INFINITY; 3];
    let mut high = [f64::NEG_INFINITY; 3];
    for &id in slice.iter() {
        extend_aabb(&mut low, &mut high, centres[id]);
    }
    let axis = longest_axis(&low, &high);
    slice.sort_unstable_by(|&x, &y| {
        centres[x][axis]
            .total_cmp(&centres[y][axis])
            .then(x.cmp(&y))
    });
}

/// La même boîte en simple précision : un site qui accumule des `f32` ne passe pas par `f64`.
pub(crate) fn extend_aabb_f32<const N: usize>(
    low: &mut [f32; N],
    high: &mut [f32; N],
    point: [f32; N],
) {
    for axis in 0..N {
        low[axis] = low[axis].min(point[axis]);
        high[axis] = high[axis].max(point[axis]);
    }
}

/// Octets de bourrage pour porter une longueur au multiple de quatre suivant : zéro quand elle y
/// est déjà. C'est l'alignement que le format binaire du compilateur demande de ses vues.
pub(crate) fn pad_to_4(length: usize) -> usize {
    (4 - length % 4) % 4
}

/// Vecteur unitaire, ou le repli quand la longueur reste sous la garde de 1e-12 : plus court, le
/// vecteur ne porte plus de direction et la division n'aurait pas de sens. Le repli appartient au
/// site — une lampe regarde vers `-Z`, une normale absente pointe vers le haut — donc il est passé.
pub(crate) fn normalized_or(vector: [f64; 3], fallback: [f64; 3]) -> [f64; 3] {
    let length = (vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]).sqrt();
    if length > 1e-12 {
        [vector[0] / length, vector[1] / length, vector[2] / length]
    } else {
        fallback
    }
}

/// Millisecondes écoulées depuis un instant : le compilateur ne publie ses durées qu'en
/// millisecondes, et les convertir au même endroit évite qu'un relevé reparte en secondes.
pub fn elapsed_ms(since: std::time::Instant) -> f64 {
    since.elapsed().as_secs_f64() * 1000.0
}

/// L'échelle uniforme équivalente d'une matrice 4 × 4 écrite par colonnes : la racine cubique du
/// volume que sa partie linéaire multiplie. C'est ce qu'il faut pour porter une longueur — le rayon
/// d'une lampe — d'un espace local vers le monde. Une matrice non uniforme rend la moyenne
/// géométrique de ses trois échelles, un miroir rend la même échelle que son reflet, et une matrice
/// dégénérée rend zéro : une longueur nulle, que l'appelant écarte.
pub(crate) fn uniform_scale(m: &[f64; 16]) -> f64 {
    let column = |c: usize| [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
    let (x, y, z) = (column(0), column(1), column(2));
    let cross = [
        y[1] * z[2] - y[2] * z[1],
        y[2] * z[0] - y[0] * z[2],
        y[0] * z[1] - y[1] * z[0],
    ];
    let determinant = x[0] * cross[0] + x[1] * cross[1] + x[2] * cross[2];
    determinant.abs().cbrt()
}
