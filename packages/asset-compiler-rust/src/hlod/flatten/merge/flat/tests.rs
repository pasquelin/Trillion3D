//! The coordinates a merged layer's meshes are laid at (`laid_of`): all together where the layer
//! asks, each mesh's own where it does not or where the whole cannot be laid out.
use super::*;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::FLAG_UV;

/// The coordinates of the one triangle of `flat_part`.
const OWN: [[f64; 2]; 3] = [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]];

/// A part of mesh 0 made of one triangle of no area, on three points in a line, wearing `OWN`.
fn flat_part() -> Part {
    let uvs = OWN.iter().flatten().map(|&x| x as f32).collect();
    let first = Attribute {
        flag: FLAG_UV,
        width: 2,
        values: uvs,
    };
    let positions = vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 2.0, 0.0, 0.0];
    Part {
        material: None,
        mesh: 0,
        mirrored: false,
        geometry: (positions, vec![first], vec![0, 1, 2]),
    }
}

/// The coordinates entry 0 of `flat_part` is laid at, as `laid_of` chooses them for `at`, and
/// whether they are the entries' together.
fn laid_for(at: (bool, HlodUvMethod, usize)) -> (Vec<[[f64; 2]; 3]>, bool) {
    let part = flat_part();
    let ground = Ground::Mesh(0, false);
    let laid = laid_of(&[&part], (&[ground], &[(None, ground, 0)]), at);
    let together = matches!(laid, Laid::PerEntry(_));
    (laid.of_entry(0, 0, false).iter().collect(), together)
}

#[test]
fn a_layer_laying_its_meshes_out_together_lays_each_mesh_out_alone_where_the_whole_fails() {
    // The spectral charts have nothing to cut in one triangle of no area: the whole fails, and the
    // mesh keeps the coordinates of its own unwrap, which fails for it too — its own first set.
    let (set, together) = laid_for((true, HlodUvMethod::UvAtlas, 256));
    assert!(!together);
    assert_eq!(set, [OWN]);
    // A layer that does not lay out together never does, and takes the mesh's own unwrap.
    let (set, together) = laid_for((false, HlodUvMethod::UvAtlas, 256));
    assert!(!together);
    assert_eq!(set, [OWN]);
}
