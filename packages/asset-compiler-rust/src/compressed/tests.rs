use super::*;

fn budget(cancelled: &AtomicBool) -> Budget<'_> {
    Budget {
        limit: 16 * 1024 * 1024,
        cancelled,
    }
}
pub(super) fn box_source() -> (Value, Binary) {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/formats/gltf/compressed-box");
    let g = serde_json::from_slice(&fs::read(root.join("Box.gltf")).unwrap()).unwrap();
    (g, Binary::Owned(fs::read(root.join("Box.bin")).unwrap()))
}
#[test]
fn draco_reference_box_reaches_existing_accessors() {
    let (mut g, binary) = box_source();
    let materials = g["materials"].clone();
    let cancelled = AtomicBool::new(false);
    let binary = draco_primitives(&mut g, binary, &budget(&cancelled)).unwrap();
    let p = &g["meshes"][0]["primitives"][0];
    let positions = accessor(
        &g,
        binary.bytes(),
        p["attributes"]["POSITION"].as_u64().unwrap() as usize,
        None,
    )
    .unwrap();
    let normals = accessor(
        &g,
        binary.bytes(),
        p["attributes"]["NORMAL"].as_u64().unwrap() as usize,
        None,
    )
    .unwrap();
    let indices = accessor(
        &g,
        binary.bytes(),
        p["indices"].as_u64().unwrap() as usize,
        None,
    )
    .unwrap();
    assert_eq!(positions.count, 24);
    assert_eq!(indices.count, 36);
    for vertex in 0..positions.count {
        for axis in 0..3 {
            assert!((positions.value(vertex, axis).unwrap().abs() - 0.5).abs() < 0.001);
        }
        let length: f64 = (0..3)
            .map(|axis| normals.value(vertex, axis).unwrap().powi(2))
            .sum();
        assert!((length - 1.).abs() < 0.02);
    }
    for face in 0..12 {
        let ids: Vec<_> = (0..3)
            .map(|i| indices.u32_at(face * 3 + i).unwrap())
            .collect();
        assert!(ids.iter().all(|&i| i < 24));
        assert!(ids[0] != ids[1] && ids[1] != ids[2] && ids[2] != ids[0]);
    }
    assert_eq!(g["materials"], materials);
    assert!(!g["extensionsRequired"]
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v == DRACO));
}
#[test]
fn draco_rejects_corruption_budget_and_cancellation() {
    let cancelled = AtomicBool::new(false);
    let (mut g, _) = box_source();
    assert!(draco_primitives(&mut g, Binary::Owned(vec![0; 120]), &budget(&cancelled)).is_err());
    let (mut g, bytes) = box_source();
    assert!(draco_primitives(
        &mut g,
        bytes,
        &Budget {
            limit: 1,
            cancelled: &cancelled
        }
    )
    .is_err());
    cancelled.store(true, Ordering::Relaxed);
    let (mut g, bytes) = box_source();
    assert!(draco_primitives(&mut g, bytes, &budget(&cancelled)).is_err());
}
pub(super) fn meshopt_source(
    bytes: Vec<u8>,
    count: usize,
    stride: usize,
    mode: &str,
) -> (Value, Binary) {
    let g = json!({"buffers":[{"uri":"encoded.bin","byteLength":bytes.len()},{"byteLength":count*stride}],
        "bufferViews":[{"buffer":1,"byteLength":count*stride,"extensions":{MESHOPT:{"buffer":0,"byteLength":bytes.len(),"byteStride":stride,"count":count,"mode":mode}}}]});
    (g, Binary::Owned(bytes))
}
#[test]
fn meshopt_decodes_vertex_and_triangle_streams_without_fallback() {
    let vertices = [[0f32, 0., 0.], [1., 0., 0.], [0., 1., 0.]];
    let encoded = ::meshopt::encode_vertex_buffer(&vertices).unwrap();
    let cancelled = AtomicBool::new(false);
    let (mut g, binary) = meshopt_source(encoded, 3, 12, "ATTRIBUTES");
    assert!(placeholder(&g, 1));
    let mut offsets = vec![0, binary.bytes().len()];
    let out = meshopt_views(&mut g, binary, &mut offsets, &budget(&cancelled)).unwrap();
    flatten_buffer_views(&mut g, &offsets, out.bytes().len()).unwrap();
    let start = g["bufferViews"][0]["byteOffset"].as_u64().unwrap() as usize;
    let expected: Vec<_> = vertices
        .iter()
        .flatten()
        .flat_map(|v| v.to_le_bytes())
        .collect();
    assert_eq!(&out.bytes()[start..start + 36], expected);
    let encoded = ::meshopt::encode_index_buffer(&[0, 1, 2], 3).unwrap();
    let (mut g, binary) = meshopt_source(encoded, 3, 2, "TRIANGLES");
    let mut offsets = vec![0, binary.bytes().len()];
    let out = meshopt_views(&mut g, binary, &mut offsets, &budget(&cancelled)).unwrap();
    flatten_buffer_views(&mut g, &offsets, out.bytes().len()).unwrap();
    let start = g["bufferViews"][0]["byteOffset"].as_u64().unwrap() as usize;
    assert_eq!(&out.bytes()[start..start + 6], &[0, 0, 1, 0, 2, 0]);
}
#[test]
fn meshopt_rejects_invalid_layout_and_stream() {
    let cancelled = AtomicBool::new(false);
    for (count, stride, mode) in [
        (1, 3, "ATTRIBUTES"),
        (4, 2, "TRIANGLES"),
        (3, 4, "UNKNOWN"),
        (3, 4, "INDICES"),
    ] {
        let (mut g, binary) = meshopt_source(vec![0; 16], count, stride, mode);
        assert!(meshopt_views(&mut g, binary, &mut vec![0, 16], &budget(&cancelled)).is_err());
    }
}

pub(super) fn expand_meshopt(mut g: Value, binary: Binary) -> (Value, Binary) {
    let cancelled = AtomicBool::new(false);
    let mut offsets = vec![0, usize::MAX];
    let out = meshopt_views(&mut g, binary, &mut offsets, &budget(&cancelled)).unwrap();
    flatten_buffer_views(&mut g, &offsets, out.bytes().len()).unwrap();
    (g, out)
}
#[test]
fn draco_rejects_inconsistent_attribute_and_topology_metadata() {
    let cancelled = AtomicBool::new(false);
    for change in 0..3 {
        let (mut g, bytes) = box_source();
        match change {
            0 => g["accessors"][2]["count"] = json!(25),
            1 => g["accessors"][0]["count"] = json!(39),
            _ => {
                g["meshes"][0]["primitives"][0]["extensions"][DRACO]["attributes"]["POSITION"] =
                    json!(99)
            }
        }
        assert!(draco_primitives(&mut g, bytes, &budget(&cancelled)).is_err());
    }
}
#[test]
fn meshopt_admission_and_cancellation_precede_decode() {
    let cancelled = AtomicBool::new(false);
    for (limit, cancel, expected) in [
        (1, false, "RAM_ADMISSION_BUDGET_EXCEEDED"),
        (4096, true, "CANCELLED"),
    ] {
        let (mut g, binary) = meshopt_source(vec![0; 16], 3, 12, "ATTRIBUTES");
        cancelled.store(cancel, Ordering::Relaxed);
        let error = meshopt_views(
            &mut g,
            binary,
            &mut vec![0, usize::MAX],
            &Budget {
                limit,
                cancelled: &cancelled,
            },
        )
        .err()
        .unwrap();
        assert_eq!(error.code, expected);
    }
}
