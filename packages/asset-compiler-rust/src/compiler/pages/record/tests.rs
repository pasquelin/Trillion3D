use super::*;

#[test]
fn every_gltf_skin_set_reaches_the_codec_without_pruning() {
    let mut bin = Vec::new();
    let (mut views, mut accessors) = (Vec::new(), Vec::new());
    let mut attributes = json!({});
    // Three sets exercises retention beyond the JOINTS_0/1 pair.
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

// Behaviour: a vertex attribute that is not finite is refused naming what it is read as: a normal
// is refused as a normal (`NONFINITE_ATTRIBUTE`), a position as a position (`NONFINITE_POSITION`).
#[test]
fn a_non_finite_normal_is_refused_as_a_normal() {
    let mut bin = Vec::new();
    for value in [0.0f32, 0.0, 1.0, f32::NAN, 0.0, 1.0, 0.0, 0.0, 1.0] {
        bin.extend(value.to_le_bytes());
    }
    let g = json!({
        "buffers": [{"byteLength": bin.len()}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": bin.len()}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"}],
    });
    let valid: BTreeSet<usize> = BTreeSet::from([0]);
    let primitive = json!({"attributes": {"NORMAL": 0}});
    let source = PageSource {
        count: 3,
        stored_tangents: false,
        made_normals: false,
        mesh_tangents: false,
    };
    let refused = page_attributes(&g, &bin, &primitive, source, &valid)
        .expect_err("a normal that is not a number");
    assert_eq!(refused.code, "NONFINITE_ATTRIBUTE");
    assert!(refused.message.starts_with("NORMAL"), "{}", refused.message);
}

// Behaviour: a page records the first source corner its cluster descends from; a cluster that
// descends from no triangle of the source — the root of an assembly's instance, the levels above
// instances alone — has none to record: its record omits `start`, which the manifest reads as -1
// and a runtime reads as the page's own rank, rather than a rank past a 32-bit integer.
#[test]
fn a_cluster_that_descends_from_no_source_triangle_records_no_start() {
    let cluster = |rank| DagCluster::leaf(vec![0, 1, 2], 0.0, [0.0; 4], rank);
    let bounds = ([0.0; 3], [1.0; 3]);
    let own = page_record((0, &cluster(7)), bounds, json!({}));
    assert_eq!(own["start"], 21);
    let none = page_record((1, &cluster(NO_SOURCE_RANK)), bounds, json!({}));
    assert!(none.get("start").is_none(), "{none}");
}
