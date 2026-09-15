//! Les réglages d'import d'un modèle, déclarés par son `.meta`.
//!
//! Unity ne pose pas un fichier modèle tel quel dans une scène : son `ModelImporter` déclare un
//! facteur d'échelle, et mémorise pour chaque objet que l'import a produit le `fileID` par lequel la
//! scène le désigne et le nom qu'il portait dans le fichier. Ces deux tables sont des *données* du
//! `.meta` — du YAML sérialisé, jamais du code ni un script d'éditeur. Un `.meta` n'a pas d'entête
//! `--- !u!` : c'est un document YAML ordinaire, lu tel quel.
use super::*;
use std::collections::HashMap;
use yaml_rust2::YamlLoader;

/// Ce qu'un `ModelImporter` déclare et que ce pilote sait appliquer.
pub(super) struct ModelImport {
    /// `globalScale` : le facteur d'échelle saisi dans l'inspecteur.
    global_scale: f64,
    /// `useFileScale` : l'éditeur convertit l'unité du fichier en mètres.
    use_file_scale: bool,
    /// `fileScale` : l'unité que le `.meta` a mémorisée, quand il l'écrit.
    file_scale: Option<f64>,
    /// `fileID` → nom de l'objet importé, par `internalIDToNameTable` ou, dans les anciens projets,
    /// par `fileIDToRecycleName`.
    names: HashMap<i64, String>,
}

impl Default for ModelImport {
    fn default() -> Self {
        ModelImport {
            global_scale: 1.0,
            use_file_scale: true,
            file_scale: None,
            names: HashMap::new(),
        }
    }
}

impl ModelImport {
    /// Le facteur qui reste à appliquer à une géométrie que le pilote du format a déjà rendue en
    /// mètres. Unity part des unités brutes du fichier : elle les multiplie par l'unité du fichier
    /// quand « Convert Units » est coché, puis par le facteur d'échelle déclaré. Le pilote du
    /// format, lui, a rendu `brut × unité`. Reste donc exactement
    /// `globalScale × (useFileScale ? fileScale : 1) ÷ unité`, où `fileScale` est l'unité que le
    /// `.meta` a mémorisée et, à défaut, celle que le lecteur du fichier a lue. Les deux coïncident
    /// dans le cas ordinaire : le facteur vaut alors `globalScale`.
    pub(super) fn scale(&self, unit_meters: f64) -> f64 {
        let unit = if unit_meters.is_finite() && unit_meters > 0.0 {
            unit_meters
        } else {
            1.0
        };
        let file = self.file_scale.filter(|v| v.is_finite() && *v > 0.0);
        let numerator = if self.use_file_scale {
            file.unwrap_or(unit)
        } else {
            1.0
        };
        let scale = self.global_scale * numerator / unit;
        if scale.is_finite() && scale > 0.0 {
            scale
        } else {
            1.0
        }
    }

    /// Le nom que l'éditeur a mémorisé pour ce `fileID`.
    pub(super) fn name(&self, file_id: i64) -> Option<&str> {
        self.names.get(&file_id).map(String::as_str)
    }
}

/// Lit le `.meta` d'un modèle. Un `.meta` absent, illisible ou muet rend les réglages par défaut :
/// aucune mise à l'échelle, aucun nom — le pilote retombe alors sur le modèle entier.
pub(super) fn read(meta: &Path) -> ModelImport {
    let Some(text) = read_text(meta) else {
        return ModelImport::default();
    };
    let Ok(documents) = YamlLoader::load_from_str(&text) else {
        return ModelImport::default();
    };
    let Some(importer) = documents.first().map(|document| &document["ModelImporter"]) else {
        return ModelImport::default();
    };
    ModelImport {
        global_scale: setting(importer, "globalScale").unwrap_or(1.0),
        use_file_scale: setting(importer, "useFileScale").unwrap_or(1.0) != 0.0,
        file_scale: setting(importer, "fileScale"),
        names: names(importer),
    }
}

/// Une propriété du `ModelImporter`, écrite à sa racine ou dans son bloc `meshes` selon la version
/// de sérialisation du projet.
fn setting(importer: &Yaml, key: &str) -> Option<f64> {
    number(&importer[key]).or_else(|| number(&importer["meshes"][key]))
}

/// La table `fileID` → nom. Les projets récents l'écrivent en séquence de couples
/// `{first: {classe: fileID}, second: nom}` ; les anciens en mappage `fileID: nom`.
fn names(importer: &Yaml) -> HashMap<i64, String> {
    let mut out = HashMap::new();
    if let Some(table) = importer["fileIDToRecycleName"].as_hash() {
        for (file_id, name) in table {
            if let (Some(file_id), Some(name)) = (number(file_id), text(name)) {
                out.insert(file_id as i64, name);
            }
        }
    }
    for pair in sequence(importer, "internalIDToNameTable") {
        let Some((_, file_id)) = pair["first"].as_hash().and_then(|first| first.front()) else {
            continue;
        };
        if let (Some(file_id), Some(name)) = (number(file_id), text(&pair["second"])) {
            out.insert(file_id as i64, name);
        }
    }
    out
}
