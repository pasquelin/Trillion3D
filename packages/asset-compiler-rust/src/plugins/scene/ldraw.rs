//! LDraw/MPD with confined part references, BFC winding and shared mesh instances.
use super::{mesh_source as source, SceneRequest};
use crate::{
    import::{SceneTables, Vertices},
    Result,
};
use serde_json::json;
use std::collections::BTreeMap;
mod colors;
#[cfg(test)]
mod dependencies_tests;
mod document;
mod geometry;
mod lines;
#[cfg(test)]
mod lines_tests;
mod parser;
#[cfg(test)]
mod tests;

pub(super) static LDRAW: source::FilePlugin = source::FilePlugin {
    name: "ldraw",
    version: "ldraw-1",
    extensions: &["ldr", "mpd", "dat"],
    magic: b"",
    read,
};
// One LDraw unit is 0.4 mm; root rotation maps LDraw's downwards Y into glTF Y-up.
const UNIT: f64 = 0.0004;
struct Reader<'a, 'b> {
    documents: document::Documents,
    colors: colors::Colors,
    request: &'a SceneRequest<'b>,
    meshes: BTreeMap<(String, String, bool, bool), Option<usize>>,
    materials: BTreeMap<String, usize>,
    payload: usize,
}
fn read(bytes: &[u8], request: &SceneRequest<'_>, scene: &mut SceneTables) -> Result<()> {
    let (documents, name) = document::Documents::new(bytes, request)?;
    let mut reader = Reader {
        documents,
        colors: colors::Colors::new(),
        request,
        meshes: BTreeMap::new(),
        materials: BTreeMap::new(),
        payload: 0,
    };
    let node = reader.place(&name, "7", false, false, &mut Vec::new(), scene)?;
    scene.nodes[node]["matrix"] = json!([1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]);
    Ok(())
}
impl Reader<'_, '_> {
    fn place(
        &mut self,
        name: &str,
        inherited: &str,
        inverted: bool,
        double: bool,
        path: &mut Vec<String>,
        scene: &mut SceneTables,
    ) -> Result<usize> {
        super::archive::check(self.request)?;
        let key = document::key(name)?;
        if path.len() >= 64 || path.contains(&key) {
            return Err(source::invalid("ldraw", "reference cycle/depth"));
        }
        source::admit(
            (scene.nodes.len() + 1).saturating_mul(512),
            self.request.ram_budget / 4,
            "ldraw",
        )?;
        path.push(key.clone());
        let text = self.documents.get(name, self.request, scene)?;
        let parent_colors = self.colors.clone();
        let model = parser::parse(&text, &mut self.colors, self.request)?;
        let mesh_key = (
            key.clone(),
            format!("{inherited}/{}", self.colors.signature()),
            inverted,
            double,
        );
        let mesh = if let Some(mesh) = self.meshes.get(&mesh_key) {
            *mesh
        } else {
            let mesh = self.geometry(&key, &model.faces, inherited, inverted, double, scene)?;
            let mesh = self.lines(&key, &model.lines, inherited, mesh, scene)?;
            self.meshes.insert(mesh_key, mesh);
            mesh
        };
        let mut children = Vec::new();
        for reference in model.references {
            let color = if reference.color == "16" {
                inherited
            } else {
                &reference.color
            };
            let child = self.place(
                &reference.name,
                color,
                inverted ^ reference.inverted,
                double || reference.double,
                path,
                scene,
            )?;
            scene.nodes[child]["matrix"] = json!(reference.matrix);
            children.push(child);
        }
        let mut node = json!({"name":key});
        if let Some(mesh) = mesh {
            node["mesh"] = json!(mesh);
        }
        if !children.is_empty() {
            node["children"] = json!(children);
        }
        self.colors = parent_colors;
        path.pop();
        Ok(scene.node(node))
    }
}
