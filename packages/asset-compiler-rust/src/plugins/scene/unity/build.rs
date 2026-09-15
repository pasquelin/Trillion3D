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
}

/// Ce qu'une instance de prefab remplace dans la transformation de sa racine.
pub(super) type Overrides = HashMap<String, f64>;

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

    /// Construit le nœud d'une transformation et de sa descendance.
    pub(super) fn transform(
        &mut self,
        document: &Rc<Document>,
        id: i64,
        dropped: &HashSet<i64>,
        overrides: &Overrides,
        depth: usize,
    ) -> Option<usize> {
        if depth > MAX_DEPTH {
            self.world.scene.report.add("unity-hierarchy-too-deep");
            return None;
        }
        self.world.check()?;
        let entry = document.get(id)?;
        if entry.class_id == PREFAB_INSTANCE {
            return self.prefab_instance(document, id, depth);
        }
        if entry.stripped {
            let instance = reference(&entry.body["m_PrefabInstance"]).file_id;
            return self.prefab_instance(document, instance, depth);
        }
        let object = document.get(reference(&entry.body["m_GameObject"]).file_id)?;
        if object.class_id != GAME_OBJECT {
            return None;
        }
        if number_at(&object.body, "m_IsActive", 1.0) == 0.0 {
            self.world.scene.count("inactive", 1);
            return None;
        }
        let components = self.components(document, &object.body);
        let dropped = &self.dropped_renderers(document, &components, dropped);
        let mut node = json!({"name":object.body["m_Name"].as_str().unwrap_or("GameObject")});
        let trs = local_trs(&entry.body, overrides);
        if trs.is_finite() {
            trs.write(&mut node);
        } else {
            self.world.scene.report.add("unity-invalid-transform");
        }
        let mut children = self.render(document, &components, dropped, &mut node);
        for child in sequence(&entry.body, "m_Children") {
            let child = reference(child).file_id;
            let empty = Overrides::new();
            if let Some(index) = self.transform(document, child, dropped, &empty, depth + 1) {
                children.push(index);
            }
        }
        if !children.is_empty() {
            node["children"] = json!(children);
        }
        self.world.scene.count("gameObjects", 1);
        Some(self.world.scene.node(node))
    }

    /// Les composants d'un GameObject : classe et fileID, dans l'ordre déclaré.
    fn components(&mut self, document: &Document, object: &Yaml) -> Vec<(u32, i64)> {
        let mut out = Vec::new();
        for component in sequence(object, "m_Component") {
            let id = reference(&component["component"]).file_id;
            let Some(entry) = document.get(id) else {
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
