use crate::impostor::surface::{coverage_cut, Surface};
use serde_json::json;

// Behaviour: the bake cuts exactly where the texture chains take coverage — a cutting MASK at
// its cutoff, a BLEND that does not transmit at 0.5 —, and a MASK at 0 or a transmissive BLEND,
// drawn opaque by the engine, keep every texel.
#[test]
fn the_bake_cuts_where_the_texture_chains_take_coverage() {
    let cut = |m| coverage_cut(&m).map(|(c, _)| c);
    assert_eq!(
        cut(json!({"alphaMode": "MASK", "alphaCutoff": 0.3})),
        Some(0.3)
    );
    assert_eq!(cut(json!({"alphaMode": "BLEND"})), Some(0.5));
    assert_eq!(cut(json!({"alphaMode": "MASK", "alphaCutoff": 0.0})), None);
    let glass = json!({"alphaMode": "BLEND",
        "extensions": {"KHR_materials_transmission": {"transmissionFactor": 1.0}}});
    assert_eq!(cut(glass), None);
    assert_eq!(cut(json!({})), None);
}

// Behaviour: a texture's `KHR_texture_transform` moves the coordinates the bake samples at, and
// names the set it reads.
#[test]
fn a_texture_transform_moves_the_sampled_coordinates() {
    let g = json!({"materials": [{"pbrMetallicRoughness": {"baseColorTexture": {"index": 0,
        "extensions": {"KHR_texture_transform": {"offset": [0.5, 0.25], "scale": [2.0, 4.0],
            "rotation": std::f64::consts::FRAC_PI_2, "texCoord": 1}}}}}]});
    let surface = Surface::of(&g, Some(0), &[]);
    assert_eq!(surface.sets[0], 1);
    let [a, b, c, d, e, f] = surface.transforms[0];
    let at = |u: f64, v: f64| [a * u + b * v + c, d * u + e * v + f];
    // A quarter turn, then the scale, then the offset: (1, 0) → (0, −1) → (0, −4) → (0.5, −3.75).
    let moved = at(1.0, 0.0);
    assert!(
        (moved[0] - 0.5).abs() < 1e-12 && (moved[1] + 3.75).abs() < 1e-12,
        "{moved:?}"
    );
    assert_eq!(
        Surface::of(&g, None, &[]).transforms[0],
        [1.0, 0.0, 0.0, 0.0, 1.0, 0.0]
    );
}
