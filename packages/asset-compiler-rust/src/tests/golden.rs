//! Harnais commun des fixtures dorées : compiler une scène livrée avec le paquet dans un cache
//! jetable, puis relire tout ce qu'un doré compare — la sortie de `compile`, le manifeste mince et
//! le sidecar binaire. Chaque famille de dorées y ajoute son propre condensé, jamais son propre
//! harnais : deux façons de compiler une fixture, ce sont deux vérités.
use super::*;
use std::{sync::atomic::AtomicU64, time::SystemTime, time::UNIX_EPOCH};

/// Rang de racine jetable : l'horloge macOS s'arrête à la microseconde, deux dorées parallèles non.
static NEXT: AtomicU64 = AtomicU64::new(0);

/// Une fixture dorée compilée. Le cache jetable s'efface avec la structure, y compris quand
/// l'assertion qui suit échoue et emporte le test.
pub(super) struct GoldenRun {
    pub result: Value,
    pub slim: Value,
    pub binary: Vec<u8>,
    /// Ce que la compilation a publié en chemin : l'étape d'un pilote se prouve dans son rapport.
    pub reports: Vec<Value>,
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

/// Compile `<dir>/<name>.gltf` : la dorée d'une scène livrée telle quelle.
pub(super) fn compile_golden(dir: &Path, name: &str) -> GoldenRun {
    compile_golden_source(&dir.join(format!("{name}.gltf")), name)
}

/// Compile une source quelconque — un fichier d'un format qu'un pilote revendique, ou un dossier —
/// aux mêmes options pour toutes les dorées : un seul fil et aucune simplification, pour que la
/// sortie ne dépende que de la scène. La dorée d'un pilote entre donc par le routeur, comme tout
/// appelant du compilateur, et ne sait pas plus que lui quel format elle lui donne.
pub(super) fn compile_golden_source(source: &Path, name: &str) -> GoldenRun {
    let (options, root) = golden_options(source, name);
    let reports = std::sync::Mutex::new(Vec::new());
    let result = compile(&options, |report| {
        reports.lock().expect("reports").push(report);
    })
    .unwrap_or_else(|e| panic!("{name}: compile: {e}"));
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
        reports: reports.into_inner().expect("reports"),
        cache: options.cache.clone(),
        root,
    }
}

/// Le code de refus d'une source que le compilateur n'accepte pas, aux mêmes options qu'une dorée :
/// ce qu'un pilote refuse se fixe comme ce qu'il produit, et par le même chemin.
pub(super) fn refused_golden_source(source: &Path, name: &str) -> String {
    let (options, root) = golden_options(source, name);
    let refusal = compile(&options, |_| {})
        .err()
        .unwrap_or_else(|| panic!("{name}: cette source devait être refusée"));
    let _ = fs::remove_dir_all(&root);
    refusal.code.to_string()
}

/// Les options communes, et la racine jetable qui les porte.
fn golden_options(source: &Path, name: &str) -> (Options, PathBuf) {
    let root = std::env::temp_dir().join(format!(
        "wg-golden-{name}-{}-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed),
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
    (options, root)
}

impl GoldenRun {
    /// La scène intermédiaire qu'un pilote nommé a écrite dans le cache : son manifeste et son
    /// glTF. C'est ce que la dorée d'un pilote compare, avant que le compilateur ne la découpe.
    pub(super) fn prepared(&self, plugin: &str) -> (Value, Value) {
        let directory = self.prepared_dir(plugin);
        let manifest = fs::read(directory.join("manifest.json")).expect("manifest.json");
        let gltf = fs::read(directory.join("model.gltf")).expect("model.gltf");
        (
            serde_json::from_slice(&manifest).expect("manifest.json is valid JSON"),
            serde_json::from_slice(&gltf).expect("model.gltf is valid JSON"),
        )
    }

    /// Le dossier de cache où un pilote nommé a écrit sa scène intermédiaire. Une dorée qui veut
    /// lire les octets de cette scène — son binaire — part de là, sans deviner la clé.
    pub(super) fn prepared_dir(&self, plugin: &str) -> PathBuf {
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
                == Some(plugin)
            {
                return entry.path();
            }
        }
        panic!("aucune scène intermédiaire écrite par le pilote {plugin}");
    }
}

/// Ce que toute dorée de pilote de scène fixe, quel que soit le format : la provenance du pilote,
/// ce qu'il a compté et refusé, la charpente de la scène intermédiaire qu'il a écrite, et les deux
/// nombres que le compilateur en a retenus. Chaque famille y ajoute ensuite ce qui lui est propre —
/// les matériaux d'un projet, les primitives d'un maillage — en écrivant ses champs sur le résultat.
pub(super) fn scene_digest(run: &GoldenRun, plugin: &str) -> (Value, Value, Value) {
    let (manifest, gltf) = run.prepared(plugin);
    let digest = json!({
      "formatVersion": run.result["formatVersion"],
      "plugin": manifest["source"]["plugin"],
      "counts": manifest["source"]["counts"],
      "unsupported": manifest["unsupported"],
      "notes": manifest["notes"],
      "meshNodes": manifest["runtime"]["meshNodes"],
      "trianglesAcrossNodes": manifest["runtime"]["trianglesAcrossNodes"],
      "roots": gltf["scenes"][0]["nodes"],
      "nodes": gltf["nodes"],
      "meshNames": gltf["meshes"].as_array().expect("meshes").iter()
                       .map(|mesh| mesh["name"].clone()).collect::<Vec<Value>>(),
      "compiled": {
        "selectedTriangles": run.result["selectedTriangles"],
        "totalNodes": run.result["totalNodes"],
      },
    });
    (digest, manifest, gltf)
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

/// Écrit l'attendu d'une fixture qui se régénère : le condensé que le doré comparera, plus les deux
/// champs de prose que `golden_expected` retire ensuite. Ceux-ci sont conservés tels qu'ils étaient
/// quand le fichier existait — une phrase relue à la main ne se perd pas dans une régénération — et
/// les valeurs données ne servent qu'à la première écriture. Deux fixtures qui se régénèrent, c'est
/// la même écriture : elle ne s'écrit qu'une fois.
pub(super) fn write_expected(dir: &Path, mut expected: Value, case: &str, rule: &str) {
    let previous: Option<Value> = fs::read(dir.join("expected.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok());
    let object = expected.as_object_mut().expect("attendu");
    for (field, fallback) in [("case", case), ("rule", rule)] {
        let kept = previous
            .as_ref()
            .and_then(|value| value.get(field))
            .cloned()
            .unwrap_or_else(|| json!(fallback));
        object.insert(field.into(), kept);
    }
    let text = serde_json::to_vec_pretty(&expected).expect("attendu");
    fs::write(dir.join("expected.json"), &text).expect("expected.json");
    println!("fixture écrite dans {}", dir.display());
}
