//! Le déroulé d'un pilote de conteneur, le même pour tous : une archive et une seule, extraite sous
//! le cache à sa clé, marquée quand elle est entière, puis routée comme n'importe quelle source.
//!
//! Un format d'archive n'apporte ici que sa lecture — la fonction `extract` que son module écrit.
//! Tout le reste, du refus d'une source ambiguë à la chaîne publiée au rapport, vit une seule fois.
use super::*;
use crate::atomic;
use serde_json::json;
use std::fs;

/// La marque d'une extraction terminée, à côté du dossier extrait et jamais dedans : tant qu'elle
/// n'est pas écrite, le dossier est un chantier que personne ne relit.
const MARKER: &str = "archive.json";
/// Le dossier extrait, sous la clé d'extraction : la marque lui tient compagnie sans le polluer.
const CONTENT: &str = "content";
/// Le dossier où l'extraction écrit tant qu'elle dure : il devient le dossier extrait d'un seul
/// renommage, et une extraction refusée l'emporte avec elle.
const STAGING: &str = "chantier";

/// Extrait puis route une archive. `extract` reçoit le fichier source et la racine d'extraction, et
/// rend le nombre d'entrées et le total décompressé ; elle n'écrit rien quand elle refuse.
pub(in super::super) fn container(
    request: &SceneRequest<'_>,
    plugin: &dyn ScenePlugin,
    pinned: Option<&str>,
    extract: impl Fn(&Path, &Path) -> Result<(usize, u64)>,
) -> Result<PreparedScene> {
    let file = only_input(request, plugin)?;
    let directory = extraction_dir(request, plugin, &crate::hash_file(file)?);
    let (content, marker) = (directory.join(CONTENT), directory.join(MARKER));
    let extracted = ready(&marker);
    if extracted.is_none() {
        let counts = whole(&directory, &content, |staging| extract(file, staging))?;
        (request.progress)(
            json!({"phase":"archive","step":"extract","plugin":plugin.name(),"entries":counts.0,"bytes":counts.1}),
        );
    }
    let (scene, inner) = compose(request, &content, pinned)?;
    let chain = match inner {
        Some(_) => chain(plugin, inner),
        None => extracted.unwrap_or_else(|| chain(plugin, None)),
    };
    atomic(
        &marker,
        &serde_json::to_vec_pretty(&json!({"status":"ready","chain":chain}))?,
    )?;
    (request.progress)(json!({"phase":"archive","step":"routed","chain":chain}));
    Ok(scene)
}

/// Extrait dans un dossier de chantier, puis le renomme d'un coup : le dossier extrait n'apparaît
/// que complet. Une archive refusée n'en laisse donc aucune trace, pas même un fichier à moitié
/// écrit — le routeur ne verra jamais un chantier là où il attend une scène.
fn whole(
    directory: &Path,
    content: &Path,
    extract: impl Fn(&Path) -> Result<(usize, u64)>,
) -> Result<(usize, u64)> {
    let staging = directory.join(STAGING);
    let _ = fs::remove_dir_all(&staging);
    let _ = fs::remove_dir_all(content);
    fs::create_dir_all(&staging)?;
    match extract(&staging) {
        Ok(counts) => {
            fs::rename(&staging, content)?;
            Ok(counts)
        }
        Err(refusal) => {
            let _ = fs::remove_dir_all(&staging);
            Err(refusal)
        }
    }
}

/// La chaîne d'une extraction déjà faite, ou rien s'il faut (re)faire l'extraction.
fn ready(marker: &Path) -> Option<Value> {
    let marker: Value = serde_json::from_slice(&fs::read(marker).ok()?).ok()?;
    (marker["status"] == "ready").then(|| marker["chain"].clone())
}

/// Route le dossier extrait et lui fait produire la scène intermédiaire. Rend le pilote interne
/// retenu, `None` quand le dossier portait déjà son manifeste — une extraction réutilisée.
fn compose(
    request: &SceneRequest<'_>,
    extracted: &Path,
    pinned: Option<&str>,
) -> Result<(PreparedScene, Option<&'static dyn ScenePlugin>)> {
    // Un format qui nomme lui-même sa source ne laisse rien à choisir au routeur : les autres
    // fichiers extraits sont ses ressources, jamais des scènes candidates.
    let (root, source) = match pinned {
        Some(name) => (extracted.to_path_buf(), safe_join(extracted, name)?),
        None => {
            let root = single_root(extracted);
            (root.clone(), root)
        }
    };
    match route(&source)? {
        Routed::Manifest => Ok((PreparedScene::converted(root.clone(), &root), None)),
        Routed::Driver(inner, inputs) => {
            let inner_request = SceneRequest {
                source: &source,
                inputs: &inputs,
                cache: request.cache,
                cancelled: request.cancelled,
                progress: request.progress,
            };
            let scene = match inner.prepare(&inner_request)? {
                PreparedScene::InPlace(name) => stage_in_place(&root, &name)?,
                converted => converted,
            };
            Ok((scene, Some(inner)))
        }
    }
}

/// La chaîne du conteneur et de son pilote interne, telle qu'elle voyage dans le rapport et dans la
/// marque d'extraction : deux pilotes sont intervenus, les deux se nomment et se versionnent.
fn chain(container: &dyn ScenePlugin, inner: Option<&dyn ScenePlugin>) -> Value {
    json!([
        crate::plugins::provenance(container),
        inner.map(crate::plugins::provenance)
    ])
}

/// Un glTF laissé en place par son pilote se lit à côté de la source ; dans une archive, la source
/// est l'archive et non le dossier extrait. Le conteneur pose donc dans ce dossier le manifeste que
/// le compilateur calculerait lui-même pour cette scène — les mêmes octets, donc la même identité de
/// cache qu'hors archive — et rend le dossier comme scène intermédiaire. Les images de cette scène
/// sont celles que l'extraction a écrites à côté d'elle : le dossier extrait est leur racine.
fn stage_in_place(root: &Path, name: &str) -> Result<PreparedScene> {
    let loaded = crate::load_model_file(root, name, None)?;
    atomic(&root.join("manifest.json"), &loaded.manifest_bytes)?;
    Ok(PreparedScene::converted(root.to_path_buf(), root))
}

/// Un unique dossier racine — `kit/` dans `kit.zip` — est traversé : l'archive livre l'arbre du
/// projet, pas un dossier qui n'existe que pour l'emballage. Un dossier qui porte autre chose qu'un
/// seul sous-dossier est la racine cherchée.
fn single_root(extracted: &Path) -> PathBuf {
    let mut root = extracted.to_path_buf();
    while let Some(only) = only_child(&root) {
        root = only;
    }
    root
}

/// L'unique enfant d'un dossier quand c'en est un dossier, sinon rien.
fn only_child(dir: &Path) -> Option<PathBuf> {
    let mut entries = std::fs::read_dir(dir).ok()?;
    let first = entries.next()?.ok()?.path();
    if entries.next().is_some() || !first.is_dir() {
        return None;
    }
    Some(first)
}
