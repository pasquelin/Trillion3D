//! Le routeur : quel pilote pour cette source, et un refus explicite quand la réponse n'est pas une.
use super::*;
use crate::{is_safe_source_name, CompilerError};
use std::{collections::BTreeMap, fs, io::Read};

/// Octets lus en tête d'un fichier dont l'extension n'est revendiquée par aucun pilote.
const HEAD_BYTES: usize = 32;

/// Ce que le routeur a reconnu dans une source.
pub enum Routed {
    /// Le dossier porte `manifest.json` : c'est déjà la scène intermédiaire, aucun pilote.
    Manifest,
    /// Un pilote et les fichiers qu'il revendique, triés.
    Driver(&'static dyn ScenePlugin, Vec<PathBuf>),
}

/// La scène intermédiaire et le pilote qui l'a produite, pour la provenance et le rapport.
pub struct RoutedSource {
    pub scene: PreparedScene,
    /// `None` quand la source portait déjà `manifest.json` : aucun pilote n'est intervenu.
    pub plugin: Option<&'static dyn ScenePlugin>,
}

/// Route la source vers son pilote, puis lui fait produire la scène intermédiaire.
pub fn prepare_source(o: &Options, progress: &(dyn Fn(Value) + Sync)) -> Result<RoutedSource> {
    match route(&o.source)? {
        Routed::Manifest => Ok(RoutedSource {
            scene: PreparedScene::Manifest,
            plugin: None,
        }),
        Routed::Driver(plugin, inputs) => Ok(RoutedSource {
            scene: plugin.prepare(&SceneRequest::new(o, &inputs, progress))?,
            plugin: Some(plugin),
        }),
    }
}

/// Interroge le registre. Un fichier est routé sur lui seul ; un dossier l'est sur tous les fichiers
/// qu'un même pilote revendique. Deux pilotes servis par le même dossier, c'est une ambiguïté : le
/// compilateur refuse plutôt que de deviner lequel porte la scène.
///
/// Un pilote **de projet** passe avant : il revendique le dossier entier, et les fichiers trouvés
/// dessous sont ses entrées, pas des sources concurrentes.
pub fn route(source: &Path) -> Result<Routed> {
    if source.is_file() {
        let name = source
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(|| unknown(&source.to_string_lossy()))?;
        let plugin = claim(name, source).ok_or_else(|| unknown(name))?;
        return Ok(Routed::Driver(plugin, vec![source.to_path_buf()]));
    }
    if source.join("manifest.json").exists() {
        return Ok(Routed::Manifest);
    }
    if let Some(routed) = project(source)? {
        return Ok(routed);
    }
    let mut claimed: BTreeMap<&'static str, (&'static dyn ScenePlugin, Vec<PathBuf>)> =
        BTreeMap::new();
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str().filter(|name| is_safe_source_name(name)) else {
            continue;
        };
        let path = entry.path();
        if let Some(plugin) = claim(name, &path) {
            claimed
                .entry(plugin.name())
                .or_insert_with(|| (plugin, Vec::new()))
                .1
                .push(path);
        }
    }
    if claimed.len() > 1 {
        let names: Vec<&str> = claimed.keys().copied().collect();
        return Err(ambiguous(&names));
    }
    let (plugin, mut inputs) = claimed
        .into_values()
        .next()
        .ok_or_else(|| unknown(&source.to_string_lossy()))?;
    inputs.sort();
    Ok(Routed::Driver(plugin, inputs))
}

/// Le pilote de projet qui revendique ce dossier entier, s'il y en a un. Un projet est reconnu au
/// niveau du dossier : les fichiers trouvés dessous sont ses entrées, et il prime donc sur les
/// pilotes de fichiers, qui ne verraient là que des sources concurrentes. Deux projets pour un même
/// dossier restent une ambiguïté, comme deux formats.
fn project(source: &Path) -> Result<Option<Routed>> {
    let mut claimed: Vec<(&'static dyn ScenePlugin, Vec<PathBuf>)> = PLUGINS
        .iter()
        .filter_map(|plugin| {
            plugin
                .project_inputs(source)
                .filter(|inputs| !inputs.is_empty())
                .map(|inputs| (*plugin, inputs))
        })
        .collect();
    if claimed.len() > 1 {
        let names: Vec<&str> = claimed.iter().map(|(plugin, _)| plugin.name()).collect();
        return Err(ambiguous(&names));
    }
    Ok(claimed.pop().map(|(plugin, mut inputs)| {
        inputs.sort();
        Routed::Driver(plugin, inputs)
    }))
}

/// Le refus d'un dossier que plusieurs pilotes revendiquent : le compilateur ne devine pas lequel
/// porte la scène.
fn ambiguous(names: &[&str]) -> CompilerError {
    CompilerError::new(
        "SOURCE_FORMAT_AMBIGUOUS",
        format!(
            "Source directory is claimed by several import plugins ({}); keep one format per source directory",
            names.join(", ")
        ),
    )
}

/// Le pilote qui revendique ce fichier : son extension d'abord, son nombre magique ensuite — un
/// fichier sans extension connue peut rester lisible, un fichier illisible n'est revendiqué par
/// personne et le routeur le passe.
fn claim(name: &str, path: &Path) -> Option<&'static dyn ScenePlugin> {
    if let Some(found) =
        super::super::extension_of(name).and_then(|ext| super::super::claiming(PLUGINS, &ext))
    {
        return Some(found);
    }
    let head = head_bytes(path);
    PLUGINS
        .iter()
        .copied()
        .find(|plugin| plugin.accepts_head(&head))
}

/// Les premiers octets d'un fichier. Un dossier ou un fichier illisible en rend zéro.
fn head_bytes(path: &Path) -> Vec<u8> {
    let mut head = Vec::new();
    if let Ok(file) = fs::File::open(path) {
        let _ = file.take(HEAD_BYTES as u64).read_to_end(&mut head);
    }
    head
}

/// Le refus d'une source qu'aucun pilote ne revendique, avec la liste de ce qui est accepté.
fn unknown(what: &str) -> CompilerError {
    let accepted: Vec<String> = PLUGINS
        .iter()
        .map(|plugin| format!("{} (.{})", plugin.name(), plugin.extensions().join(", .")))
        .collect();
    CompilerError::new(
        "SOURCE_FORMAT_UNKNOWN",
        format!(
            "{what}: no import plugin accepts this source. Accepted: a directory carrying manifest.json, {}",
            accepted.join(", ")
        ),
    )
}
