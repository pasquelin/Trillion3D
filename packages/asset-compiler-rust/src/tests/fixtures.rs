use super::*;

pub(super) fn cube_fixture() -> (PathBuf, Options) {
    let mut bin = Vec::new();
    for value in [
        0f32, 0., 0., 1., 0., 0., 1., 1., 0., 0., 1., 0., 0., 0., 1., 1., 0., 1., 1., 1., 1., 0.,
        1., 1.,
    ] {
        bin.extend_from_slice(&value.to_le_bytes());
    }
    for value in [
        0u32, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 1, 5, 6, 1, 6,
        2, 0, 3, 7, 0, 7, 4,
    ] {
        bin.extend_from_slice(&value.to_le_bytes());
    }
    let gltf = json!({"asset":{"version":"2.0"},"buffers":[{"uri":"cube.bin","byteLength":bin.len()}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":96},{"buffer":0,"byteOffset":96,"byteLength":144}],"accessors":[{"bufferView":0,"componentType":5126,"type":"VEC3","count":8},{"bufferView":1,"componentType":5125,"type":"SCALAR","count":36}],"meshes":[{"primitives":[{"attributes":{"POSITION":0},"indices":1}]}],"nodes":[{"mesh":0}],"materials":[],"images":[]});
    gltf_fixture("cube", &gltf, &bin, 12)
}
/// Writes `<tag>.gltf`, `<tag>.bin` and the manifest of a one-node scene into a scratch source
/// folder, and returns it with the options every simplified fixture compiles with. The document's
/// only buffer must name `<tag>.bin`.
pub(super) fn gltf_fixture(
    tag: &str,
    gltf: &Value,
    bin: &[u8],
    triangles: usize,
) -> (PathBuf, Options) {
    let root = scratch("fixture", tag);
    let source = root.join("source");
    let cache = root.join("cache");
    fs::create_dir_all(&source).expect("source");
    let gltf_bytes = serde_json::to_vec(gltf).expect("gltf");
    let (gltf_name, bin_name) = (format!("{tag}.gltf"), format!("{tag}.bin"));
    fs::write(source.join(&gltf_name), &gltf_bytes).expect("gltf write");
    fs::write(source.join(&bin_name), bin).expect("bin write");
    fs::write(source.join("manifest.json"),serde_json::to_vec(&json!({"status":"ready","formatVersion":SOURCE_FORMAT_VERSION,"runtime":{"file":gltf_name,"sha256":hash(&gltf_bytes),"sidecars":[{"file":bin_name,"sha256":hash(bin)}],"trianglesAcrossNodes":triangles,"meshNodes":1}})).expect("manifest")).expect("manifest write");
    (root, simplified_options(source, cache))
}
/// The one binary buffer of a glTF fixture being written, with its views and accessors.
#[derive(Default)]
pub(super) struct GltfBuffer {
    pub(super) bin: Vec<u8>,
    pub(super) views: Vec<Value>,
    pub(super) accessors: Vec<Value>,
}
impl GltfBuffer {
    /// Appends `bytes` as a view of their own and `accessor` over it; returns the accessor index.
    pub(super) fn push(&mut self, bytes: Vec<u8>, mut accessor: Value) -> usize {
        let view = json!({"buffer":0,"byteOffset":self.bin.len(),"byteLength":bytes.len()});
        self.views.push(view);
        self.bin.extend(bytes);
        accessor["bufferView"] = json!(self.views.len() - 1);
        self.accessors.push(accessor);
        self.accessors.len() - 1
    }
}
/// The options both fixtures compile with: simplification on, the BC family cooked.
fn simplified_options(source: PathBuf, cache: PathBuf) -> Options {
    Options {
        source,
        cache,
        resource_base: "/assets/".into(),
        scope: "full".into(),
        triangle_budget: 150000,
        threads: 1,
        ram_budget_mb: 64,
        simplification: "qem-endpoints".into(),
        texture_formats: vec![crate::texture_preview::BlockFormat::Bc7],
        cancelled: Arc::new(AtomicBool::new(false)),
    }
}
const HALF_PI: f32 = std::f32::consts::FRAC_PI_2;

/// A sine built from additions, multiplications and divisions only (Bhaskara's approximation), so
/// the fixture's vertices are bit-identical on every platform. `f32::sin` is not: each libm rounds
/// differently at the last bit, and a greedy DAG build turns that bit into a different root count.
pub(super) fn portable_sin(t: f32) -> f32 {
    let tau = std::f32::consts::TAU;
    let x = t.rem_euclid(tau);
    let (x, sign) = if x > std::f32::consts::PI {
        (x - std::f32::consts::PI, -1.0)
    } else {
        (x, 1.0)
    };
    let a = x * (std::f32::consts::PI - x);
    sign * 16.0 * a / (5.0 * std::f32::consts::PI * std::f32::consts::PI - 4.0 * a)
}

/// Two triangles per quad of an `nx × ny` grid, corners named by `vertex(x, y)`: the one
/// quad split every grid fixture of the crate shares.
pub(crate) fn grid_indices(nx: usize, ny: usize, vertex: impl Fn(usize, usize) -> u32) -> Vec<u32> {
    let mut indices = Vec::with_capacity(nx * ny * 6);
    for y in 0..ny {
        for x in 0..nx {
            let (a, b, c, d) = (
                vertex(x, y),
                vertex(x + 1, y),
                vertex(x, y + 1),
                vertex(x + 1, y + 1),
            );
            indices.extend([a, b, c, b, d, c]);
        }
    }
    indices
}

pub(super) fn grid_fixture_displaced(nx: usize, ny: usize, amplitude: f32) -> (PathBuf, Options) {
    let mut positions = Vec::new();
    for y in 0..=ny {
        for x in 0..=nx {
            positions.extend([
                x as f32,
                y as f32,
                portable_sin(x as f32 * 0.31) * portable_sin(y as f32 * 0.27 + HALF_PI) * amplitude,
            ]);
        }
    }
    let indices = grid_indices(nx, ny, |x, y| (y * (nx + 1) + x) as u32);
    let mut bin = Vec::new();
    for value in &positions {
        bin.extend_from_slice(&value.to_le_bytes());
    }
    for value in &indices {
        bin.extend_from_slice(&value.to_le_bytes());
    }
    let pos_bytes = positions.len() * 4;
    let index_bytes = indices.len() * 4;
    let gltf = json!({"asset":{"version":"2.0"},"buffers":[{"uri":"grid.bin","byteLength":bin.len()}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":pos_bytes},{"buffer":0,"byteOffset":pos_bytes,"byteLength":index_bytes}],"accessors":[{"bufferView":0,"componentType":5126,"type":"VEC3","count":positions.len()/3},{"bufferView":1,"componentType":5125,"type":"SCALAR","count":indices.len()}],"meshes":[{"primitives":[{"attributes":{"POSITION":0},"indices":1}]}],"nodes":[{"mesh":0}],"materials":[],"images":[]});
    gltf_fixture("grid", &gltf, &bin, indices.len() / 3)
}
pub(super) fn encode_glb(gltf: &Value, bin: &[u8]) -> Vec<u8> {
    let mut json = serde_json::to_vec(gltf).expect("json");
    while !json.len().is_multiple_of(4) {
        json.push(b' ');
    }
    let mut blob = bin.to_vec();
    while !blob.len().is_multiple_of(4) {
        blob.push(0);
    }
    let total = 12 + 8 + json.len() + 8 + blob.len();
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(&0x46546C67u32.to_le_bytes());
    out.extend_from_slice(&2u32.to_le_bytes());
    out.extend_from_slice(&(total as u32).to_le_bytes());
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(&0x4E4F534Au32.to_le_bytes());
    out.extend_from_slice(&json);
    out.extend_from_slice(&(blob.len() as u32).to_le_bytes());
    out.extend_from_slice(&0x004E4942u32.to_le_bytes());
    out.extend_from_slice(&blob);
    out
}
pub(super) fn obj_fixture(name: &str, mtl: bool) -> (PathBuf, Options) {
    let (root, mut options) = fixture();
    let source = root.join("obj");
    fs::create_dir_all(&source).expect("obj dir");
    let mut obj = String::from(
        "v 0 0 0\nv 1 0 0\nv 0 1 0\nv 1 1 0\nvn 0 0 1\nvt 0 0\nvt 1 0\nvt 0 1\nvt 1 1\n",
    );
    if mtl {
        obj.push_str("mtllib quad.mtl\nusemtl painted\n");
        fs::write(
            source.join("quad.mtl"),
            "newmtl painted\nKd 0.2 0.4 0.6\nd 0.5\nmap_Kd textures/paint.png\n",
        )
        .expect("mtl");
        fs::create_dir_all(source.join("textures")).expect("textures");
        fs::write(
            source.join("textures/paint.png"),
            b"\x89PNG\r\n\x1a\nnot-a-real-png",
        )
        .expect("png");
    }
    obj.push_str("f 1/1/1 2/2/1 4/4/1 3/3/1\n");
    fs::write(source.join(name), obj).expect("obj write");
    options.source = source.join(name);
    options.scope = "full".into();
    options.triangle_budget = 150000;
    (root, options)
}

/// The two slopes of a symmetric roof, of length one: the flat normal of each of its faces,
/// shared by every driver test that reads smoothing off such a roof.
pub(crate) const ROOF_LEFT: [f32; 3] = [
    -std::f32::consts::FRAC_1_SQRT_2,
    0.0,
    std::f32::consts::FRAC_1_SQRT_2,
];
pub(crate) const ROOF_RIGHT: [f32; 3] = [
    std::f32::consts::FRAC_1_SQRT_2,
    0.0,
    std::f32::consts::FRAC_1_SQRT_2,
];
