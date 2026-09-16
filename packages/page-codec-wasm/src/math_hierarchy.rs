//! La hiérarchie entière mise à jour en une passe, aux bits de `mathBatch.ts::hierarchyUpdateBatch`.
//!
//! Même règle qu'en JavaScript, terme à terme : les nœuds sont rangés parents avant enfants, chacun
//! compose sa matrice locale depuis sa position, son quaternion et son échelle
//! (`mathMatrix4Trs.ts::composeMatrix4`), puis la multiplie par la matrice monde de son parent
//! (`mathMatrix4.ts::multiplyMatrix4`). Les produits du quaternion sont doublés par addition
//! (`x + x`), jamais multipliés par deux, et la dernière ligne est écrite `(0, 0, 0, 1)` exactement.
//!
//! `parents[i]` doit désigner un nœud déjà mis à jour, donc d'indice strictement inférieur à `i` ;
//! toute autre valeur — la sentinelle `0xffff_ffff` comprise — fait du nœud une racine, dont la
//! matrice monde est sa matrice locale. C'est la règle du chemin JavaScript, et c'est aussi ce qui
//! garde ce noyau sûr : aucun indice hors du travail déjà fait n'est jamais lu.

use crate::math::{multiply_matrix4_one, MATRIX_VALUES};

/// Flottants d'une position ou d'une échelle, et d'un quaternion `(x, y, z, w)`.
pub const POSITION_VALUES: usize = 3;
pub const QUATERNION_VALUES: usize = 4;

/// `composeMatrix4` d'un nœud : `out = T · R · S`, seize flottants colonne-major.
fn compose_matrix4_one(out: &mut [f64], position: &[f64], quaternion: &[f64], scale: &[f64]) {
    let (x, y, z, w) = (quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
    let (x2, y2, z2) = (x + x, y + y, z + z);
    let (xx, xy, xz) = (x * x2, x * y2, x * z2);
    let (yy, yz, zz) = (y * y2, y * z2, z * z2);
    let (wx, wy, wz) = (w * x2, w * y2, w * z2);
    let (sx, sy, sz) = (scale[0], scale[1], scale[2]);
    out[0] = (1.0 - (yy + zz)) * sx;
    out[1] = (xy + wz) * sx;
    out[2] = (xz - wy) * sx;
    out[3] = 0.0;
    out[4] = (xy - wz) * sy;
    out[5] = (1.0 - (xx + zz)) * sy;
    out[6] = (yz + wx) * sy;
    out[7] = 0.0;
    out[8] = (xz + wy) * sz;
    out[9] = (yz - wx) * sz;
    out[10] = (1.0 - (xx + yy)) * sz;
    out[11] = 0.0;
    out[12] = position[0];
    out[13] = position[1];
    out[14] = position[2];
    out[15] = 1.0;
}

/// Les `n` nœuds, dans l'ordre des indices : matrice locale composée, puis matrice monde écrite.
pub fn hierarchy_update_batch(
    world: &mut [f64],
    positions: &[f64],
    rotations: &[f64],
    scales: &[f64],
    parents: &[u32],
    n: usize,
) {
    let mut local = [0f64; MATRIX_VALUES];
    for (i, &parent) in parents[..n].iter().enumerate() {
        let p = i * POSITION_VALUES;
        let q = i * QUATERNION_VALUES;
        compose_matrix4_one(
            &mut local,
            &positions[p..p + POSITION_VALUES],
            &rotations[q..q + QUATERNION_VALUES],
            &scales[p..p + POSITION_VALUES],
        );
        let at = i * MATRIX_VALUES;
        let parent = parent as usize;
        if parent >= i {
            world[at..at + MATRIX_VALUES].copy_from_slice(&local);
            continue;
        }
        // Le parent est déjà écrit et se trouve avant `at` : les deux emprunts sont disjoints.
        let (fait, reste) = world.split_at_mut(at);
        let depuis = parent * MATRIX_VALUES;
        multiply_matrix4_one(
            &mut reste[..MATRIX_VALUES],
            &fait[depuis..depuis + MATRIX_VALUES],
            &local,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Une chaîne de trois nœuds : une racine, son enfant, le petit-enfant, échelles non uniformes.
    fn chaine() -> (Vec<f64>, Vec<f64>, Vec<f64>, Vec<u32>) {
        let positions = vec![1.0, 2.0, 3.0, -1.0, 0.5, 0.25, 0.0, -0.0, 7.0];
        let rotations = vec![
            0.0, 0.0, 0.0, 1.0, // identité
            0.5, 0.5, 0.5, 0.5, // quart de tour composé
            0.0, 1.0, 0.0, 0.0, // demi-tour, w nul
        ];
        let scales = vec![2.0, 0.5, 3.0, -1.0, 1.0, 1.0, 1e-8, 1.0, 1e150];
        (positions, rotations, scales, vec![u32::MAX, 0, 1])
    }

    #[test]
    fn une_racine_recopie_sa_matrice_locale() {
        let (positions, rotations, scales, parents) = chaine();
        let mut world = vec![0f64; 3 * MATRIX_VALUES];
        hierarchy_update_batch(&mut world, &positions, &rotations, &scales, &parents, 1);
        let mut local = [0f64; MATRIX_VALUES];
        compose_matrix4_one(
            &mut local,
            &positions[0..3],
            &rotations[0..4],
            &scales[0..3],
        );
        assert_eq!(world[..MATRIX_VALUES], local[..]);
    }

    #[test]
    fn un_enfant_est_le_produit_du_monde_de_son_parent_par_sa_locale() {
        let (positions, rotations, scales, parents) = chaine();
        let mut world = vec![0f64; 3 * MATRIX_VALUES];
        hierarchy_update_batch(&mut world, &positions, &rotations, &scales, &parents, 3);
        let mut attendu = [0f64; MATRIX_VALUES];
        let mut local = [0f64; MATRIX_VALUES];
        compose_matrix4_one(
            &mut local,
            &positions[3..6],
            &rotations[4..8],
            &scales[3..6],
        );
        multiply_matrix4_one(&mut attendu, &world[..MATRIX_VALUES], &local);
        assert_eq!(world[MATRIX_VALUES..2 * MATRIX_VALUES], attendu[..]);
        // Le petit-enfant compose bien depuis le MONDE de son parent, pas depuis sa locale.
        compose_matrix4_one(
            &mut local,
            &positions[6..9],
            &rotations[8..12],
            &scales[6..9],
        );
        multiply_matrix4_one(
            &mut attendu,
            &world[MATRIX_VALUES..2 * MATRIX_VALUES],
            &local,
        );
        assert_eq!(world[2 * MATRIX_VALUES..], attendu[..]);
    }

    #[test]
    fn un_parent_qui_ne_precede_pas_son_enfant_fait_une_racine() {
        let (positions, rotations, scales, _) = chaine();
        let mut world = vec![0f64; 3 * MATRIX_VALUES];
        // `2` ne précède pas le nœud 1, et `7` sort du lot : les deux sont des racines.
        let parents = vec![u32::MAX, 2, 7];
        hierarchy_update_batch(&mut world, &positions, &rotations, &scales, &parents, 3);
        let mut local = [0f64; MATRIX_VALUES];
        compose_matrix4_one(
            &mut local,
            &positions[3..6],
            &rotations[4..8],
            &scales[3..6],
        );
        assert_eq!(world[MATRIX_VALUES..2 * MATRIX_VALUES], local[..]);
    }
}
