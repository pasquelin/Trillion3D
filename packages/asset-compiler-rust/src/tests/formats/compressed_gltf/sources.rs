use super::*;
use draco_core::{DecoderBuffer, FaceIndex, Mesh, MeshDecoder, PointIndex};
type SourcePair = ((Value, Vec<u8>), (Value, Vec<u8>));

pub(super) fn meshopt() -> SourcePair {
    let vertices = [[0f32, 0., 0.], [1., 0., 0.], [0., 1., 0.]];
    let indices = [0u32, 1, 2];
    let mut raw: Vec<u8> = vertices
        .iter()
        .flatten()
        .flat_map(|v| v.to_le_bytes())
        .collect();
    raw.extend(indices.iter().flat_map(|v| v.to_le_bytes()));
    let plain = json!({"asset":{"version":"2.0"},"scenes":[{"nodes":[0]}],"scene":0,
        "nodes":[{"mesh":0}],"meshes":[{"primitives":[{"attributes":{"POSITION":0},"indices":1}]}],
        "buffers":[{"byteLength":48}],"bufferViews":[{"buffer":0,"byteLength":36},{"buffer":0,"byteOffset":36,"byteLength":12}],
        "accessors":[{"bufferView":0,"componentType":5126,"type":"VEC3","count":3,"min":[0,0,0],"max":[1,1,0]},
            {"bufferView":1,"componentType":5125,"type":"SCALAR","count":3}]});
    let mut encoded = meshopt::encode_vertex_buffer(&vertices).unwrap();
    let vertex_bytes = encoded.len();
    encoded.extend(meshopt::encode_index_buffer(&indices, 3).unwrap());
    let mut compressed = plain.clone();
    compressed["extensionsRequired"] = json!(["EXT_meshopt_compression"]);
    compressed["extensionsUsed"] = compressed["extensionsRequired"].clone();
    compressed["buffers"] = json!([{"byteLength":encoded.len()},{"byteLength":48}]);
    for (id, stride, mode, start, length) in [
        (0, 12, "ATTRIBUTES", 0, vertex_bytes),
        (
            1,
            4,
            "TRIANGLES",
            vertex_bytes,
            encoded.len() - vertex_bytes,
        ),
    ] {
        compressed["bufferViews"][id]["buffer"] = json!(1);
        compressed["bufferViews"][id]["extensions"] = json!({"EXT_meshopt_compression":{
            "buffer":0,"byteOffset":start,"byteLength":length,"byteStride":stride,"count":3,"mode":mode}});
    }
    ((plain, raw), (compressed, encoded))
}

pub(super) fn draco() -> SourcePair {
    let dir = golden_dir("gltf/compressed-box");
    let compressed: Value =
        serde_json::from_slice(&fs::read(dir.join("Box.gltf")).unwrap()).unwrap();
    let encoded = fs::read(dir.join("Box.bin")).unwrap();
    let mut mesh = Mesh::new();
    MeshDecoder::new()
        .decode(&mut DecoderBuffer::new(&encoded[..118]), &mut mesh)
        .unwrap();
    // Build ordinary accessors directly from the upstream codec, not from the
    // normalization under test. Its known box positions/normals are tested separately.
    let mut raw = Vec::new();
    for face in 0..mesh.num_faces() {
        for point in mesh.face(FaceIndex(face as u32)) {
            raw.extend_from_slice(&point.0.to_le_bytes());
        }
    }
    let mut views = vec![json!({"buffer":0,"byteOffset":0,"byteLength":raw.len()})];
    for id in [0, 1] {
        let attribute = mesh.attribute_by_unique_id(id).unwrap();
        assert_eq!(attribute.data_type(), draco_core::DataType::Float32);
        assert_eq!(attribute.num_components(), 3);
        let offset = raw.len();
        for point in 0..mesh.num_points() {
            let entry = attribute.mapped_index(PointIndex(point as u32)).0 as usize;
            let start = entry * attribute.byte_stride() as usize;
            raw.extend_from_slice(&attribute.buffer().data()[start..start + 12]);
        }
        views.push(json!({"buffer":0,"byteOffset":offset,"byteLength":raw.len()-offset}));
    }
    let mut plain = compressed.clone();
    plain.as_object_mut().unwrap().remove("extensionsRequired");
    plain.as_object_mut().unwrap().remove("extensionsUsed");
    plain["meshes"][0]["primitives"][0]
        .as_object_mut()
        .unwrap()
        .remove("extensions");
    plain["buffers"] = json!([{"byteLength":raw.len()}]);
    plain["bufferViews"] = json!(views);
    plain["accessors"][0]["componentType"] = json!(5125);
    for id in 0..3 {
        plain["accessors"][id]["bufferView"] = json!(id);
    }
    ((plain, raw), (compressed, encoded))
}
