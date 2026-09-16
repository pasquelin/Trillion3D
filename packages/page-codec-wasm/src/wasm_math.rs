//! ABI brute du tampon partagé et des lots de calcul : pas de `wasm-bindgen`, rien que des entiers
//! et des offsets d'octets dans la mémoire linéaire, comme `wasm.rs` pour le décodeur de pages.
//!
//! Le tampon est alloué ici en `f64`, donc aligné sur huit octets : JavaScript peut poser dessus des
//! vues `Float64Array`, `Float32Array` ou `Uint32Array` à volonté. Rien n'est recopié sur le chemin
//! de calcul — les deux côtés lisent et écrivent la même mémoire. Une réservation peut faire grandir
//! la mémoire linéaire et invalider toutes les vues : c'est le seul moment où cela arrive, et le
//! chargeur JavaScript refait ses vues là et nulle part ailleurs.

use crate::math::{box_transform_batch, multiply_matrix4_batch, BOX_VALUES, MATRIX_VALUES};
use crate::math_hierarchy::{hierarchy_update_batch, POSITION_VALUES, QUATERNION_VALUES};
use crate::wasm::{fuite, rends};

/// Version du contrat de cette ABI. Le chargeur refuse un module qui ne rend pas celle qu'il attend.
const CONTRACT: u32 = 1;
/// Octets d'un `f64` : le tampon est compté en mots de cette taille.
const WORD: usize = 8;
/// Plafond d'une réservation, en octets. Au-delà, la demande est refusée plutôt qu'honorée par une
/// mémoire linéaire que l'hôte ne pourra plus rendre : un lot de calcul du moteur ne pèse pas un
/// gigaoctet, et une taille pareille vient d'un compte faux, pas d'une scène.
const MAX_BYTES: usize = 1 << 30;

/// La version du contrat que ce module honore.
#[no_mangle]
pub extern "C" fn math_contract() -> u32 {
    CONTRACT
}

/// 1 si le module a été compilé avec `simd128`, 0 sinon. Les bits ne changent pas avec : une
/// vectorisation de voies f64 indépendantes est correctement arrondie voie par voie, comme le
/// scalaire, et WebAssembly n'a pas d'instruction fusionnée qui pourrait en changer l'arrondi.
#[no_mangle]
pub extern "C" fn math_simd() -> u32 {
    u32::from(cfg!(target_feature = "simd128"))
}

/// Réserve `bytes` octets remis à zéro, alignés sur huit. Rend 0 si la taille est absurde.
#[no_mangle]
pub extern "C" fn arena_alloc(bytes: usize) -> u32 {
    if bytes == 0 || bytes > MAX_BYTES {
        return 0;
    }
    fuite(vec![0f64; bytes.div_ceil(WORD)])
}

/// Rend une réservation d'`arena_alloc`.
///
/// # Safety
/// `offset` doit venir d'`arena_alloc` avec ce même `bytes`, et n'avoir pas déjà été rendu.
#[no_mangle]
pub unsafe extern "C" fn arena_free(offset: u32, bytes: usize) {
    rends::<f64>(offset, bytes.div_ceil(WORD));
}

/// `n` boîtes transformées par `n` matrices. Les trois offsets sont des octets, alignés sur huit.
///
/// # Safety
/// Les trois plages doivent tenir dans des réservations vivantes d'`arena_alloc`, être disjointes,
/// et porter respectivement `6 · n`, `6 · n` et `16 · n` flottants.
#[no_mangle]
pub unsafe extern "C" fn math_box_transform_batch(out: u32, boxes: u32, mats: u32, n: usize) {
    box_transform_batch(
        core::slice::from_raw_parts_mut(out as *mut f64, n * BOX_VALUES),
        core::slice::from_raw_parts(boxes as *const f64, n * BOX_VALUES),
        core::slice::from_raw_parts(mats as *const f64, n * MATRIX_VALUES),
        n,
    );
}

/// `n` produits `out[i] = a[i] · b[i]`. Les trois offsets sont des octets, alignés sur huit.
///
/// # Safety
/// Les trois plages doivent tenir dans des réservations vivantes d'`arena_alloc`, être disjointes,
/// et porter chacune `16 · n` flottants.
#[no_mangle]
pub unsafe extern "C" fn math_multiply_matrix4_batch(out: u32, a: u32, b: u32, n: usize) {
    let values = n * MATRIX_VALUES;
    multiply_matrix4_batch(
        core::slice::from_raw_parts_mut(out as *mut f64, values),
        core::slice::from_raw_parts(a as *const f64, values),
        core::slice::from_raw_parts(b as *const f64, values),
        n,
    );
}

/// La hiérarchie entière : `n` nœuds rangés parents avant enfants. Les offsets sont des octets,
/// alignés sur huit, sauf `parents`, qui porte `n` mots de 32 bits alignés sur quatre.
///
/// # Safety
/// Les cinq plages doivent tenir dans des réservations vivantes d'`arena_alloc`, être disjointes, et
/// porter respectivement `16 · n`, `3 · n`, `4 · n` et `3 · n` flottants, puis `n` entiers.
#[no_mangle]
pub unsafe extern "C" fn math_hierarchy_update_batch(
    world: u32,
    positions: u32,
    rotations: u32,
    scales: u32,
    parents: u32,
    n: usize,
) {
    hierarchy_update_batch(
        core::slice::from_raw_parts_mut(world as *mut f64, n * MATRIX_VALUES),
        core::slice::from_raw_parts(positions as *const f64, n * POSITION_VALUES),
        core::slice::from_raw_parts(rotations as *const f64, n * QUATERNION_VALUES),
        core::slice::from_raw_parts(scales as *const f64, n * POSITION_VALUES),
        core::slice::from_raw_parts(parents as *const u32, n),
        n,
    );
}
