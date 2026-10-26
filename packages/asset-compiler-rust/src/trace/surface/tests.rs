mod materials;

use super::Traceable;
use crate::displace::Baked;
use serde_json::json;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::FLAG_UV;

// Behaviour: a primitive whose displacement was baked into its triangles is traced from the baked
// mesh — the triangles its build holds, which the voxels' ranks index —, the others as declared.
#[test]
fn a_baked_primitive_is_traced_from_the_baked_mesh() {
    let g = json!({"asset":{"version":"2.0"},"buffers":[{"byteLength":36}],
        "bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":36}],
        "accessors":[{"bufferView":0,"componentType":5126,"type":"VEC3","count":3}],
        "meshes":[{"primitives":[{"attributes":{"POSITION":0}}]}]});
    let declared = [0.0f32, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    let bin: Vec<u8> = declared.iter().flat_map(|x| x.to_le_bytes()).collect();
    let plain = Traceable::read(&g, &bin, 0, &[]).expect("read");
    assert_eq!(plain.world.tags.len(), 1);
    let baked = Baked {
        positions: vec![0.0, 0.0, 0.5, 1.0, 0.0, 0.5, 1.0, 1.0, 0.5, 0.0, 1.0, 0.5],
        attributes: vec![Attribute {
            flag: FLAG_UV,
            width: 2,
            values: vec![0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0],
        }],
        indices: vec![0, 1, 2, 0, 2, 3],
    };
    let traced = Traceable::read_with(&g, &bin, 0, &[], &[(0, &baked)]).expect("read");
    assert_eq!(traced.world.tags.len(), 2);
    assert_eq!(traced.primitives, vec![(0, 0..2)]);
    let second = &traced.world.triangles[9..18];
    assert_eq!(
        second.to_vec(),
        vec![0.0, 0.0, 0.5, 1.0, 1.0, 0.5, 0.0, 1.0, 0.5]
    );
    assert_eq!(traced.corners[1].uv[0], [0.0, 0.0, 1.0, 1.0, 0.0, 1.0]);
    assert!(
        traced.corners[1].normals.is_none(),
        "the baked mesh carries none"
    );
}
