//! Walk of the scene: GameObject, Transform, hierarchy, renderers and prefab instances.
//!
//! A GameObject carries components; only those that describe a surface are read — `MeshFilter`
//! and `MeshRenderer` — and the `Transform` hierarchy. Everything else (lights, cameras,
//! terrains, particles, colliders, scripts) is counted in the report and left aside: data,
//! never behaviour. A `LODGroup` keeps only its finest level; the others are counted.
use super::*;
use std::collections::{HashMap, HashSet};

const GAME_OBJECT: u32 = 1;
const TRANSFORM: u32 = 4;
const RECT_TRANSFORM: u32 = 224;
const LOD_GROUP: u32 = 205;
const PREFAB_INSTANCE: u32 = 1001;
/// Known components this driver does not yield: they are counted under this name.
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
/// Maximum depth of a hierarchy, nested prefabs included.
const MAX_DEPTH: usize = 64;

pub(super) struct Builder<'a, 'w> {
    pub(super) world: &'a mut World<'w>,
    pub(super) models: Models,
    pub(super) textures: Textures,
    pub(super) builtins: Builtins,
    pub(super) materials: HashMap<String, Option<usize>>,
    pub(super) documents: HashMap<PathBuf, Rc<Document>>,
    /// Meshes already bound to a material sequence: per model mesh, the variant each requested
    /// material sequence received.
    pub(super) bound: HashMap<usize, HashMap<Vec<Option<usize>>, usize>>,
    /// Model meshes that a first binding has already taken.
    pub(super) claimed: HashSet<usize>,
    /// Model mesh as it was before its first binding, set aside so later ones start from the
    /// original and not from the variant placed in situ.
    pub(super) pristine: HashMap<usize, Value>,
    /// Node written for each walked object, by `fileID` of its transform and of its GameObject:
    /// that is where what an instance adds under it sits.
    pub(super) placed: HashMap<i64, usize>,
}

impl Builder<'_, '_> {
    /// Roots of a file: transforms without a parent, and prefab instances that are hung on
    /// nothing. The rest is reached through children.
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

    /// Builds the node of a transform and its descendants. `changes` carries the overrides of
    /// the prefab instance being unfolded: each names the object it targets, so it applies at
    /// the depth where that object is found.
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
        // The object an instance adds names the source object under which it sits, by the
        // `fileID` of its transform or by that of its GameObject: both lead here.
        self.placed.insert(id, index);
        self.placed.insert(object_id, index);
        Some(index)
    }

    /// Components of a GameObject: class and fileID, in declared order. Those a prefab instance
    /// removes are not part of them: for the walk, they do not exist.
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

    /// Renderers a `LODGroup` drops: those its finest level does not cite. The same renderer
    /// can appear at several levels; it is then kept at the most detailed where it appears,
    /// because dropping it would remove from the finest level a surface the scene shows there.
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
            let levels = sequence(&group.body, "m_LODs");
            let kept: HashSet<i64> = levels
                .first()
                .map(|level| renderers(level).collect())
                .unwrap_or_default();
            for level in levels.iter().skip(1) {
                for id in renderers(level).filter(|id| !kept.contains(id)) {
                    dropped.insert(id);
                    self.world.scene.count("lodDropped", 1);
                }
            }
        }
        dropped
    }
}

/// Renderers a `LODGroup` level cites, by `fileID`.
fn renderers(level: &Yaml) -> impl Iterator<Item = i64> + '_ {
    sequence(level, "renderers")
        .iter()
        .map(|renderer| reference(&renderer["renderer"]).file_id)
}
