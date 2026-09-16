//! Le parcours de la scène : GameObject, Transform, hiérarchie, rendus et instances de prefab.
//!
//! Un GameObject porte des composants ; on ne lit que ceux qui décrivent une surface — `MeshFilter`
//! et `MeshRenderer` — et la hiérarchie des `Transform`. Tout le reste (lampes, caméras, terrains,
//! particules, colliders, scripts) est compté au rapport et laissé de côté : des données, jamais un
//! comportement. Un `LODGroup` ne garde que son niveau le plus fin ; les autres sont comptés.
use super::*;
use std::collections::{HashMap, HashSet};

const GAME_OBJECT: u32 = 1;
const TRANSFORM: u32 = 4;
const RECT_TRANSFORM: u32 = 224;
const LOD_GROUP: u32 = 205;
const PREFAB_INSTANCE: u32 = 1001;
/// Les composants connus que ce pilote ne rend pas : ils sont comptés sous ce nom.
const IGNORED: [(u32, &str); 8] = [
    (20, "unity-camera"),
    (108, "unity-light"),
    (114, "unity-script"),
    (137, "unity-skinned-renderer"),
    (198, "unity-particles"),
    (199, "unity-particles"),
    (212, "unity-sprite-renderer"),
    (218, "unity-terrain"),
];
/// Profondeur maximale d'une hiérarchie, prefabs imbriqués compris.
const MAX_DEPTH: usize = 64;

pub(super) struct Builder<'a, 'w> {
    pub(super) world: &'a mut World<'w>,
    pub(super) models: Models,
    pub(super) textures: Textures,
    pub(super) builtins: Builtins,
    pub(super) materials: HashMap<String, Option<usize>>,
    pub(super) documents: HashMap<PathBuf, Rc<Document>>,
    /// Les maillages déjà liés à une suite de matériaux : la clé est le maillage du modèle et les
    /// matériaux que l'instance demande.
    pub(super) bound: HashMap<(usize, Vec<Option<usize>>), usize>,
    /// Les maillages de modèle qu'une première liaison a déjà pris.
    pub(super) claimed: HashSet<usize>,
    /// Le maillage du modèle tel qu'il était avant sa première liaison, mis de côté pour que les
    /// suivantes partent de l'original et non de la variante posée sur place.
    pub(super) pristine: HashMap<usize, Value>,
    /// Le nœud écrit pour chaque objet parcouru, par `fileID` de sa transformation et de son
    /// GameObject : c'est là que se pose ce qu'une instance ajoute sous lui.
    pub(super) placed: HashMap<i64, usize>,
}

impl Builder<'_, '_> {
    /// Les racines d'un fichier : les transformations sans père, et les instances de prefab qui ne
    /// sont accrochées à rien. Le reste est atteint par les enfants.
    pub(super) fn roots(document: &Document) -> Vec<i64> {
        let mut roots = Vec::new();
        for class in [TRANSFORM, RECT_TRANSFORM] {
            roots.extend(document.of_class(class).filter_map(|(id, entry)| {
                (!entry.stripped && reference(&entry.body["m_Father"]).is_null()).then_some(id)
            }));
        }
        roots.extend(
            document
                .of_class(PREFAB_INSTANCE)
                .filter_map(|(id, entry)| {
                    let parent = reference(&entry.body["m_Modification"]["m_TransformParent"]);
                    parent.is_null().then_some(id)
                }),
        );
        roots
    }

    /// Construit le nœud d'une transformation et de sa descendance. `changes` porte les retouches de
    /// l'instance de prefab en cours de dépliage : chacune nomme l'objet qu'elle vise, donc elle
    /// s'applique à la profondeur où cet objet se trouve.
    pub(super) fn transform(
        &mut self,
        document: &Rc<Document>,
        id: i64,
        dropped: &HashSet<i64>,
        changes: &Changes,
        depth: usize,
    ) -> Option<usize> {
        if depth > MAX_DEPTH {
            self.world.scene.report.add("unity-hierarchy-too-deep");
            return None;
        }
        self.world.check()?;
        let entry = document.get(id)?;
        if entry.class_id == PREFAB_INSTANCE {
            return self.prefab_instance(document, id, changes, depth);
        }
        if entry.stripped {
            let instance = reference(&entry.body["m_PrefabInstance"]).file_id;
            return self.prefab_instance(document, instance, changes, depth);
        }
        let object_id = reference(&entry.body["m_GameObject"]).file_id;
        let object = document.get(object_id)?;
        if object.class_id != GAME_OBJECT {
            return None;
        }
        let active = changes
            .active(object_id)
            .unwrap_or(number_at(&object.body, "m_IsActive", 1.0) != 0.0);
        if !active {
            self.world.scene.count("inactive", 1);
            return None;
        }
        let components = self.components(document, &object.body, changes);
        let dropped = &self.dropped_renderers(document, &components, dropped);
        let mut node = json!({"name":object.body["m_Name"].as_str().unwrap_or("GameObject")});
        let empty = Overrides::new();
        let trs = local_trs(&entry.body, changes.transform(id).unwrap_or(&empty));
        if trs.is_finite() {
            trs.write(&mut node);
        } else {
            self.world.scene.report.add("unity-invalid-transform");
        }
        let mut children = self.render(document, &components, dropped, changes, &mut node);
        for child in sequence(&entry.body, "m_Children") {
            let child = reference(child).file_id;
            if let Some(index) = self.transform(document, child, dropped, changes, depth + 1) {
                children.push(index);
            }
        }
        if !children.is_empty() {
            node["children"] = json!(children);
        }
        self.world.scene.count("gameObjects", 1);
        let index = self.world.scene.node(node);
        // L'objet qu'une instance ajoute nomme celui de la source sous lequel il se pose, par le
        // `fileID` de sa transformation ou par celui de son GameObject : les deux mènent ici.
        self.placed.insert(id, index);
        self.placed.insert(object_id, index);
        Some(index)
    }

    /// Les composants d'un GameObject : classe et fileID, dans l'ordre déclaré. Ceux qu'une
    /// instance de prefab retire n'en font pas partie : pour le parcours, ils n'existent pas.
    fn components(
        &mut self,
        document: &Document,
        object: &Yaml,
        changes: &Changes,
    ) -> Vec<(u32, i64)> {
        let mut out = Vec::new();
        for component in sequence(object, "m_Component") {
            let id = reference(&component["component"]).file_id;
            let Some(entry) = document.get(id).filter(|_| !changes.structure.removes(id)) else {
                continue;
            };
            if let Some((_, name)) = IGNORED.iter().find(|(class, _)| *class == entry.class_id) {
                self.world.scene.report.add(name);
            }
            out.push((entry.class_id, id));
        }
        out
    }

    /// Les rendus qu'un `LODGroup` écarte : tout sauf son niveau le plus fin.
    fn dropped_renderers(
        &mut self,
        document: &Document,
        components: &[(u32, i64)],
        inherited: &HashSet<i64>,
    ) -> HashSet<i64> {
        let mut dropped = inherited.clone();
        for (_, id) in components.iter().filter(|(class, _)| *class == LOD_GROUP) {
            let Some(group) = document.get(*id) else {
                continue;
            };
            for level in sequence(&group.body, "m_LODs").iter().skip(1) {
                for renderer in sequence(level, "renderers") {
                    dropped.insert(reference(&renderer["renderer"]).file_id);
                    self.world.scene.count("lodDropped", 1);
                }
            }
        }
        dropped
    }
}
