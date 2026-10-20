//! The attribute tables a reduction reads: identical copies.
use super::*;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_COLOR, FLAG_NORMAL};

// Behaviour: copies equal in position and in every carried attribute are one vertex; a copy
// differing by its colour alone stays apart.
#[test]
fn weld_exact_joins_only_copies_a_page_cannot_tell_apart() {
    let positions = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
    let normals = Attribute {
        flag: FLAG_NORMAL,
        width: 3,
        values: [0.0, 0.0, 1.0].repeat(3),
    };
    let colors = Attribute {
        flag: FLAG_COLOR,
        width: 4,
        values: vec![1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.5, 0.5, 0.5, 1.0],
    };
    let weld = clusters::weld_positions(&positions, &[0, 1, 2]);
    let exact = attributes::weld_exact(&weld, &[&normals, &colors], &[0, 1, 2]);
    assert_eq!(exact, vec![0, 0, 2]);
}
