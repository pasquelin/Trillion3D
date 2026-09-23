//! B9 — explicit `#[inline]` on small vector functions. Reference: the same
//! bodies, copied into the bench without the attribute, French names.
use super::harness::{compare, Bits, Row};
use super::inputs;
use crate::dag::bounds::{bounding_sphere, enclosing_sphere};

fn point_reference(positions: &[f32], id: u32) -> [f64; 3] {
    let debut = id as usize * 3;
    [
        positions[debut] as f64,
        positions[debut + 1] as f64,
        positions[debut + 2] as f64,
    ]
}

fn sphere_reference(positions: &[f32], indices: &[u32]) -> [f64; 4] {
    let mut bas = [f64::INFINITY; 3];
    let mut haut = [f64::NEG_INFINITY; 3];
    for &id in indices {
        let p = point_reference(positions, id);
        for a in 0..3 {
            bas[a] = bas[a].min(p[a]);
            haut[a] = haut[a].max(p[a]);
        }
    }
    if !bas[0].is_finite() {
        return [0.0, 0.0, 0.0, 0.0];
    }
    let centre = [
        (bas[0] + haut[0]) * 0.5,
        (bas[1] + haut[1]) * 0.5,
        (bas[2] + haut[2]) * 0.5,
    ];
    let mut rayon = 0.0_f64;
    for &id in indices {
        let p = point_reference(positions, id);
        let d =
            ((p[0] - centre[0]).powi(2) + (p[1] - centre[1]).powi(2) + (p[2] - centre[2]).powi(2))
                .sqrt();
        if d > rayon {
            rayon = d;
        }
    }
    [centre[0], centre[1], centre[2], rayon]
}

fn empreinte(spheres: &Vec<[f64; 4]>) -> Bits {
    let mut bits = Bits::default();
    bits.len(spheres.len());
    for sphere in spheres {
        for value in sphere {
            bits.f64(*value);
        }
    }
    bits
}

pub(crate) fn row() -> Row {
    // A poisoned mesh: NaN, ±Infinity and -0 in the positions.
    let (positions, indices) = inputs::mesh_hostile(0x0009_EC10, 400_000);
    let clusters: Vec<&[u32]> = indices.chunks(128 * 3).collect();
    compare(
        "B9 bounding spheres (#[inline])",
        "dag/bounds.rs",
        "400 000 triangles, 3 125 clusters, positions non finies".into(),
        &mut || {
            let mut out: Vec<[f64; 4]> = clusters
                .iter()
                .map(|cluster| sphere_reference(&positions, cluster))
                .collect();
            let englobante = enclosing_sphere(&out);
            out.push(englobante);
            out
        },
        &mut || {
            let mut out: Vec<[f64; 4]> = clusters
                .iter()
                .map(|cluster| bounding_sphere(&positions, cluster))
                .collect();
            let englobante = enclosing_sphere(&out);
            out.push(englobante);
            out
        },
        empreinte,
    )
}
