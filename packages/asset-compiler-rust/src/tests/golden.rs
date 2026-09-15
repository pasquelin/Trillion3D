//! Harnais commun des fixtures dorées : compiler une scène livrée avec le paquet dans un cache
//! jetable, puis relire tout ce qu'un doré compare — la sortie de `compile`, le manifeste mince et
//! le sidecar binaire. Chaque famille de dorées y ajoute son propre condensé, jamais son propre
//! harnais : deux façons de compiler une fixture, ce sont deux vérités.
use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

/// Une fixture dorée compilée. Le cache jetable s'efface avec la structure, y compris quand
/// l'assertion qui suit échoue et emporte le test.
pub(super) struct GoldenRun {
    pub result: Value,
    pub slim: Value,
    pub binary: Vec<u8>,
    /// Le cache jetable : c'est là qu'un pilote a laissé la scène intermédiaire qu'il a écrite.
    cache: PathBuf,
    root: PathBuf,
}
impl Drop for GoldenRun {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// Le dossier d'une fixture dorée, nommé par son chemin sous `fixtures/`.
pub(super) fn golden_dir(relative: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join(relative)
}

/// Compile `<dir>/<name>.gltf`, aux mêmes options pour toutes les dorées : un seul fil et aucune
/// simplification, pour que la sortie ne dépende que de la scène.
pub(super) fn compile_golden(dir: &Path, name: &str) -> GoldenRun {
    compile_golden_source(&dir.join(format!("{name}.gltf")), name)
}

/// La même chose pour une source d'un autre format : le pilote que le routeur choisit produit la
/// scène intermédiaire, et le reste du harnais ne change pas.
pub(super) fn compile_golden_source(source: &Path, name: &str) -> GoldenRun {
    let root = std::env::temp_dir().join(format!(
        "wg-golden-{name}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos(),
    ));
    let options = Options {
        source: source.to_path_buf(),
        cache: root.join("cache"),
        resource_base: "/assets".into(),
        scope: "full".into(),
        triangle_budget: 1_000_000,
        threads: 1,
        ram_budget_mb: 64,
        simplification: "none".into(),
        cancelled: Arc::new(AtomicBool::new(false)),
    };
    let result = compile(&options, |_| {}).unwrap_or_else(|e| panic!("{name}: compile: {e}"));
    let key = result["key"].as_str().expect("key").to_string();
    let directory = options.cache.join("native").join(&options.scope).join(key);
    let slim =
        serde_json::from_slice(&fs::read(directory.join("clusters.json")).expect("clusters.json"))
            .expect("clusters.json is valid JSON");
    let binary = fs::read(directory.join(MANIFEST_BINARY_FILE)).expect("clusters.bin");
    GoldenRun {
        result,
        slim,
        binary,
        cache: options.cache,
        root,
    }
}

impl GoldenRun {
    /// La scène intermédiaire qu'un pilote nommé a écrite dans le cache : son manifeste et son
    /// glTF. C'est ce que la dorée d'un pilote compare, avant que le compilateur ne la découpe.
    pub(super) fn prepared(&self, plugin: &str) -> (Value, Value) {
        let imports = self.cache.join("native").join("imports");
        let entries = fs::read_dir(&imports).expect("imports directory");
        for entry in entries.flatten() {
            let manifest: Value = match fs::read(entry.path().join("manifest.json"))
                .map(|bytes| serde_json::from_slice(&bytes).expect("manifest.json is valid JSON"))
            {
                Ok(manifest) => manifest,
                Err(_) => continue,
            };
            if manifest
                .pointer("/source/plugin/name")
                .and_then(Value::as_str)
                != Some(plugin)
            {
                continue;
            }
            let gltf = fs::read(entry.path().join("model.gltf")).expect("model.gltf");
            return (
                manifest,
                serde_json::from_slice(&gltf).expect("model.gltf is valid JSON"),
            );
        }
        panic!("aucune scène intermédiaire écrite par le pilote {plugin}");
    }
}

/// L'attendu versionné d'une fixture, sans les deux champs qui ne sont que de la prose.
pub(super) fn golden_expected(dir: &Path) -> Value {
    let mut expected: Value =
        serde_json::from_slice(&fs::read(dir.join("expected.json")).expect("expected.json"))
            .expect("expected.json is not valid JSON");
    if let Some(object) = expected.as_object_mut() {
        object.remove("case");
        object.remove("rule");
    }
    expected
}
