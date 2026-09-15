//! Valeurs hostiles des bancs d'équivalence du lot F : NaN, infinis, zéros signés, dénormalisées,
//! et des coordonnées ordinaires autour. Une factorisation n'est retenue que si elle rend les mêmes
//! bits que la copie d'avant sur ces valeurs-là, pas seulement sur des nombres bien élevés.
use super::inputs::Xorshift;

/// Les flottants doubles qui font tomber une comparaison naïve, dans un ordre fixe.
pub(crate) const POISON_F64: [f64; 10] = [
    f64::NAN,
    f64::INFINITY,
    f64::NEG_INFINITY,
    -0.0,
    0.0,
    f64::MIN_POSITIVE,
    -f64::MIN_POSITIVE,
    5e-324,
    -5e-324,
    f64::MAX,
];

/// Les mêmes en simple précision.
pub(crate) const POISON_F32: [f32; 10] = [
    f32::NAN,
    f32::INFINITY,
    f32::NEG_INFINITY,
    -0.0,
    0.0,
    f32::MIN_POSITIVE,
    -f32::MIN_POSITIVE,
    1e-45,
    -1e-45,
    f32::MAX,
];

/// `count` points doubles : un sur sept est empoisonné, coordonnée par coordonnée.
pub(crate) fn points_f64(seed: u64, count: usize) -> Vec<[f64; 3]> {
    let mut rng = Xorshift::new(seed);
    (0..count)
        .map(|id| {
            let mut point = [0.0f64; 3];
            for (axis, slot) in point.iter_mut().enumerate() {
                *slot = if (id + axis) % 7 == 0 {
                    POISON_F64[(id + axis) / 7 % POISON_F64.len()]
                } else {
                    f64::from(rng.coordinate())
                };
            }
            point
        })
        .collect()
}

/// `count` points simples, empoisonnés de la même façon.
pub(crate) fn points_f32(seed: u64, count: usize) -> Vec<[f32; 3]> {
    let mut rng = Xorshift::new(seed);
    (0..count)
        .map(|id| {
            let mut point = [0.0f32; 3];
            for (axis, slot) in point.iter_mut().enumerate() {
                *slot = if (id + axis) % 7 == 0 {
                    POISON_F32[(id + axis) / 7 % POISON_F32.len()]
                } else {
                    rng.coordinate()
                };
            }
            point
        })
        .collect()
}

/// `count` boîtes, dont une sur onze est retournée (coin bas au-dessus du coin haut) : c'est là que
/// comparer le coin bas au coin haut, ou l'inverse, ne rendrait plus la même boîte.
pub(crate) fn boxes_f64(seed: u64, count: usize) -> Vec<([f64; 3], [f64; 3])> {
    let points = points_f64(seed, count * 2);
    (0..count)
        .map(|id| {
            let (low, high) = (points[id * 2], points[id * 2 + 1]);
            if id % 11 == 0 {
                (high, low)
            } else {
                (low, high)
            }
        })
        .collect()
}
