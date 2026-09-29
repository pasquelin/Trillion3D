use super::{quad, surface};
use crate::impostor::bake::{bake, Capture};
use crate::impostor::mesh::Traceable;
use crate::impostor::stage::deforms;
use serde_json::json;

// Behaviour: a frame's rows run top to bottom — a wide card above the pivot and a narrow one
// below, seen from the side, fill the top half of the frame, not the bottom.
#[test]
fn a_frame_s_first_rows_are_the_top_of_the_view() {
    let mut out = (Vec::new(), Vec::new(), Vec::new());
    quad(
        &mut out,
        [0.0, 1.0, 0.0],
        [1.0, 0.0, 0.0],
        [0.0, 0.5, 0.0],
        0,
    );
    quad(
        &mut out,
        [0.0, -1.0, 0.0],
        [0.05, 0.0, 0.0],
        [0.0, 0.05, 0.0],
        0,
    );
    let card = Traceable::new(out.0, out.1, out.2, vec![surface(None, None)]);
    // Three frames a side: frame (1, 2) looks back along +Z, its `y` axis world up.
    let atlas = bake(
        &card,
        Capture {
            frames: 3,
            side: 16,
            hemi: false,
        },
    );
    let covered = |rows: std::ops::Range<usize>| -> usize {
        rows.flat_map(|y| (16..32).map(move |x| (32 + y) * atlas.side + x))
            .filter(|&t| atlas.maps[0][t * 4 + 3] > 0)
            .count()
    };
    assert!(
        covered(0..8) > 4 * covered(8..16).max(1),
        "{} {}",
        covered(0..8),
        covered(8..16)
    );
}

// Behaviour: `COLOR_0` tints the captured colour and scales the alpha the mask tests, as the
// engine's surface does.
#[test]
fn the_vertex_colour_tints_the_capture_and_its_alpha_cuts() {
    let card = |alpha: f32, cut| {
        let mut out = (Vec::new(), Vec::new(), Vec::new());
        quad(&mut out, [0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], 0);
        for corner in &mut out.2 {
            corner.colours = Some(
                [[1.0, 0.25, 0.0, alpha]; 3]
                    .concat()
                    .try_into()
                    .expect("12"),
            );
        }
        Traceable::new(out.0, out.1, out.2, vec![surface(None, cut)])
    };
    let ray = |mesh: &Traceable| mesh.trace([0.2, 0.1, 5.0], [0.0, 0.0, -1.0], 10.0);
    let hit = ray(&card(1.0, None)).expect("an opaque card is hit");
    assert_eq!(hit.colour, [1.0, 0.25, 0.0]);
    assert!(ray(&card(0.8, Some((0.5, 1.0)))).is_some());
    assert!(ray(&card(0.2, Some((0.5, 1.0)))).is_none());
}

// Behaviour: a mesh with morph targets or joint weights deforms, skin node or not.
#[test]
fn morph_targets_and_joint_weights_deform() {
    let g = json!({"meshes": [
        {"primitives": [{"attributes": {"POSITION": 0}}]},
        {"primitives": [{"attributes": {"POSITION": 0}, "targets": [{"POSITION": 1}]}]},
        {"primitives": [{"attributes": {"POSITION": 0, "JOINTS_0": 1, "WEIGHTS_0": 2}}]},
    ]});
    assert_eq!([0, 1, 2].map(|m| deforms(&g, m)), [false, true, true]);
}
