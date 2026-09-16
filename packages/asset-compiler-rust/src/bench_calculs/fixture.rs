//! Compilation des cinq fixtures dorées : temps de bout en bout, chronomètres de `perf.rs`, et
//! empreinte octet par octet de tout ce que le compilateur écrit. Le même fichier est produit avant
//! et après les optimisations ; deux exécutions identiques ont exactement les mêmes empreintes.
use super::rapport::{mesures_dir, today};
use crate::compiler_validate::hash;
use crate::{compile, Options};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{atomic::AtomicBool, Arc};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const NAMES: [&str; 5] = [
    "three-stack",
    "full-overlap",
    "partial-overlap",
    "masked-overlay",
    "blend-overlay",
];

/// Chemin relatif et empreinte de chaque fichier du dossier, trié : la comparaison est totale.
fn digests(root: &Path, base: &Path, into: &mut Vec<(String, String)>) {
    let Ok(entries) = std::fs::read_dir(base) else {
        return;
    };
    let mut paths: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
    paths.sort();
    for path in paths {
        if path.is_dir() {
            digests(root, &path, into);
        } else if let Ok(bytes) = std::fs::read(&path) {
            let name = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string();
            into.push((name, hash(&bytes)));
        }
    }
}

/// Le manifeste allégé sans ce qui dépend de la machine ou de la version du code : ce qui reste doit
/// être identique au bit près d'une version à l'autre.
fn stable(mut manifest: Value) -> Value {
    if let Some(object) = manifest.as_object_mut() {
        object.remove("metrics");
        object.remove("key");
    }
    manifest
}

fn compile_one(name: &str) -> (f64, Value) {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures/coplanar")
        .join(name);
    let root = std::env::temp_dir().join(format!(
        "wg-banc-{name}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("horloge")
            .as_nanos()
    ));
    let options = Options {
        source: dir.join(format!("{name}.gltf")),
        cache: root.join("cache"),
        resource_base: "/assets".into(),
        scope: "full".into(),
        triangle_budget: 1_000_000,
        threads: 1,
        ram_budget_mb: 64,
        simplification: "none".into(),
        cancelled: Arc::new(AtomicBool::new(false)),
    };
    let started = Instant::now();
    let result = compile(&options, |_| {}).unwrap_or_else(|e| panic!("{name} : {e}"));
    let ms = started.elapsed().as_secs_f64() * 1000.0;
    let key = result["key"].as_str().expect("clé").to_string();
    let directory = options.cache.join("native").join("full").join(&key);
    let mut files: Vec<(String, String)> = Vec::new();
    digests(&directory, &directory, &mut files);
    let mut objects: Vec<(String, String)> = Vec::new();
    let store = options.cache.join("native").join("objects");
    digests(&store, &store, &mut objects);
    let slim: Value = serde_json::from_slice(
        &std::fs::read(directory.join("clusters.json")).expect("clusters.json"),
    )
    .expect("clusters.json est du JSON");
    // Les phases appartiennent au travail qui les a dépensées : le relevé les porte par fixture,
    // puisqu'aucun compteur ne les additionne plus d'une compilation à l'autre.
    let record = json!({"fixture":name,"ms":ms,"phasesMs":result["metrics"]["phaseElapsedMs"],
      "manifesteAllege":hash(serde_json::to_vec(&stable(slim)).expect("manifeste").as_slice()),
      "fichiers":files.iter().map(|(n,d)|json!([n,d])).collect::<Vec<Value>>(),
      "objets":objects.iter().map(|(_,d)|json!(d)).collect::<Vec<Value>>()});
    let _ = std::fs::remove_dir_all(&root);
    (ms, record)
}

/// Compile les cinq fixtures et dépose le relevé dans `.mesure/out/calculs/`.
pub(crate) fn run() -> (f64, String) {
    let label = std::env::var("WG_BANC_LABEL").unwrap_or_else(|_| "banc".into());
    let mut total = 0.0;
    let mut records = Vec::new();
    for name in NAMES {
        let (ms, record) = compile_one(name);
        total += ms;
        records.push(record);
    }
    let path = mesures_dir().join(format!("calculs-natif-{}-fixtures-{label}.json", today()));
    let payload = json!({"label":label,"totalMs":total,"fixtures":records});
    let _ = std::fs::write(
        &path,
        serde_json::to_vec_pretty(&payload).unwrap_or_default(),
    );
    (total, path.to_string_lossy().to_string())
}
