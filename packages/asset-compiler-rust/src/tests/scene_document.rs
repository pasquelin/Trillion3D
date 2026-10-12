//! A glTF scene a test generates: one buffer, one view per accessor, meshes of primitives each
//! carrying its own attributes, nodes placing those meshes. The scene tests cook it as they would
//! any source the compiler is handed.
use super::*;

/// The engine's test scenes, each `(folder, glTF, tag)` from the repository root: the document's
/// one buffer is `<tag>.bin`.
pub(crate) const ENGINE_SCENES: [(&str, &str, &str); 2] = [
    (
        "tests/fixtures/scenes/kinetic-garden/source",
        "garden.gltf",
        "garden",
    ),
    (
        "tests/fixtures/scenes/mountain-terrain/source",
        "geometry.gltf",
        "geometry",
    ),
];

/// One primitive's source: flat `xyz` positions and normals, `uv` texture coordinates (empty when
/// it carries none) and its triangles.
#[derive(Default, Clone)]
pub(crate) struct Surface {
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub uvs: Vec<f32>,
    pub indices: Vec<u32>,
}

impl Surface {
    /// Every surface of `parts` in one, each keeping its own vertices.
    pub fn merged<'a>(parts: impl IntoIterator<Item = &'a Surface>) -> Surface {
        let mut out = Surface::default();
        for part in parts {
            let base = (out.positions.len() / 3) as u32;
            out.positions.extend_from_slice(&part.positions);
            out.normals.extend_from_slice(&part.normals);
            out.uvs.extend_from_slice(&part.uvs);
            out.indices.extend(part.indices.iter().map(|i| base + i));
        }
        out
    }

    /// Pushes a quad of four vertices of its own, corners `(position, normal)` turning
    /// counter-clockwise seen from the side the face shows.
    pub fn quad(&mut self, corners: [([f64; 3], [f64; 3]); 4]) {
        let base = (self.positions.len() / 3) as u32;
        for (position, normal) in corners {
            self.positions.extend(position.map(|x| x as f32));
            self.normals.extend(normal.map(|x| x as f32));
        }
        self.indices
            .extend([base, base + 1, base + 2, base, base + 2, base + 3]);
    }
}

/// The document being written, and its one buffer.
#[derive(Default)]
pub(crate) struct SceneDocument {
    bin: Vec<u8>,
    views: Vec<Value>,
    accessors: Vec<Value>,
    meshes: Vec<Value>,
    nodes: Vec<Value>,
    materials: Vec<Value>,
    images: Vec<Value>,
}

impl SceneDocument {
    /// An accessor of `values`, `kind` wide, over a view of its own, four-aligned.
    fn accessor(&mut self, bytes: Vec<u8>, component: u32, kind: &str, count: usize) -> usize {
        let offset = self.bin.len();
        let length = bytes.len();
        self.bin.extend(bytes);
        self.views
            .push(json!({"buffer":0,"byteOffset":offset,"byteLength":length}));
        let view = self.views.len() - 1;
        self.accessors
            .push(json!({"bufferView":view,"componentType":component,"type":kind,"count":count}));
        self.accessors.len() - 1
    }

    fn floats(&mut self, values: &[f32], kind: &str, width: usize) -> usize {
        let bytes = values.iter().flat_map(|v| v.to_le_bytes()).collect();
        self.accessor(bytes, 5126, kind, values.len() / width)
    }

    /// A material of `colour`, its base colour read from the image file `texture` when given.
    pub fn material(&mut self, colour: [f32; 3], texture: Option<&str>) -> usize {
        let mut pbr = json!({"baseColorFactor":[colour[0], colour[1], colour[2], 1.0],"metallicFactor":0.0,"roughnessFactor":0.9});
        if let Some(uri) = texture {
            self.images.push(json!({ "uri": uri }));
            pbr["baseColorTexture"] = json!({"index":self.images.len() - 1});
        }
        self.materials.push(json!({ "pbrMetallicRoughness": pbr }));
        self.materials.len() - 1
    }

    /// A mesh of one primitive per `(surface, material)`; returns its index.
    pub fn mesh(&mut self, primitives: &[(&Surface, usize)]) -> usize {
        let mut written = Vec::new();
        for &(surface, material) in primitives {
            let mut attributes = json!({"POSITION":self.floats(&surface.positions, "VEC3", 3)});
            if !surface.normals.is_empty() {
                attributes["NORMAL"] = json!(self.floats(&surface.normals, "VEC3", 3));
            }
            if !surface.uvs.is_empty() {
                attributes["TEXCOORD_0"] = json!(self.floats(&surface.uvs, "VEC2", 2));
            }
            let bytes = surface.indices.iter().flat_map(|i| i.to_le_bytes());
            let count = surface.indices.len();
            let indices = self.accessor(bytes.collect(), 5125, "SCALAR", count);
            written.push(json!({"attributes":attributes,"indices":indices,"material":material}));
        }
        self.meshes.push(json!({ "primitives": written }));
        self.meshes.len() - 1
    }

    /// A node drawing `mesh` at `translation`.
    pub fn node(&mut self, mesh: usize, translation: [f32; 3]) {
        self.nodes
            .push(json!({"mesh":mesh,"translation":translation}));
    }

    /// The document, whose one buffer is `<tag>.bin`, and that buffer.
    pub fn finish(self, tag: &str) -> (Value, Vec<u8>) {
        let textures: Vec<Value> = (0..self.images.len())
            .map(|source| json!({ "source": source }))
            .collect();
        let nodes: Vec<usize> = (0..self.nodes.len()).collect();
        let gltf = json!({"asset":{"version":"2.0"},"scene":0,"scenes":[{"nodes":nodes}],"nodes":self.nodes,"meshes":self.meshes,"materials":self.materials,"images":self.images,"textures":textures,"accessors":self.accessors,"bufferViews":self.views,"buffers":[{"uri":format!("{tag}.bin"),"byteLength":self.bin.len()}]});
        (gltf, self.bin)
    }
}
