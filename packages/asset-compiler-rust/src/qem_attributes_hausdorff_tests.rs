//! What a level certifies: nothing for a surface that stayed where it was, the distance it left
//! by for one that moved off.
use super::*;

/// Two triangles making a flat quad two units wide in `z = 0`, and the same quad with its first
/// corner moved. The corner carries the whole difference between the two surfaces.
fn quad(moved: [f32; 3]) -> f64 {
    let source = [0.0, 0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 2.0, 0.0, 2.0, 2.0, 0.0];
    let triangles = [0u32, 1, 2, 1, 3, 2];
    let mut positions = source;
    positions[..3].copy_from_slice(&moved);
    one_sided_hausdorff(&source, &triangles, &positions, &triangles)
}

// Behaviour: a surface that did not move certifies nothing, and neither does one whose vertices
// slid inside the surface they came from — the facade vertex along its wall, which a displacement
// would have charged in full.
#[test]
fn a_surface_that_stayed_on_its_own_costs_nothing() {
    assert!(quad([0.0, 0.0, 0.0]) < 1e-6);
    for slide in [0.25_f32, 1.0] {
        let slid = quad([slide, slide, 0.0]);
        assert!(
            slid < 1e-6,
            "a slide of {slide} inside the plane read {slid}"
        );
    }
}

// Behaviour: a surface the collapses or the solve took off the source certifies the distance it
// left by, whichever direction it left in.
#[test]
fn a_surface_that_left_costs_the_distance_it_left_by() {
    for height in [0.5_f32, -0.5] {
        let lifted = quad([0.5, 0.5, height]);
        assert!((lifted - 0.5).abs() < 1e-6, "{lifted} at {height}");
    }
}

// Behaviour: the distance is to the source triangles, not to their planes — a vertex that slid
// out past the edge of the quad is charged how far past it went, where a plane distance would
// still read zero. This is what makes the number a bound rather than an average.
#[test]
fn a_slide_past_the_edge_of_the_surface_costs_what_it_overhangs() {
    let past = quad([-1.5, 0.0, 0.0]);
    assert!((past - 1.5).abs() < 1e-6, "{past}");
}
