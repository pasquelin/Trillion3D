//! Overrides a prefab instance places on its source prefab.
//!
//! `m_Modifications` is a sequence of `{target, propertyPath, value, objectReference}`: each
//! entry targets an object of the source prefab by its `fileID` and replaces a property there.
//! The driver applies those that change geometry or rendering — position, rotation, scale, an
//! object's activity, a slot's material, a renderer's enabled flag — and counts the others,
//! property by property: the count of a gap is read in the report rather than guessed.
use super::*;

/// What an instance replaces, target by target.
#[derive(Default)]
pub(super) struct Changes {
    transforms: BTreeMap<i64, Overrides>,
    active: BTreeMap<i64, bool>,
    enabled: BTreeMap<i64, bool>,
    /// Material slots the instance replaces: `None` when it says nothing of this slot, `Some`
    /// when it names it — the empty reference included, which empties the slot instead of
    /// keeping the prefab's.
    materials: BTreeMap<i64, Vec<Option<Ref>>>,
    /// Root name: the only name override an instance carries.
    pub(super) name: Option<String>,
    /// Overrides the driver knows how to apply.
    applied: usize,
    /// The others, counted by property.
    ignored: BTreeMap<String, usize>,
    /// Material-slot overrides whose index describes no renderer.
    unplaceable: usize,
    /// What the instance changes in its source's structure, not in its properties.
    pub(super) structure: Structure,
}

/// Prefixes of a local transform: the three quantities glTF carries, and nothing else — the
/// Euler-angle index the editor keeps beside the quaternion is not one.
const TRANSFORM: [&str; 3] = ["m_LocalPosition.", "m_LocalRotation.", "m_LocalScale."];

impl Changes {
    /// Reads `m_Modifications`.
    pub(super) fn read(modification: &Yaml) -> Changes {
        let mut changes = Changes::default();
        for change in sequence(modification, "m_Modifications") {
            let target = reference(&change["target"]).file_id;
            let Some(path) = change["propertyPath"].as_str() else {
                changes.count("(no property)");
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

    /// Counts an override left aside under its property name, array indices reduced to `[]` so
    /// the report keeps a bounded number of entries.
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

    /// Places an outer instance's overrides on top of these: a nested prefab applies its own
    /// first, then those of the instance that contains it — nesting order, last word to the
    /// outermost. The root name is not forwarded: it targets the root of the instance that
    /// carries it, not that of the prefab it contains.
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

    /// Targets of transform overrides, by increasing `fileID`: the same file rereads in the
    /// same order, and each value sequence stays that of its only object.
    pub(super) fn transform_targets(&self) -> impl Iterator<Item = (i64, &Overrides)> {
        self.transforms
            .iter()
            .map(|(target, values)| (*target, values))
    }
    /// Likewise for material slots.
    pub(super) fn material_targets(&self) -> impl Iterator<Item = (i64, &[Option<Ref>])> {
        self.materials
            .iter()
            .map(|(target, slots)| (*target, slots.as_slice()))
    }

    /// What the instance changed, and what it asked that this driver does not yield: the total,
    /// then the detail by property, so a gap is seen and numbered.
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
