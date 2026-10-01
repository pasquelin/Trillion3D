//! VRML transforms preserve centre and scale-orientation order using the compiler matrix helpers.
use super::*;
use crate::compiler_world::{axis_angle, product, scaling, translation, IDENTITY};
impl Reader<'_, '_> {
    pub(super) fn place(
        &mut self,
        id: usize,
        path: &mut Vec<usize>,
        scene: &mut SceneTables,
    ) -> Result<usize> {
        super::super::archive::check(self.request)?;
        if path.len() >= 64 || path.contains(&id) {
            return Err(source::invalid("vrml", "USE cycle/depth"));
        }
        source::admit(
            (scene.nodes.len() + 1).saturating_mul(512),
            self.request.ram_budget / 4,
            "vrml",
        )?;
        path.push(id);
        let node = &self.document.nodes[id];
        let mut out = json!({"name":node.name.as_deref().unwrap_or(&node.kind)});
        match node.kind.as_str() {
            "Shape" => {
                node.fields(&["appearance", "geometry"])?;
                if let Some(&mesh) = self.meshes.get(&id) {
                    out["mesh"] = json!(mesh);
                } else {
                    if let Some(geometry) = node.child("geometry")? {
                        let appearance = node.child("appearance")?;
                        let key = material::key(
                            appearance,
                            &self.document,
                            &self.document.nodes[geometry],
                        )?;
                        let material = if let Some(rank) = self.materials.get(&key) {
                            *rank
                        } else {
                            let rank = material::appearance(
                                appearance,
                                &self.document,
                                scene,
                                self.request,
                                self.document.nodes[geometry].kind == "IndexedLineSet",
                            )?;
                            self.materials.insert(key, rank);
                            rank
                        };
                        let mesh = self.geometry(geometry, material, scene)?;
                        self.meshes.insert(id, mesh);
                        out["mesh"] = json!(mesh);
                    }
                }
            }
            "Group" | "Transform" => {
                if node.kind == "Transform" {
                    node.fields(&[
                        "children",
                        "translation",
                        "rotation",
                        "scale",
                        "center",
                        "scaleOrientation",
                        "bboxCenter",
                        "bboxSize",
                    ])?;
                    out["matrix"] = json!(matrix(node)?);
                } else {
                    node.fields(&["children", "bboxCenter", "bboxSize"])?;
                }
                let children = children(node.fields.get("children"))?;
                let children = children
                    .into_iter()
                    .map(|child| self.place(child, path, scene))
                    .collect::<Result<Vec<_>>>()?;
                out["children"] = json!(children);
            }
            "WorldInfo" => {
                node.fields(&["title", "info"])?;
                if let Some(document::Value::Text(title)) = node.fields.get("title") {
                    out["extras"] = json!({"vrmlTitle":title});
                }
            }
            other => return Err(source::unsupported("vrml", format!("node {other}"))),
        }
        path.pop();
        Ok(scene.node(out))
    }
}
fn children(value: Option<&document::Value>) -> Result<Vec<usize>> {
    match value {
        None => Ok(Vec::new()),
        Some(document::Value::Node(n)) => Ok(vec![*n]),
        Some(document::Value::List(values)) => values
            .iter()
            .map(|v| match v {
                document::Value::Node(n) => Ok(*n),
                _ => Err(source::invalid("vrml", "non-node child")),
            })
            .collect(),
        _ => Err(source::invalid("vrml", "invalid children")),
    }
}
fn matrix(node: &document::Node) -> Result<[f64; 16]> {
    let t = node.number_array("translation", [0.; 3])?;
    let c = node.number_array("center", [0.; 3])?;
    let r = node.number_array("rotation", [0., 0., 1., 0.])?;
    let sr = node.number_array("scaleOrientation", [0., 0., 1., 0.])?;
    let s = node.number_array("scale", [1.; 3])?;
    if s.iter().any(|s| *s <= 0.) {
        return Err(source::invalid("vrml", "scale must be positive"));
    }
    let rotation = |v: [f64; 4], sign: f64| -> Result<[f64; 16]> {
        let axis = crate::shared_math::unit([v[0], v[1], v[2]])
            .ok_or_else(|| source::invalid("vrml", "zero rotation axis"))?;
        Ok(axis_angle(axis, v[3] * sign))
    };
    let mut out = IDENTITY;
    for part in [
        translation(c.map(|v| -v)),
        rotation(sr, -1.)?,
        scaling(s),
        rotation(sr, 1.)?,
        rotation(r, 1.)?,
        translation(c),
        translation(t),
    ] {
        out = product(&part, &out);
    }
    for v in out {
        source::finite(v, "vrml")?;
    }
    Ok(out)
}
