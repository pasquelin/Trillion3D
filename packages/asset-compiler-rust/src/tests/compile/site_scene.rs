//! A committed site scene cooked by the compiler's tests, and the source it was cooked from.
use super::*;

/// A committed site scene, cooked.
pub(super) struct SiteScene {
    /// The fixture's folder, removed by the caller.
    pub root: PathBuf,
    /// Where the cooked pages are.
    pub objects: PathBuf,
    /// The source document and its buffer.
    pub gltf: Value,
    pub bin: Vec<u8>,
    /// What the compiler returned.
    pub result: Value,
}

impl SiteScene {
    /// The source attribute `name` of cooked `primitive`, or its indices for `None`.
    fn source(&self, primitive: &Value, name: Option<&str>) -> Accessor<'_> {
        let at = |key: &str| primitive[key].as_u64().expect(key) as usize;
        let written = &self.gltf["meshes"][at("mesh")]["primitives"][at("primitive")];
        let id = name.map_or(&written["indices"], |n| &written["attributes"][n]);
        let id = id.as_u64().expect("accessor") as usize;
        accessor(&self.gltf, &self.bin, id, None).expect("accessor")
    }

    /// The source positions of cooked `primitive`, flat `xyz`.
    pub fn positions(&self, primitive: &Value) -> Vec<f32> {
        let positions = self.source(primitive, Some("POSITION")).collect_f32();
        positions.expect("positions")
    }

    /// The source indices of cooked `primitive`.
    pub fn indices(&self, primitive: &Value) -> Vec<u32> {
        self.source(primitive, None).collect_u32().expect("indices")
    }
}

/// Cooks a committed glTF whose one buffer is `<tag>.bin` and whose images lie beside it, found
/// under `folder` from the repository root, on `simplification`.
pub(super) fn cook_site_scene(
    folder: &str,
    gltf: &str,
    tag: &str,
    simplification: &str,
) -> SiteScene {
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(folder);
    let document: Value =
        serde_json::from_slice(&fs::read(source.join(gltf)).expect("gltf")).expect("json");
    let bin = fs::read(source.join(format!("{tag}.bin"))).expect("bin");
    let (root, mut options) = gltf_fixture(tag, &document, &bin);
    for uri in document["images"].as_array().into_iter().flatten() {
        let uri = uri["uri"].as_str().expect("image uri");
        fs::copy(source.join(uri), options.source.join(uri)).expect("image");
    }
    options.simplification = simplification.into();
    options.texture_formats = Vec::new();
    let result = compile(&options, |_| {}).expect("compile");
    let objects = options.cache.join("native/objects");
    SiteScene {
        root,
        objects,
        gltf: document,
        bin,
        result,
    }
}
