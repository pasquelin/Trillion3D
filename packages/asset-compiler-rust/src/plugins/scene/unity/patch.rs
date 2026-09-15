//! Les retouches qu'une instance de prefab pose sur son prefab source.
//!
//! `m_Modifications` est une suite de `{target, propertyPath, value, objectReference}` : chaque
//! entrée vise un objet du prefab source par son `fileID` et y remplace une propriété. Le pilote
//! applique celles qui changent la géométrie ou le rendu — position, rotation, échelle, activité
//! d'un objet, matériau d'un emplacement, activation d'un rendu — et compte les autres, propriété
//! par propriété : le nombre d'un manque se lit au rapport plutôt que de se deviner.
use super::*;
use std::collections::HashMap;

/// Ce qu'une instance remplace, visé par visé.
#[derive(Default)]
pub(super) struct Changes {
    transforms: HashMap<i64, Overrides>,
    active: HashMap<i64, bool>,
    enabled: HashMap<i64, bool>,
    materials: HashMap<i64, Vec<Ref>>,
    /// Le nom de la racine : la seule retouche de nom qu'une instance porte.
    pub(super) name: Option<String>,
    /// Les retouches que le pilote sait appliquer.
    applied: usize,
    /// Les autres, comptées par propriété.
    ignored: BTreeMap<String, usize>,
}

/// Les préfixes d'une transformation locale : les trois grandeurs que le glTF porte, et rien
/// d'autre — l'indice d'angles d'Euler que l'éditeur garde à côté du quaternion n'en est pas une.
const TRANSFORM: [&str; 3] = ["m_LocalPosition.", "m_LocalRotation.", "m_LocalScale."];

impl Changes {
    /// Lit `m_Modifications`.
    pub(super) fn read(modification: &Yaml) -> Changes {
        let mut changes = Changes::default();
        for change in sequence(modification, "m_Modifications") {
            let target = reference(&change["target"]).file_id;
            let Some(path) = change["propertyPath"].as_str() else {
                changes.count("(sans propriété)");
                continue;
            };
            changes.read_one(target, path, change);
        }
        changes
    }

    fn read_one(&mut self, target: i64, path: &str, change: &Yaml) {
        let value = || number(&change["value"]);
        if TRANSFORM.iter().any(|prefix| path.starts_with(prefix)) {
            match value() {
                Some(value) => {
                    self.transforms
                        .entry(target)
                        .or_default()
                        .insert(path.to_string(), value);
                    self.applied += 1;
                }
                None => self.count(path),
            }
        } else if path == "m_IsActive" || path == "m_Enabled" {
            match value() {
                Some(value) => {
                    let table = if path == "m_IsActive" {
                        &mut self.active
                    } else {
                        &mut self.enabled
                    };
                    table.insert(target, value != 0.0);
                    self.applied += 1;
                }
                None => self.count(path),
            }
        } else if path == "m_Name" {
            self.name = change["value"].as_str().map(str::to_string);
            self.applied += 1;
        } else if let Some(slot) = material_slot(path) {
            let slots = self.materials.entry(target).or_default();
            cover(slots, slot + 1);
            slots[slot] = reference(&change["objectReference"]);
            self.applied += 1;
        } else {
            self.count(path);
        }
    }

    /// Compte une retouche laissée de côté sous le nom de sa propriété, les indices de tableau
    /// réduits à `[]` pour que le rapport garde un nombre borné d'entrées.
    fn count(&mut self, path: &str) {
        let mut name = String::with_capacity(path.len());
        let mut in_index = false;
        for letter in path.chars() {
            match letter {
                '[' => in_index = true,
                ']' => in_index = false,
                _ if in_index => continue,
                _ => {}
            }
            name.push(letter);
        }
        *self.ignored.entry(name).or_insert(0) += 1;
    }

    pub(super) fn transform(&self, target: i64) -> Option<&Overrides> {
        self.transforms.get(&target)
    }
    pub(super) fn active(&self, target: i64) -> Option<bool> {
        self.active.get(&target).copied()
    }
    pub(super) fn enabled(&self, target: i64) -> Option<bool> {
        self.enabled.get(&target).copied()
    }
    pub(super) fn materials(&self, target: i64) -> Option<&[Ref]> {
        self.materials.get(&target).map(Vec::as_slice)
    }

    /// Les retouches de toutes les cibles en une seule table : une instance de modèle n'a qu'une
    /// racine, et le `fileID` que la cible nomme appartient au fichier importé, pas à la scène.
    pub(super) fn merged_transform(&self) -> Overrides {
        let mut out = Overrides::new();
        for values in self.transforms.values() {
            out.extend(values.iter().map(|(path, value)| (path.clone(), *value)));
        }
        out
    }
    /// De même pour les matériaux : les emplacements de toutes les cibles, dans l'ordre.
    pub(super) fn merged_materials(&self) -> Vec<Ref> {
        let mut out: Vec<Ref> = Vec::new();
        for slots in self.materials.values() {
            cover(&mut out, slots.len());
            for (slot, reference) in slots.iter().enumerate() {
                if !reference.is_null() {
                    out[slot] = reference.clone();
                }
            }
        }
        out
    }

    /// Ce que l'instance a changé, et ce qu'elle demandait que ce pilote ne rend pas : le total,
    /// puis le détail par propriété, pour qu'un manque se voie et se chiffre.
    pub(super) fn report(&self, scene: &mut Scene) {
        scene.count("prefabOverridesApplied", self.applied);
        scene.count("prefabOverridesIgnored", self.ignored.values().sum());
        for (property, count) in &self.ignored {
            scene.report.add_count(
                &format!("unity-prefab-modification-ignored:{property}"),
                *count,
            );
        }
    }
}

/// Allonge la suite d'emplacements jusqu'à `len`, les nouveaux emplacements vides.
fn cover(slots: &mut Vec<Ref>, len: usize) {
    if slots.len() < len {
        slots.resize(len, Ref::default());
    }
}

/// `m_Materials.Array.data[2]` désigne le troisième emplacement de matériau du rendu.
fn material_slot(path: &str) -> Option<usize> {
    path.strip_prefix("m_Materials.Array.data[")?
        .strip_suffix(']')?
        .parse::<usize>()
        .ok()
}

/// La transformation locale, telle que Unity l'écrit, une fois les surcharges d'instance appliquées
/// puis la conversion d'axes faite.
pub(super) fn local_trs(body: &Yaml, overrides: &Overrides) -> Trs {
    let at = |path: &str, value: f64| overrides.get(path).copied().unwrap_or(value);
    let position = vec3(&body["m_LocalPosition"], [0.0, 0.0, 0.0]);
    let rotation = vec4(
        &body["m_LocalRotation"],
        ["x", "y", "z", "w"],
        [0., 0., 0., 1.],
    );
    let scale = vec3(&body["m_LocalScale"], [1.0, 1.0, 1.0]);
    Trs::from_unity(
        [
            at("m_LocalPosition.x", position[0]),
            at("m_LocalPosition.y", position[1]),
            at("m_LocalPosition.z", position[2]),
        ],
        [
            at("m_LocalRotation.x", rotation[0]),
            at("m_LocalRotation.y", rotation[1]),
            at("m_LocalRotation.z", rotation[2]),
            at("m_LocalRotation.w", rotation[3]),
        ],
        [
            at("m_LocalScale.x", scale[0]),
            at("m_LocalScale.y", scale[1]),
            at("m_LocalScale.z", scale[2]),
        ],
    )
}
