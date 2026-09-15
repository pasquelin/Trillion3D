//! Lot F — bancs d'équivalence des formules scalaires factorisées : le bourrage à quatre octets et
//! la normalisation gardée. La référence recopie les corps d'avant, un par site remplacé.
use super::f_valeurs::POISON_F64;
use super::harness::{compare, Bits, Row};
use super::inputs::Xorshift;
use crate::shared_math::{normalized_or, pad_to_4};

/// Toutes les longueurs de 0 à `SPAN`, plus le voisinage du plus grand `usize` : le bourrage doit
/// rendre le même nombre d'octets que la soustraction d'avant comme que la boucle `while`.
const SPAN: usize = 1_000_000;

#[allow(clippy::ptr_arg)]
fn empreinte_bourrage(pads: &Vec<usize>) -> Bits {
    let mut bits = Bits::default();
    bits.len(pads.len());
    for pad in pads {
        bits.len(*pad);
    }
    bits
}

#[allow(clippy::ptr_arg)]
fn empreinte_vecteurs(vecteurs: &Vec<[f64; 3]>) -> Bits {
    let mut bits = Bits::default();
    bits.len(vecteurs.len());
    for vecteur in vecteurs {
        for value in vecteur {
            bits.f64(*value);
        }
    }
    bits
}

/// F5 — `pad_to_4` contre les deux formes d'avant : la soustraction de `compiler_buffers.rs` et
/// `compiler_copy.rs`, et la boucle `while` de `compiler_autonomous.rs`, qui doivent coïncider.
pub(crate) fn row_bourrage() -> Row {
    let lengths: Vec<usize> = (0..SPAN)
        .chain((usize::MAX - 8)..usize::MAX)
        .chain([usize::MAX])
        .collect();
    compare(
        "F5 bourrage à quatre octets (pad_to_4)",
        "shared_math.rs",
        format!(
            "{} longueurs, dont le voisinage de usize::MAX",
            lengths.len()
        ),
        &mut || {
            lengths
                .iter()
                .map(|&length| {
                    let mut at = length;
                    let mut pad = 0usize;
                    while !at.is_multiple_of(4) {
                        at += 1;
                        pad += 1;
                    }
                    pad
                })
                .collect::<Vec<usize>>()
        },
        &mut || {
            lengths
                .iter()
                .map(|&length| pad_to_4(length))
                .collect::<Vec<usize>>()
        },
        empreinte_bourrage,
    )
}

/// Vecteurs à normaliser : des directions ordinaires, des vecteurs sous la garde, et des
/// coordonnées empoisonnées — NaN, infinis, zéros signés, dénormalisées.
fn directions(seed: u64, count: usize) -> Vec<[f64; 3]> {
    let mut rng = Xorshift::new(seed);
    (0..count)
        .map(|id| {
            let mut vector = [0.0f64; 3];
            for (axis, slot) in vector.iter_mut().enumerate() {
                *slot = match (id + axis) % 9 {
                    0 => POISON_F64[(id + axis) / 9 % POISON_F64.len()],
                    1 => 1e-13 * f64::from(rng.coordinate()),
                    _ => f64::from(rng.coordinate()),
                };
            }
            vector
        })
        .collect()
}

/// F6 — `normalized_or` contre les deux corps d'avant : celui d'`import/lighting.rs`, qui se replie
/// sur `-Z`, et celui d'`import/mesh.rs`, qui se replie sur `+Y`. Le repli est le seul paramètre.
pub(crate) fn row_normalisation() -> Row {
    const COUNT: usize = 300_000;
    let vectors = directions(0x0F06_0817, COUNT);
    compare(
        "F6 normalisation gardée à 1e-12 (normalized_or)",
        "shared_math.rs",
        format!("{COUNT} vecteurs, un axe sur neuf empoisonné, un sur neuf sous la garde"),
        &mut || {
            let mut out = Vec::with_capacity(vectors.len() * 2);
            for v in &vectors {
                let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
                out.push(if len > 1e-12 {
                    [v[0] / len, v[1] / len, v[2] / len]
                } else {
                    [0.0, 0.0, -1.0]
                });
                let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
                let (x, y, z) = if len > 1e-12 {
                    (v[0] / len, v[1] / len, v[2] / len)
                } else {
                    (0.0, 1.0, 0.0)
                };
                out.push([x, y, z]);
            }
            out
        },
        &mut || {
            let mut out = Vec::with_capacity(vectors.len() * 2);
            for v in &vectors {
                out.push(normalized_or(*v, [0.0, 0.0, -1.0]));
                out.push(normalized_or(*v, [0.0, 1.0, 0.0]));
            }
            out
        },
        empreinte_vecteurs,
    )
}
