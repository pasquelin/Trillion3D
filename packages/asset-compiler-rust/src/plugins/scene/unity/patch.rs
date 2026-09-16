//! Les retouches qu'une instance de prefab pose sur son prefab source.
//!
//! `m_Modifications` est une suite de `{target, propertyPath, value, objectReference}` : chaque
//! entrée vise un objet du prefab source par son `fileID` et y remplace une propriété. Le pilote
//! applique celles qui changent la géométrie ou le rendu — position, rotation, échelle, activité
//! d'un objet, matériau d'un emplacement, activation d'un rendu — et compte les autres, propriété
//! par propriété : le nombre d'un manque se lit au rapport plutôt que de se deviner.
use super::*;

/// Ce qu'une instance remplace, visé par visé.
#[derive(Default)]
pub(super) struct Changes {
    transforms: BTreeMap<i64, Overrides>,
    active: BTreeMap<i64, bool>,
    enabled: BTreeMap<i64, bool>,
    /// Les emplacements de matériau que l'instance remplace : `None` quand elle ne dit rien de
    /// cet emplacement, `Some` quand elle le nomme — la référence vide comprise, qui vide
    /// l'emplacement au lieu de garder celui du prefab.
    materials: BTreeMap<i64, Vec<Option<Ref>>>,
    /// Le nom de la racine : la seule retouche de nom qu'une instance porte.
    pub(super) name: Option<String>,
    /// Les retouches que le pilote sait appliquer.
    applied: usize,
    /// Les autres, comptées par propriété.
    ignored: BTreeMap<String, usize>,
    /// Les retouches d'emplacement de matériau dont l'indice ne décrit aucun rendu.
    unplaceable: usize,
    /// Ce que l'instance change dans la structure de sa source, et non dans ses propriétés.
    pub(super) structure: Structure,
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
        changes.structure = Structure::read(modification);
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
            let Some(len) = slot.checked_add(1).filter(|len| *len <= MAX_SLOTS) else {
                self.unplaceable += 1;
                return;
            };
            let slots = self.materials.entry(target).or_default();
            cover(slots, len);
            slots[slot] = Some(reference(&change["objectReference"]));
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

    /// Pose les retouches d'une instance extérieure par-dessus celles-ci : un prefab imbriqué
    /// applique d'abord les siennes, puis celles de l'instance qui le contient — l'ordre de
    /// nidification, le dernier mot à la plus extérieure. Le nom de racine ne se transmet pas : il
    /// vise la racine de l'instance qui le porte, non celle du prefab qu'elle contient.
    pub(super) fn overlay(&mut self, outer: &Changes) {
        for (target, values) in &outer.transforms {
            let mine = self.transforms.entry(*target).or_default();
            mine.extend(values.iter().map(|(path, value)| (path.clone(), *value)));
        }
        self.structure.overlay(&outer.structure);
        self.active
            .extend(outer.active.iter().map(|(&target, &flag)| (target, flag)));
        self.enabled
            .extend(outer.enabled.iter().map(|(&target, &flag)| (target, flag)));
        for (target, slots) in &outer.materials {
            let mine = self.materials.entry(*target).or_default();
            cover(mine, slots.len());
            for (slot, replaced) in slots.iter().enumerate() {
                if replaced.is_some() {
                    mine[slot] = replaced.clone();
                }
            }
        }
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
    pub(super) fn materials(&self, target: i64) -> Option<&[Option<Ref>]> {
        self.materials.get(&target).map(Vec::as_slice)
    }

    /// Les cibles des retouches de transformation, par `fileID` croissant : le même fichier se
    /// relit dans le même ordre, et chaque suite de valeurs reste celle de son seul objet.
    pub(super) fn transform_targets(&self) -> impl Iterator<Item = (i64, &Overrides)> {
        self.transforms
            .iter()
            .map(|(target, values)| (*target, values))
    }
    /// De même pour les emplacements de matériau.
    pub(super) fn material_targets(&self) -> impl Iterator<Item = (i64, &[Option<Ref>])> {
        self.materials
            .iter()
            .map(|(target, slots)| (*target, slots.as_slice()))
    }

    /// Ce que l'instance a changé, et ce qu'elle demandait que ce pilote ne rend pas : le total,
    /// puis le détail par propriété, pour qu'un manque se voie et se chiffre.
    pub(super) fn report(&self, scene: &mut Scene) {
        scene.count("prefabOverridesApplied", self.applied);
        scene.count(
            "prefabOverridesIgnored",
            self.ignored.values().sum::<usize>() + self.unplaceable,
        );
        scene.report.add_count(SLOT_INVALID, self.unplaceable);
        self.structure.report(scene);
        for (property, count) in &self.ignored {
            scene.report.add_count(
                &format!("unity-prefab-modification-ignored:{property}"),
                *count,
            );
        }
    }
}
