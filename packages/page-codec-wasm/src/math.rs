//! Noyaux de calcul en lot du socle mathématique, en f64, aux bits de la version JavaScript.
//!
//! Chaque fonction reproduit terme à terme, parenthèses comprises, l'ordre des opérations
//! flottantes de son homologue de `packages/sdk-core/` : `mathMatrix4.ts::multiplyMatrix4` et
//! `mathBox.ts::boxTransform` (qui appelle `boxCornersInto`, `boxEmpty` et `boxExpandByPoint`).
//!
//! L'égalité est structurelle, pas espérée. WebAssembly n'a aucune instruction de
//! multiplication-addition fusionnée : ni le jeu de base, ni `simd128` n'en portent, et
//! `relaxed-simd`, la seule extension qui en ait une, est refusée puis vérifiée par
//! `scripts/build-wasm.mjs`. Son arithmétique f64 est celle d'IEEE-754, correctement arrondie,
//! exactement celle des nombres de JavaScript. Et rustc n'active jamais de réassociation flottante :
//! il n'a pas d'équivalent de `-ffast-math`, donc `lto`, `opt-level` et la vectorisation automatique
//! ne peuvent que réordonner des voies indépendantes, jamais réassocier une somme.
//!
//! `Math.min` et `Math.max` de JavaScript ne sont pas `f64::min` et `f64::max` de Rust : le premier
//! propage NaN là où le second l'écarte, et JavaScript départage `-0` de `+0` là où Rust ne le
//! promet pas. Les deux sont réécrits ici.

/// Flottants d'une boîte rangée à plat, comme `BOX_VALUES` de `mathBox.ts`.
pub const BOX_VALUES: usize = 6;
/// Flottants d'une matrice 4×4 colonne-major.
pub const MATRIX_VALUES: usize = 16;
/// Flottants des huit coins transformés d'une boîte.
const CORNER_VALUES: usize = 24;

/// `Math.min` : NaN contamine, et `-0` l'emporte sur `+0`.
#[inline]
fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    if a < b {
        return a;
    }
    if b < a {
        return b;
    }
    if a.is_sign_negative() {
        a
    } else {
        b
    }
}

/// `Math.max` : NaN contamine, et `+0` l'emporte sur `-0`.
#[inline]
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    if a > b {
        return a;
    }
    if b > a {
        return b;
    }
    if a.is_sign_positive() {
        a
    } else {
        b
    }
}

/// `boxTransform` d'une boîte : `out` et `boxes` portent six flottants, `m` seize. Une boîte vide
/// — une borne haute sous sa borne basse — est recopiée telle quelle, bornes comprises.
fn box_transform_one(out: &mut [f64], boxes: &[f64], m: &[f64]) {
    let (min_x, min_y, min_z) = (boxes[0], boxes[1], boxes[2]);
    let (max_x, max_y, max_z) = (boxes[3], boxes[4], boxes[5]);
    if max_x < min_x || max_y < min_y || max_z < min_z {
        out[0] = min_x;
        out[1] = min_y;
        out[2] = min_z;
        out[3] = max_x;
        out[4] = max_y;
        out[5] = max_z;
        return;
    }
    let mut corners = [0f64; CORNER_VALUES];
    for i in 0..8usize {
        let lx = if i & 1 != 0 { max_x } else { min_x };
        let ly = if i & 2 != 0 { max_y } else { min_y };
        let lz = if i & 4 != 0 { max_z } else { min_z };
        let mw = 1.0 / (m[3] * lx + m[7] * ly + m[11] * lz + m[15]);
        let at = i * 3;
        corners[at] = (m[0] * lx + m[4] * ly + m[8] * lz + m[12]) * mw;
        corners[at + 1] = (m[1] * lx + m[5] * ly + m[9] * lz + m[13]) * mw;
        corners[at + 2] = (m[2] * lx + m[6] * ly + m[10] * lz + m[14]) * mw;
    }
    out[0] = f64::INFINITY;
    out[1] = f64::INFINITY;
    out[2] = f64::INFINITY;
    out[3] = f64::NEG_INFINITY;
    out[4] = f64::NEG_INFINITY;
    out[5] = f64::NEG_INFINITY;
    for at in (0..CORNER_VALUES).step_by(3) {
        out[0] = js_min(out[0], corners[at]);
        out[1] = js_min(out[1], corners[at + 1]);
        out[2] = js_min(out[2], corners[at + 2]);
        out[3] = js_max(out[3], corners[at]);
        out[4] = js_max(out[4], corners[at + 1]);
        out[5] = js_max(out[5], corners[at + 2]);
    }
}

/// `multiplyMatrix4` d'une paire : les trente-deux entrées sont lues avant la première écriture, et
/// chaque terme est la somme de quatre produits sans zéro initial — une somme commencée à `0`
/// changerait le signe d'un zéro négatif.
fn multiply_matrix4_one(out: &mut [f64], a: &[f64], b: &[f64]) {
    let (a11, a12, a13, a14) = (a[0], a[4], a[8], a[12]);
    let (a21, a22, a23, a24) = (a[1], a[5], a[9], a[13]);
    let (a31, a32, a33, a34) = (a[2], a[6], a[10], a[14]);
    let (a41, a42, a43, a44) = (a[3], a[7], a[11], a[15]);
    let (b11, b12, b13, b14) = (b[0], b[4], b[8], b[12]);
    let (b21, b22, b23, b24) = (b[1], b[5], b[9], b[13]);
    let (b31, b32, b33, b34) = (b[2], b[6], b[10], b[14]);
    let (b41, b42, b43, b44) = (b[3], b[7], b[11], b[15]);
    out[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
    out[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
    out[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
    out[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
    out[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
    out[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
    out[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
    out[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
    out[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
    out[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
    out[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
    out[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
    out[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
    out[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
    out[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
    out[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
}

/// `n` boîtes transformées par `n` matrices, les trois tampons rangés à plat et disjoints.
pub fn box_transform_batch(out: &mut [f64], boxes: &[f64], mats: &[f64], n: usize) {
    for i in 0..n {
        let o = i * BOX_VALUES;
        let m = i * MATRIX_VALUES;
        box_transform_one(
            &mut out[o..o + BOX_VALUES],
            &boxes[o..o + BOX_VALUES],
            &mats[m..m + MATRIX_VALUES],
        );
    }
}

/// `n` produits `out[i] = a[i] · b[i]`, les trois tampons rangés à plat et disjoints.
pub fn multiply_matrix4_batch(out: &mut [f64], a: &[f64], b: &[f64], n: usize) {
    for i in 0..n {
        let at = i * MATRIX_VALUES;
        let (left, right) = (&a[at..at + MATRIX_VALUES], &b[at..at + MATRIX_VALUES]);
        multiply_matrix4_one(&mut out[at..at + MATRIX_VALUES], left, right);
    }
}
