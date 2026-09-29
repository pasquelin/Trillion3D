use super::*;

#[test]
fn every_gltf_skin_set_reaches_the_codec_without_pruning() {
    let mut bin = Vec::new();
    let (mut views, mut accessors) = (Vec::new(), Vec::new());
    let mut attributes = json!({});
    // Three sets exercises retention beyond the formerly supported JOINTS_0/1 pair.
    for set in 0..3 {
        for kind in ["JOINTS", "WEIGHTS"] {
            let start = bin.len();
            for _ in 0..3 {
                for j in 0..4 {
                    if kind == "JOINTS" {
                        bin.extend(((set * 4 + j) as u16).to_le_bytes());
                    } else {
                        bin.extend((1.0f32 / 12.0).to_le_bytes());
                    }
                }
            }
            views.push(json!({"buffer":0,"byteOffset":start,"byteLength":bin.len()-start}));
            accessors.push(json!({"bufferView":views.len()-1,"componentType":if kind == "JOINTS" { 5123 } else { 5126 },"count":3,"type":"VEC4"}));
            attributes[format!("{kind}_{set}")] = json!(accessors.len() - 1);
        }
    }
    let g = json!({"buffers":[{"byteLength":bin.len()}],"bufferViews":views,"accessors":accessors});
    let valid = (0..accessors.len()).collect();
    let source = page_deformation(&g, &bin, &json!({"attributes":attributes}), 3, &valid).unwrap();
    assert_eq!(source.influences, 12);
    let (joints, weights) = source.skin.unwrap();
    assert_eq!(&joints[..12], &(0..12).collect::<Vec<_>>());
    assert_eq!(weights, vec![1.0f32 / 12.0; 36]);
}
