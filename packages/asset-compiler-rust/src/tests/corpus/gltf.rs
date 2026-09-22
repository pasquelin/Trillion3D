//! The case as a glTF document in a scratch folder: one buffer, one view per accessor, one
//! primitive per material, the encodings the case asks for.
use super::*;

pub(super) struct Written {
    pub root: PathBuf,
    pub options: Options,
    pub bin: Vec<u8>,
    /// Offset and length of every view, in the order the document declares them.
    pub views: Vec<(usize, usize)>,
}
/// The scratch tree goes with the document that wrote it, whether the case passes or panics.
impl Drop for Written {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[derive(Default)]
struct Buffer {
    bin: Vec<u8>,
    views: Vec<Value>,
    ranges: Vec<(usize, usize)>,
    accessors: Vec<Value>,
}
impl Buffer {
    /// Appends a view, four-aligned, and returns its index.
    fn view(&mut self, bytes: &[u8], stride: Option<usize>) -> usize {
        while !self.bin.len().is_multiple_of(4) {
            self.bin.push(0);
        }
        let offset = self.bin.len();
        self.bin.extend_from_slice(bytes);
        let mut view = json!({"buffer":0,"byteOffset":offset,"byteLength":bytes.len()});
        if let Some(stride) = stride {
            view["byteStride"] = json!(stride);
        }
        self.views.push(view);
        self.ranges.push((offset, bytes.len()));
        self.views.len() - 1
    }
    /// A float accessor over its own view.
    fn floats(&mut self, values: &[f32], kind: &str, width: usize) -> usize {
        let bytes: Vec<u8> = values.iter().flat_map(|v| v.to_le_bytes()).collect();
        let view = self.view(&bytes, None);
        self.accessor(
            json!({"bufferView":view,"componentType":5126,"type":kind,"count":values.len()/width}),
        )
    }
    fn accessor(&mut self, accessor: Value) -> usize {
        self.accessors.push(accessor);
        self.accessors.len() - 1
    }
}

/// `POSITION` as normalised `SHORT`, three per vertex padded to a four-aligned stride.
fn quantized(buffer: &mut Buffer, positions: &[f32]) -> usize {
    let mut bytes = Vec::with_capacity(positions.len() / 3 * 8);
    for vertex in positions.chunks(3) {
        for value in vertex {
            bytes.extend(((value * 32767.0).round() as i16).to_le_bytes());
        }
        bytes.extend([0, 0]);
    }
    let view = buffer.view(&bytes, Some(8));
    buffer.accessor(json!({"bufferView":view,"componentType":5122,"normalized":true,"type":"VEC3","count":positions.len()/3}))
}

/// `POSITION` as a sparse accessor: every fourth vertex is zero in the base and restored sparsely.
fn sparse(buffer: &mut Buffer, positions: &[f32]) -> usize {
    let count = positions.len() / 3;
    let (mut base, mut indices, mut values) = (positions.to_vec(), Vec::new(), Vec::new());
    for vertex in (0..count).step_by(4) {
        base[vertex * 3..vertex * 3 + 3].fill(0.0);
        indices.push(vertex as u32);
        values.extend_from_slice(&positions[vertex * 3..vertex * 3 + 3]);
    }
    let accessor = buffer.floats(&base, "VEC3", 3);
    let index_bytes: Vec<u8> = indices.iter().flat_map(|i| i.to_le_bytes()).collect();
    let index_view = buffer.view(&index_bytes, None);
    let value_bytes: Vec<u8> = values.iter().flat_map(|v| v.to_le_bytes()).collect();
    let value_view = buffer.view(&value_bytes, None);
    buffer.accessors[accessor]["sparse"] = json!({"count":indices.len(),"indices":{"bufferView":index_view,"componentType":5125},"values":{"bufferView":value_view}});
    accessor
}

fn index_accessor(buffer: &mut Buffer, indices: &[u32], kind: Indices) -> usize {
    let (component, bytes): (u32, Vec<u8>) = match kind {
        Indices::U8 => (5121, indices.iter().map(|&i| i as u8).collect()),
        Indices::U16 => (
            5123,
            indices
                .iter()
                .flat_map(|&i| (i as u16).to_le_bytes())
                .collect(),
        ),
        _ => (5125, indices.iter().flat_map(|i| i.to_le_bytes()).collect()),
    };
    let view = buffer.view(&bytes, None);
    buffer.accessor(
        json!({"bufferView":view,"componentType":component,"type":"SCALAR","count":indices.len()}),
    )
}

pub(super) fn write(case: &Case) -> Written {
    let mut buffer = Buffer::default();
    let mut attributes = serde_json::Map::new();
    let position = if case.quantized_positions {
        quantized(&mut buffer, &case.positions)
    } else if case.sparse_positions {
        sparse(&mut buffer, &case.positions)
    } else {
        buffer.floats(&case.positions, "VEC3", 3)
    };
    attributes.insert("POSITION".into(), json!(position));
    let named = [
        ("NORMAL", "VEC3", 3, &case.normals),
        ("TEXCOORD_0", "VEC2", 2, &case.uv0),
        ("TEXCOORD_1", "VEC2", 2, &case.uv1),
        ("TANGENT", "VEC4", 4, &case.tangents),
    ];
    for (name, kind, width, values) in named {
        if let Some(values) = values {
            let accessor = buffer.floats(values, kind, width);
            attributes.insert(name.into(), json!(accessor));
        }
    }
    if let Some((width, values)) = &case.colours {
        let kind = if *width == 3 { "VEC3" } else { "VEC4" };
        let accessor = buffer.floats(values, kind, *width);
        attributes.insert("COLOR_0".into(), json!(accessor));
    }
    let mut primitives = Vec::new();
    for (slot, indices) in case.primitives().iter().enumerate() {
        let mut primitive = json!({"attributes":attributes});
        if case.index_kind != Indices::Unindexed {
            primitive["indices"] = json!(index_accessor(&mut buffer, indices, case.index_kind));
        }
        if !case.materials.is_empty() {
            primitive["material"] = json!(slot);
        }
        primitives.push(primitive);
    }
    let materials: Vec<Value> = case
        .materials
        .iter()
        .map(|m| json!({"alphaMode":m.alpha_mode,"doubleSided":m.double_sided}))
        .collect();
    let mut gltf = json!({"asset":{"version":"2.0"},"buffers":[{"uri":format!("{}.bin",case.name),"byteLength":buffer.bin.len()}],"bufferViews":buffer.views,"accessors":buffer.accessors,"meshes":[{"primitives":primitives}],"nodes":[{"mesh":0}],"materials":materials,"images":[]});
    if case.quantized_positions {
        gltf["extensionsUsed"] = json!(["KHR_mesh_quantization"]);
        gltf["extensionsRequired"] = json!(["KHR_mesh_quantization"]);
    }
    let (root, options) = gltf_fixture(case.name, &gltf, &buffer.bin, case.indices.len() / 3);
    Written {
        root,
        options,
        bin: buffer.bin,
        views: buffer.ranges,
    }
}
