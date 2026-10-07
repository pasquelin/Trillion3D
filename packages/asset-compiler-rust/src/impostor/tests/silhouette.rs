use crate::impostor::bake::{bake, Capture};
use crate::impostor::eligibility::FRAMES;
use crate::impostor::octahedron::{basis, frame_direction};
use trillion3d_math::vec3::add;
use trillion3d_math::vec3::scale;

/// Whether `mask` holds a texel within one texel of `(x, y)`, inside frame `(fx, fy)`.
fn near(mask: &[bool], atlas: usize, frame: usize, (x, y): (usize, usize)) -> bool {
    let (fx, fy) = (x - x % frame, y - y % frame);
    let span = |v: usize, f: usize| v.saturating_sub(1).max(f)..=(v + 1).min(f + frame - 1);
    span(y, fy).any(|ny| span(x, fx).any(|nx| mask[ny * atlas + nx]))
}

// Behaviour: a synthetic tree bakes FRAMES×FRAMES frames whose silhouette — coverage at the cut
// — matches a direct orthographic trace of the mesh, one ray per texel centre, within one texel,
// on the full and the hemi octahedron; the masked leaves are cut where their texture is.
#[test]
fn a_tree_s_frames_match_a_direct_orthographic_trace_within_one_texel() {
    let tree = super::tree();
    for hemi in [false, true] {
        let capture = Capture {
            frames: FRAMES,
            side: 32,
            hemi,
        };
        let atlas = bake(&tree, capture);
        assert_eq!(atlas.side, FRAMES * 32);
        let covered: Vec<bool> = atlas.maps[0]
            .as_chunks::<4>()
            .0
            .iter()
            .map(|t| t[3] >= 128)
            .collect();
        let mut direct = vec![false; covered.len()];
        let r = tree.radius;
        for (i, j) in (0..FRAMES).flat_map(|i| (0..FRAMES).map(move |j| (i, j))) {
            let dir = frame_direction((i, j), FRAMES, hemi);
            let (x, y) = basis(dir);
            for t in 0..32 * 32 {
                let (px, py) = (t % 32, t / 32);
                let u = ((px as f64 + 0.5) / 32.0 - 0.5) * 2.0 * r;
                let v = (0.5 - (py as f64 + 0.5) / 32.0) * 2.0 * r;
                let origin = add(
                    add(tree.centre, scale(dir, 2.0 * r)),
                    add(scale(x, u), scale(y, v)),
                );
                let hit = tree.trace(origin, scale(dir, -1.0), 4.0 * r).is_some();
                direct[(j * 32 + py) * atlas.side + i * 32 + px] = hit;
            }
        }
        let texels = (0..covered.len()).map(|k| (k % atlas.side, k / atlas.side));
        let strays: Vec<_> = texels
            .filter(|&(x, y)| {
                let k = y * atlas.side + x;
                (covered[k] && !near(&direct, atlas.side, 32, (x, y)))
                    || (direct[k] && !near(&covered, atlas.side, 32, (x, y)))
            })
            .collect();
        assert!(
            strays.is_empty(),
            "hemi {hemi}: {} texels off by more than one",
            strays.len()
        );
        let area = |m: &[bool]| m.iter().filter(|&&c| c).count() as f64;
        assert!(
            area(&covered) > 0.05 * covered.len() as f64,
            "the tree covers its frames"
        );
    }
}

// Behaviour: the hit filter lets a ray through a masked card where its texel is cut, and stops
// it where the texel is kept; the same card opaque stops both.
#[test]
fn a_ray_passes_a_cut_texel_and_stops_on_a_kept_one() {
    for (cut, corner_hits) in [(Some((0.5, 1.0)), false), (None, true)] {
        let mut out = (Vec::new(), Vec::new(), Vec::new());
        super::quad(&mut out, [0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], 0);
        let surfaces = vec![super::surface(Some(super::leaf_texels()), cut)];
        let card = crate::impostor::mesh::Traceable::new(out.0, out.1, out.2, surfaces);
        let ray = |x: f64, y: f64| card.trace([x, y, 5.0], [0.0, 0.0, -1.0], 10.0).is_some();
        assert!(ray(0.0, 0.0), "the disc's centre is kept");
        assert_eq!(
            ray(-0.95, -0.95),
            corner_hits,
            "the corner outside the disc"
        );
    }
}
