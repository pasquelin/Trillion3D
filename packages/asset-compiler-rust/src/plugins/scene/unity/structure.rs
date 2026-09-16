//! Ce qu'une instance de prefab change dans la structure de sa source, et non dans ses propriétés.
//!
//! Une instance ne fait pas que remplacer des valeurs : elle retire des composants de sa source,
//! elle lui ajoute des objets, elle lui ajoute des composants. Ces trois listes vivent à côté de
//! `m_Modifications`, et chacune nomme l'objet de la source qu'elle vise. Un composant retiré
//! n'existe pas pour le parcours : un rendu retiré n'émet rien. Un objet ajouté, lui, est décrit
//! dans le document qui porte l'instance, pas dans le prefab source : il se construit là-bas puis
//! prend sa place sous l'objet visé. Ce que ce pilote ne rend pas est compté par son nom.
use super::*;

/// Le code d'un composant ajouté par une instance, que ce pilote ne verse pas dans la source.
const ADDED_COMPONENT: &str = "unity-prefab-added-component-unconverted";
/// Celui d'un objet ajouté dont l'objet visé n'a rien rendu : il sort sous la racine de l'instance.
pub(super) const ADDED_UNPLACED: &str = "unity-prefab-added-object-unplaced";

/// Les changements de structure d'une instance.
#[derive(Default)]
pub(super) struct Structure {
    /// Les composants que l'instance retire, par `fileID` dans la source.
    removed: BTreeSet<i64>,
    /// Les objets ajoutés : l'objet visé dans la source, puis la transformation ajoutée.
    added: Vec<(i64, i64)>,
    /// Les composants ajoutés à un objet de la source.
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

    /// Ce composant de la source est-il retiré par l'instance ?
    pub(super) fn removes(&self, component: i64) -> bool {
        self.removed.contains(&component)
    }

    /// Les objets ajoutés, dans l'ordre où l'instance les déclare.
    pub(super) fn added(&self) -> &[(i64, i64)] {
        &self.added
    }

    /// Les retraits d'une instance extérieure valent aussi pour le prefab qu'elle contient ; les
    /// objets qu'elle ajoute, eux, se posent à son propre niveau et ne se transmettent pas.
    pub(super) fn overlay(&mut self, outer: &Structure) {
        self.removed.extend(outer.removed.iter().copied());
    }

    /// Un nombre nul ne s'écrit pas : le rapport ne nomme que ce qui est arrivé.
    pub(super) fn report(&self, scene: &mut Scene) {
        if !self.removed.is_empty() {
            scene.count("componentsRemoved", self.removed.len());
        }
        scene.report.add_count(ADDED_COMPONENT, self.components);
    }
}
