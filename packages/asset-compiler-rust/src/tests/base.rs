use super::*;
pub(super) fn fixture() -> (PathBuf, Options) {
    fixture_named("mesh.gltf", "mesh.bin")
}
pub(super) fn fixture_named(gltf_name: &str, bin_name: &str) -> (PathBuf, Options) {
    let buffer = json!({"uri":bin_name,"byteLength":48});
    let mut gltf = triangle_gltf(buffer, json!([{"mesh":0},{"mesh":0}]));
    gltf["materials"] = json!([]);
    gltf["images"] = json!([]);
    let bin = triangle_bin();
    let (root, source, cache) = write_fixture(gltf_name, (gltf_name, &gltf), (bin_name, &bin));
    let options = Options {
        scope: "slice".into(),
        ..options(source, cache)
    };
    (root, options)
}

/// The manifest of the key folder `directory`, read from its root through its pages.
pub(super) fn paged(directory: &Path) -> crate::compiler::pages::manifest::Paged {
    crate::compiler::pages::manifest::read_manifest_at(directory).expect("the manifest's pages")
}
/// The bytes of the previews' pixel file the head of `manifest` names in `directory`; none when it
/// names none.
pub(super) fn pixel_file(directory: &Path, manifest: &Value) -> Vec<u8> {
    manifest["binary"]["texturePreviewPixels"]["url"]
        .as_str()
        .map_or_else(Vec::new, |url| {
            fs::read(directory.join(url)).expect("the previews' pixel file")
        })
}
/// A number of the JSON record `value`.
fn number(value: &Value, key: &str) -> usize {
    value[key].as_u64().expect(key) as usize
}

/// The bytes of `bundle` once inflated, `stored` being its bytes as the container holds them:
/// inflated when it names `decodedBytes`, a compressed bundle.
pub(super) fn decoded_bundle(stored: &[u8], bundle: &Value) -> Vec<u8> {
    if bundle.get("decodedBytes").is_none() {
        return stored.to_vec();
    }
    let mut bytes = Vec::with_capacity(number(bundle, "decodedBytes"));
    std::io::Read::read_to_end(&mut flate2::read::DeflateDecoder::new(stored), &mut bytes)
        .expect("a raw DEFLATE bundle");
    bytes
}

/// The geometry pages of one primitive of a compile. A page is read from its container and
/// expanded to its resident page ONCE, whoever names it: the vertices a page names are found in the
/// resident pages of the clusters it names them in, each expanded from its own references the same
/// way (the order the pool installs them in), never read and decoded again for each reference.
pub(super) struct PrimitivePages<'a> {
    cache: &'a Path,
    result: &'a Value,
    primitive: &'a Value,
    /// The page of each cluster place: its streaming page and its offset in the pool there, in bytes.
    places: std::collections::HashMap<(usize, usize), &'a Value>,
    /// The containers read, by digest.
    files: std::collections::HashMap<String, Vec<u8>>,
    /// The bundles inflated, by container digest and offset.
    bundles: std::collections::HashMap<(String, usize), Vec<u8>>,
    /// The resident page of each cluster place, once expanded.
    residents: std::collections::HashMap<(usize, usize), Vec<u8>>,
}

impl<'a> PrimitivePages<'a> {
    /// The pages of `primitive` of `result`, whose containers lie under `cache`.
    pub(super) fn new(cache: &'a Path, result: &'a Value, primitive: &'a Value) -> Self {
        let places = (primitive["pages"].as_array().into_iter().flatten())
            .filter_map(|page| {
                let place = page["geometry"]["residentOffset"].as_u64()? as usize;
                Some(((page["stream"].as_u64()? as usize, place), page))
            })
            .collect();
        Self {
            cache,
            result,
            primitive,
            places,
            files: Default::default(),
            bundles: Default::default(),
            residents: Default::default(),
        }
    }

    /// The bytes of `page`'s geometry page: a slice of its bundle, inflated, in the container it
    /// lies in.
    pub(super) fn bytes(&mut self, page: &Value) -> Vec<u8> {
        let (cache, result, primitive) = (self.cache, self.result, self.primitive);
        let bundle = &primitive["streams"]["pages"][number(page, "stream")];
        let digest = result["geometryFiles"][number(bundle, "file")]["sha256"]
            .as_str()
            .expect("file");
        let file = self.files.entry(digest.to_string()).or_insert_with(|| {
            fs::read(objects_dir(cache).join(format!("{digest}.bin"))).expect("geometry file")
        });
        let offset = number(bundle, "offset");
        let decoded = self
            .bundles
            .entry((digest.to_string(), offset))
            .or_insert_with(|| {
                decoded_bundle(&file[offset..offset + number(bundle, "bytes")], bundle)
            });
        let start = number(page, "streamOffset");
        decoded[start..start + number(&page["geometry"], "bytes")].to_vec()
    }

    /// `page` decoded whole (`trillion3d_page_codec::decode_with`): the vertices it names found in
    /// the resident pages of the clusters it names them in.
    pub(super) fn decoded(&mut self, page: &Value) -> trillion3d_page_codec::DecodedPage {
        let bytes = self.bytes(page);
        let named = self.named(page, &bytes);
        let named: Vec<&[u8]> = named.iter().map(Vec::as_slice).collect();
        trillion3d_page_codec::decode_with(&bytes, usize::MAX, &named).expect("a geometry page")
    }

    /// The resident page of each cluster the page `bytes` of `page` names a vertex of, in the order
    /// of its pairs: a pair is the rank of a streaming page in the page's own list of dependencies
    /// (0 for its own) above the words from the start of that streaming page's place in the pool to
    /// the cluster's resident page; a pair that names the page itself has none.
    fn named(&mut self, page: &Value, bytes: &[u8]) -> Vec<Vec<u8>> {
        let primitive = self.primitive;
        let raw =
            trillion3d_page_codec::disk::read_raw(bytes, usize::MAX).expect("a geometry page");
        let own = number(page, "stream");
        let dependencies = primitive["streams"]["pages"][own]["dependencies"]
            .as_array()
            .expect("dependencies");
        named_pages(
            &raw.refs.pairs,
            own,
            |rank| dependencies[rank - 1].as_u64().expect("a bundle") as usize,
            |bundle, place| {
                let target = (self.places.get(&(bundle, place * 4)).copied())
                    .expect("the cluster a pair names");
                self.resident(target)
            },
        )
    }

    /// The resident page of `page`, expanded the first time it is asked for.
    fn resident(&mut self, page: &Value) -> Vec<u8> {
        let key = (
            number(page, "stream"),
            number(&page["geometry"], "residentOffset"),
        );
        if let Some(done) = self.residents.get(&key) {
            return done.clone();
        }
        let bytes = self.bytes(page);
        let named = self.named(page, &bytes);
        let named: Vec<&[u8]> = named.iter().map(Vec::as_slice).collect();
        let resident = trillion3d_page_codec::resident::expand(&bytes, usize::MAX, &named)
            .expect("a resident page");
        self.residents.insert(key, resident.clone());
        resident
    }
}
/// The digests of the geometry containers the manifest in `directory` names.
/// The resident page of each vertex `pairs` name, in their order: a pair is the rank of a bundle in
/// the page's dependencies (`dependency` gives that bundle, 0 being `own`) above the place in the
/// pool (`resident` gives the page there); a pair that names the page itself has none.
pub(crate) fn named_pages(
    pairs: &[u32],
    own: usize,
    dependency: impl Fn(usize) -> usize,
    mut resident: impl FnMut(usize, usize) -> Vec<u8>,
) -> Vec<Vec<u8>> {
    use trillion3d_page_codec::{REF_PLACE_BITS, SELF_PLACE};
    pairs
        .iter()
        .map(|&pair| {
            if pair == SELF_PLACE {
                return Vec::new();
            }
            let (rank, place) = (
                (pair >> REF_PLACE_BITS) as usize,
                (pair & SELF_PLACE) as usize,
            );
            let bundle = match rank {
                0 => own,
                _ => dependency(rank),
            };
            resident(bundle, place)
        })
        .collect()
}

pub(super) fn geometry_files(directory: &Path) -> Vec<String> {
    let manifest = paged(directory).manifest;
    let files = manifest["geometryFiles"]
        .as_array()
        .expect("geometry files");
    files
        .iter()
        .map(|file| file["sha256"].as_str().expect("digest").to_string())
        .collect()
}
/// The fixture's glTF as JSON, for a test that alters it before writing it back.
pub(super) fn read_gltf(options: &Options) -> Value {
    read_json(&options.source.join("mesh.gltf"))
}
/// Writes the altered glTF back and restamps the manifest hashes; `bin` when the sidecar changed too.
pub(super) fn write_gltf(options: &Options, gltf: &Value, bin: Option<&[u8]>) -> Vec<u8> {
    let gltf_bytes = serde_json::to_vec(gltf).expect("encode");
    fs::write(options.source.join("mesh.gltf"), &gltf_bytes).expect("write");
    let manifest_path = options.source.join("manifest.json");
    let mut manifest = read_json(&manifest_path);
    manifest["runtime"]["sha256"] = json!(hash(&gltf_bytes));
    if let Some(bin) = bin {
        manifest["runtime"]["sidecars"][0]["sha256"] = json!(hash(bin));
    }
    let manifest_bytes = serde_json::to_vec(&manifest).expect("encode");
    fs::write(&manifest_path, &manifest_bytes).expect("write");
    manifest_bytes
}
/// The glTF the compiler copied into the cache slice it wrote under `key`.
pub(super) fn written_gltf(options: &Options, key: &str) -> Value {
    read_json(&options.key_directory(key).join("source.gltf"))
}

/// A tiny OBJ, one triangle, one material, and the library it cites, placed in a
/// named folder: that folder is what resolves the library.
pub(super) fn obj_source(root: &Path, folder: &str, mtl: &str) -> PathBuf {
    let source = root.join(folder);
    fs::create_dir_all(&source).expect("obj dir");
    fs::write(
        source.join("scene.obj"),
        "mtllib scene.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 1\nusemtl Uni\nf 1//1 2//1 3//1\n",
    )
    .expect("obj");
    if !mtl.is_empty() {
        fs::write(source.join("scene.mtl"), mtl).expect("mtl");
    }
    source.join("scene.obj")
}

/// Compiles, and returns the result with the intermediate-scene key the driver's progress named.
pub(super) fn compile_with_import_key(options: &Options) -> (Value, String) {
    let keys = std::sync::Mutex::new(Vec::new());
    let result = compile(options, |report| {
        if report["phase"] == "import-source" {
            if let Some(key) = report["key"].as_str() {
                keys.lock().expect("keys").push(key.to_string());
            }
        }
    })
    .expect("compile obj");
    let key = keys.into_inner().expect("keys").pop().expect("a key");
    (result, key)
}

/// Compiles and returns the intermediate-scene key with what import wrote of it.
/// The key is read in the driver's progress: that is what the cache reuses, or not.
pub(super) fn import_key(options: &Options) -> (String, Value, Value) {
    let (_, key) = compile_with_import_key(options);
    let directory = options.cache.join("native").join("imports").join(&key);
    (
        key,
        read_json(&directory.join("model.gltf")),
        read_json(&directory.join("manifest.json")),
    )
}
