//! Lot F — bancs d'équivalence des boîtes englobantes factorisées. La référence est la boucle
//! recopiée telle qu'elle vivait dans `dag/bounds.rs`, `dag/culling.rs`, `dag/groups.rs`,
//! `coplanar/*.rs`, `import/mesh.rs` et `proxy/bvh.rs` ; la version mesurée appelle `shared_math`.
use super::f_valeurs::{boxes_f64, points_f32, points_f64};
use super::harness::{compare, Bits, Row};
use super::inputs::Xorshift;
use crate::shared_math::{bisect_centres, extend_aabb, extend_aabb_f32, merge_aabb};

const COUNT: usize = 200_000;

fn empreinte_f64(boite: &([f64; 3], [f64; 3])) -> Bits {
    let mut bits = Bits::default();
    for value in boite.0.iter().chain(boite.1.iter()) {
        bits.f64(*value);
    }
    bits
}

fn empreinte_f32(boite: &([f32; 3], [f32; 3])) -> Bits {
    let mut bits = Bits::default();
    for value in boite.0.iter().chain(boite.1.iter()) {
        bits.f32(*value);
    }
    bits
}

#[allow(clippy::ptr_arg)]
fn empreinte_ordre(ordre: &Vec<usize>) -> Bits {
    let mut bits = Bits::default();
    bits.len(ordre.len());
    for id in ordre {
        bits.len(*id);
    }
    bits
}

/// F1 — la boîte d'un nuage de points, la boucle de `bounding_sphere` contre `extend_aabb`.
pub(crate) fn row_points() -> Row {
    let points = points_f64(0x0F01_B01E, COUNT);
    compare(
        "F1 boîte d'un nuage de points (extend_aabb)",
        "shared_math.rs",
        format!("{COUNT} points doubles, un sur sept empoisonné"),
        &mut || {
            let mut low = [f64::INFINITY; 3];
            let mut high = [f64::NEG_INFINITY; 3];
            for p in &points {
                for a in 0..3 {
                    low[a] = low[a].min(p[a]);
                    high[a] = high[a].max(p[a]);
                }
            }
            (low, high)
        },
        &mut || {
            let mut low = [f64::INFINITY; 3];
            let mut high = [f64::NEG_INFINITY; 3];
            for p in &points {
                extend_aabb(&mut low, &mut high, *p);
            }
            (low, high)
        },
        empreinte_f64,
    )
}

/// F2 — la boîte d'une suite de boîtes, la boucle de `build_culling_bvh` contre `merge_aabb`.
pub(crate) fn row_boites() -> Row {
    let boxes = boxes_f64(0x0F02_B0C5, COUNT);
    compare(
        "F2 boîte de boîtes (merge_aabb)",
        "shared_math.rs",
        format!("{COUNT} boîtes, une sur onze retournée"),
        &mut || {
            let mut low = [f64::INFINITY; 3];
            let mut high = [f64::NEG_INFINITY; 3];
            for (bmin, bmax) in &boxes {
                for a in 0..3 {
                    low[a] = low[a].min(bmin[a]);
                    high[a] = high[a].max(bmax[a]);
                }
            }
            (low, high)
        },
        &mut || {
            let mut low = [f64::INFINITY; 3];
            let mut high = [f64::NEG_INFINITY; 3];
            for (bmin, bmax) in &boxes {
                merge_aabb(&mut low, &mut high, *bmin, *bmax);
            }
            (low, high)
        },
        empreinte_f64,
    )
}

/// F3 — la variante simple précision, celle d'`import/mesh.rs` et de `proxy/bvh.rs`.
pub(crate) fn row_simple() -> Row {
    let points = points_f32(0x0F03_5137, COUNT);
    compare(
        "F3 boîte en simple précision (extend_aabb_f32)",
        "shared_math.rs",
        format!("{COUNT} points simples, un sur sept empoisonné"),
        &mut || {
            let mut low = [f32::MAX; 3];
            let mut high = [f32::MIN; 3];
            for p in &points {
                for a in 0..3 {
                    low[a] = low[a].min(p[a]);
                    high[a] = high[a].max(p[a]);
                }
            }
            (low, high)
        },
        &mut || {
            let mut low = [f32::MAX; 3];
            let mut high = [f32::MIN; 3];
            for p in &points {
                extend_aabb_f32(&mut low, &mut high, *p);
            }
            (low, high)
        },
        empreinte_f32,
    )
}

/// F4 — le choix d'axe et la coupe médiane, la boucle de `group_clusters` contre `bisect_centres`.
pub(crate) fn row_bisection() -> Row {
    const GROUPS: usize = 40_000;
    let centres = points_f64(0x0F04_B15E, GROUPS);
    let mut rng = Xorshift::new(0x0F04_04DE);
    let depart: Vec<usize> = {
        let mut order: Vec<usize> = (0..GROUPS).collect();
        for slot in 0..GROUPS {
            order.swap(slot, rng.below(GROUPS));
        }
        order
    };
    compare(
        "F4 coupe médiane sur l'axe le plus long (bisect_centres)",
        "shared_math.rs",
        format!("{GROUPS} barycentres empoisonnés, ordre de départ mélangé"),
        &mut || {
            let mut slice = depart.clone();
            let mut low = [f64::INFINITY; 3];
            let mut high = [f64::NEG_INFINITY; 3];
            for &id in slice.iter() {
                for a in 0..3 {
                    low[a] = low[a].min(centres[id][a]);
                    high[a] = high[a].max(centres[id][a]);
                }
            }
            let mut axis = 0;
            for a in 1..3 {
                if high[a] - low[a] > high[axis] - low[axis] {
                    axis = a;
                }
            }
            slice.sort_unstable_by(|&x, &y| {
                centres[x][axis]
                    .total_cmp(&centres[y][axis])
                    .then(x.cmp(&y))
            });
            slice
        },
        &mut || {
            let mut slice = depart.clone();
            bisect_centres(&mut slice, &centres);
            slice
        },
        empreinte_ordre,
    )
}
