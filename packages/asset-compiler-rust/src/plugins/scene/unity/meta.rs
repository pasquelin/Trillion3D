//! Import settings of a model, declared by its `.meta`.
//!
//! Unity does not place a model file as-is in a scene: its `ModelImporter` declares a scale
//! factor, and remembers for each object the import produced the `fileID` by which the scene
//! names it and the name it carried in the file. Those two tables are `.meta` *data* —
//! serialized YAML, never code or an editor script. A `.meta` has no `--- !u!` header: it is
//! an ordinary YAML document, read as-is.
use super::*;
use std::collections::HashMap;
use yaml_rust2::YamlLoader;

/// What a `ModelImporter` declares and this driver knows how to apply.
pub(super) struct ModelImport {
    /// `globalScale`: the scale factor entered in the inspector.
    global_scale: f64,
    /// `useFileScale`: the editor converts the file unit into metres.
    use_file_scale: bool,
    /// `fileScale`: the unit the `.meta` remembered, when it writes it.
    file_scale: Option<f64>,
    /// `fileID` → imported object name, by `internalIDToNameTable` or, in older projects, by
    /// `fileIDToRecycleName`.
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
    /// Factor that remains to apply to a geometry the format driver already yielded in metres.
    /// Unity starts from the file's raw units: it multiplies them by the file unit when
    /// “Convert Units” is checked, then by the declared scale factor. The format driver, for
    /// its part, yielded `raw × unit`. What remains is therefore exactly
    /// `globalScale × (useFileScale ? fileScale : 1) ÷ unit`, where `fileScale` is the unit the
    /// `.meta` remembered and, failing that, the one the file reader read. The two coincide in
    /// the ordinary case: the factor is then `globalScale`.
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

    /// Name the editor remembered for this `fileID`.
    pub(super) fn name(&self, file_id: i64) -> Option<&str> {
        self.names.get(&file_id).map(String::as_str)
    }
}

/// Document of a `.meta`. A `.meta` has no `--- !u!` header: it is ordinary YAML, read as-is.
/// Missing or unreadable, it yields nothing and the caller keeps its defaults.
pub(super) fn document(meta: &Path) -> Yaml {
    read_text(meta)
        .and_then(|text| YamlLoader::load_from_str(&text).ok())
        .and_then(|documents| documents.into_iter().next())
        .unwrap_or(Yaml::BadValue)
}

/// Reads a model's `.meta`. A missing, unreadable or silent `.meta` yields the default
/// settings: no scaling, no name — the driver then falls back on the whole model.
pub(super) fn read(meta: &Path) -> ModelImport {
    let read = document(meta);
    let importer = &read["ModelImporter"];
    ModelImport {
        global_scale: setting(importer, "globalScale").unwrap_or(1.0),
        use_file_scale: setting(importer, "useFileScale").unwrap_or(1.0) != 0.0,
        file_scale: setting(importer, "fileScale"),
        names: names(importer),
    }
}

/// A `ModelImporter` property, written at its root or in its `meshes` block depending on the
/// project's serialisation version.
fn setting(importer: &Yaml, key: &str) -> Option<f64> {
    number(&importer[key]).or_else(|| number(&importer["meshes"][key]))
}

/// `fileID` → name table. Recent projects write it as a sequence of pairs
/// `{first: {class: fileID}, second: name}`; older ones as a `fileID: name` mapping. A
/// `fileID` is read as a sixty-four-bit integer: as a float, `2^53 + 1` would fall back on
/// `2^53` and the entry would name another object than the one the `.meta` names.
fn names(importer: &Yaml) -> HashMap<i64, String> {
    let mut out = HashMap::new();
    if let Some(table) = importer["fileIDToRecycleName"].as_hash() {
        for (file_id, name) in table {
            if let (Some(file_id), Some(name)) = (integer(file_id), text(name)) {
                out.insert(file_id, name);
            }
        }
    }
    for pair in sequence(importer, "internalIDToNameTable") {
        let Some((_, file_id)) = pair["first"].as_hash().and_then(|first| first.front()) else {
            continue;
        };
        if let (Some(file_id), Some(name)) = (integer(file_id), text(&pair["second"])) {
            out.insert(file_id, name);
        }
    }
    out
}
