//! What a prefab instance changes in its source's structure, not in its properties.
//!
//! An instance does more than replace values: it removes components from its source, it adds
//! objects, it adds components. Those three lists live beside `m_Modifications`, and each names
//! the source object it targets. A removed component does not exist for the walk: a removed
//! renderer emits nothing. An added object is described in the document that carries the
//! instance, not in the source prefab: it is built there then takes its place under the targeted
//! object. What this driver does not yield is counted by name.
use super::*;

/// Code for a component added by an instance, which this driver does not pour into the source.
const ADDED_COMPONENT: &str = "unity-prefab-added-component-unconverted";
/// Code for an added object whose target rendered nothing: it comes out under the instance root.
pub(super) const ADDED_UNPLACED: &str = "unity-prefab-added-object-unplaced";

/// Structural changes of an instance.
#[derive(Default)]
pub(super) struct Structure {
    /// Components the instance removes, by `fileID` in the source.
    removed: BTreeSet<i64>,
    /// Added objects: the targeted object in the source, then the added transform.
    added: Vec<(i64, i64)>,
    /// Components added to a source object.
    components: usize,
}

impl Structure {
    pub(super) fn read(modification: &Yaml) -> Structure {
        let target = |added: &Yaml| reference(&added["targetCorrespondingSourceObject"]).file_id;
        Structure {
            removed: sequence(modification, "m_RemovedComponents")
                .iter()
                .map(|component| reference(component).file_id)
                .collect(),
            added: sequence(modification, "m_AddedGameObjects")
                .iter()
                .map(|added| (target(added), reference(&added["addedObject"]).file_id))
                .collect(),
            components: sequence(modification, "m_AddedComponents").len(),
        }
    }

    /// Is this source component removed by the instance?
    pub(super) fn removes(&self, component: i64) -> bool {
        self.removed.contains(&component)
    }

    /// Added objects, in the order the instance declares them.
    pub(super) fn added(&self) -> &[(i64, i64)] {
        &self.added
    }

    /// Removals of an outer instance also apply to the prefab it contains; objects it adds, on
    /// the other hand, sit at its own level and are not forwarded.
    pub(super) fn overlay(&mut self, outer: &Structure) {
        self.removed.extend(outer.removed.iter().copied());
    }

    /// A zero count is not written: the report names only what happened.
    pub(super) fn report(&self, scene: &mut Scene) {
        if !self.removed.is_empty() {
            scene.count("componentsRemoved", self.removed.len());
        }
        scene.report.add_count(ADDED_COMPONENT, self.components);
    }
}
