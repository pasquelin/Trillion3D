//! Le relevé qu'une conversion laisse derrière elle : les fichiers qu'elle a ouverts et les chemins
//! d'image qu'elle a essayés. Relu au passage suivant, il donne la clé du cache sans rouvrir la
//! source ; quand il se trompe, la conversion qui suit écrit la vraie clé et le corrige.
use super::*;

/// Le relevé d'une conversion précédente vit hors de `imports/`, qui ne porte que des scènes, et
/// appartient au dossier qui résout les dépendances autant qu'aux entrées : deux sources aux mêmes
/// octets posées ailleurs n'ouvrent pas les mêmes fichiers. La clé définitive reste par contenu.
fn probe_path(cache: &Path, base: &str, root: &Path) -> PathBuf {
    let stamp = hash(format!("{base}\n{}", root.to_string_lossy()).as_bytes());
    let folder = cache.join("native").join("imports-externes");
    folder.join(format!("{stamp}.json"))
}

/// Les fichiers qu'une conversion précédente des mêmes entrées, ici, avait ouverts, rehachés.
pub(crate) fn expected(cache: &Path, base: &str, root: &Path) -> Vec<External> {
    let Ok(bytes) = fs::read(probe_path(cache, base, root)) else {
        return Vec::new();
    };
    let Ok(listed) = serde_json::from_slice::<Value>(&bytes) else {
        return Vec::new();
    };
    listed
        .as_array()
        .map(|files| files.iter().filter_map(reread).collect())
        .unwrap_or_default()
}

fn reread(entry: &Value) -> Option<External> {
    let path = entry.get("path")?.as_str()?;
    let kind = kind_named(entry.get("kind")?.as_str()?)?;
    Some(describe(Path::new(path), kind))
}

/// Écrit le relevé, ou l'efface quand l'import n'a rien ouvert d'autre que sa source.
pub(crate) fn write_probe(cache: &Path, base: &str, root: &Path, files: &[External]) -> Result<()> {
    let path = probe_path(cache, base, root);
    if files.is_empty() {
        let _ = fs::remove_file(&path);
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let listed: Vec<Value> = files
        .iter()
        .map(|file| json!({"path":file.path,"kind":file.kind}))
        .collect();
    atomic(&path, &serde_json::to_vec(&Value::Array(listed))?)
}
