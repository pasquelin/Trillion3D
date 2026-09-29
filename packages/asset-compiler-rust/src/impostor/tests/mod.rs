//! The bake's proofs, on a synthetic tree: a trunk and a canopy of masked leaf cards.
use super::mesh::{Corners, Traceable};
use super::surface::{Surface, Texels};

mod capture;
mod mapping;
mod materials;
mod mips;
mod refusal;
mod silhouette;

/// A leaf texture: opaque inside the inscribed disc, cut outside, so the filter decides.
fn leaf_texels() -> Texels {
    let side = 16usize;
    let pixels = (0..side * side)
        .flat_map(|t| {
            let (x, y) = ((t % side) as f64 + 0.5, (t / side) as f64 + 0.5);
            let inside = (x - 8.0).powi(2) + (y - 8.0).powi(2) <= 49.0;
            [40, 140, 50, if inside { 255 } else { 0 }]
        })
        .collect();
    Texels {
        width: side,
        height: side,
        pixels,
    }
}

pub(super) fn surface(colour: Option<Texels>, cut: Option<(f32, f32)>) -> Surface {
    Surface {
        factor: [1.0; 4],
        colour,
        metal_rough: None,
        occlusion: None,
        rough_metal: [0.8, 0.0],
        cut,
        sets: [0; 3],
        transforms: [[1.0, 0.0, 0.0, 0.0, 1.0, 0.0]; 3],
    }
}

/// One quad, `centre` ± `a` ± `b`, texture coordinates over `[0, 1]²`, as two triangles.
pub(super) fn quad(
    out: &mut (Vec<f32>, Vec<u32>, Vec<Corners>),
    centre: [f64; 3],
    a: [f64; 3],
    b: [f64; 3],
    tag: u32,
) {
    let corner = |s: f64, t: f64| [0, 1, 2].map(|k| (centre[k] + s * a[k] + t * b[k]) as f32);
    let (p, uv) = (
        [
            corner(-1.0, -1.0),
            corner(1.0, -1.0),
            corner(1.0, 1.0),
            corner(-1.0, 1.0),
        ],
        [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
    );
    for [i, j, k] in [[0, 1, 2], [0, 2, 3]] {
        out.0.extend([p[i], p[j], p[k]].concat());
        out.1.push(tag);
        let mut corners = Corners::default();
        corners.uv[0] = [uv[i], uv[j], uv[k]].concat().try_into().expect("six");
        out.2.push(corners);
    }
}

/// A trunk of four opaque faces, and 60 masked leaf cards on a sphere above it.
pub(super) fn tree() -> Traceable {
    let mut out = (Vec::new(), Vec::new(), Vec::new());
    for (a, n) in [
        ([0.1, 0.0, 0.0], [0.0, 0.0, 0.1]),
        ([0.0, 0.0, 0.1], [0.1, 0.0, 0.0]),
    ] {
        for sign in [-1.0, 1.0] {
            let centre = [n[0] * sign, 0.75, n[2] * sign];
            quad(&mut out, centre, a, [0.0, 0.75, 0.0], 0);
        }
    }
    let golden = std::f64::consts::PI * (3.0 - 5f64.sqrt());
    for k in 0..60 {
        let y = 1.0 - 2.0 * (k as f64 + 0.5) / 60.0;
        let (r, phi) = ((1.0 - y * y).sqrt(), golden * k as f64);
        let centre = [0.8 * r * phi.cos(), 2.1 + 0.8 * y, 0.8 * r * phi.sin()];
        let a = [0.2 * phi.sin(), 0.0, -0.2 * phi.cos()];
        let b = [0.2 * y * phi.cos(), -0.2 * r, 0.2 * y * phi.sin()];
        quad(&mut out, centre, a, b, 1);
    }
    let surfaces = vec![
        surface(None, None),
        surface(Some(leaf_texels()), Some((0.5, 1.0))),
    ];
    Traceable::new(out.0, out.1, out.2, surfaces)
}
