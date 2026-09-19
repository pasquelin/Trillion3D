//! Shading graph as `connectAttr` writes it: who lights what, and with which image.
//!
//! Maya does not put a material on a mesh: it puts the mesh in a set, the `shadingEngine`, whose
//! shader is the surface. The file therefore writes two connections — the shader to the set's
//! `.ss`, and the mesh's `.iog` (`instObjGroups`) to the set's `.dsm` (`dagSetMembers`). A
//! connection that starts from an object group, `.iog[i].og[j]`, carries only part of the faces:
//! those the group's `.gcl` component list names, and they make a primitive of their own.
use super::*;

/// Binding of a material to a mesh, whole or on part of its faces.
pub(super) struct Bind {
    /// Shader node, or `None` when the set carries none that this driver converts.
    pub(super) shader: Option<usize>,
    /// Faces this binding claims. `None` claims everything no other binding has taken.
    pub(super) faces: Option<Vec<usize>>,
}

/// What the file's connections say, once resolved by name.
pub(super) struct Graph {
    /// Bindings of each mesh, by node rank.
    pub(super) binds: HashMap<usize, Vec<Bind>>,
    /// Source of each wired input: `(node, attribute)` to `(source node, attribute)`.
    inputs: HashMap<(usize, String), (usize, String)>,
}

/// Resolves the document's connections. Nothing is converted yet: this is a reading of names.
pub(super) fn resolve(document: &mut Document) -> Graph {
    let mut inputs = HashMap::new();
    let mut surfaces: HashMap<usize, usize> = HashMap::new();
    let mut members: Vec<(usize, usize, Option<String>)> = Vec::new();
    // Both ends of each connection are resolved first: a name there is a scene path, and
    // resolving it counts what is ambiguous, so it touches the document report.
    let ends: Vec<Option<(usize, usize)>> = (0..document.links.len())
        .map(|rank| {
            let (source, target) = (
                document.links[rank].source.clone(),
                document.links[rank].target.clone(),
            );
            document.find(&source).zip(document.find(&target))
        })
        .collect();
    for (link, ends) in document.links.iter().zip(&ends) {
        let Some((source, target)) = *ends else {
            continue;
        };
        let into = root(&link.target_attr);
        match into {
            "ss" | "surfaceShader" => {
                surfaces.insert(target, source);
            }
            "dsm" | "dagSetMembers" => {
                members.push((source, target, group(&link.source_attr)));
            }
            _ => {
                inputs.insert(
                    (target, into.to_string()),
                    (source, root(&link.source_attr).to_string()),
                );
            }
        }
    }
    let binds = bind(document, &surfaces, &members);
    Graph { binds, inputs }
}

/// Bindings per mesh, each object group yielding its faces.
fn bind(
    document: &mut Document,
    surfaces: &HashMap<usize, usize>,
    members: &[(usize, usize, Option<String>)],
) -> HashMap<usize, Vec<Bind>> {
    let mut out: HashMap<usize, Vec<Bind>> = HashMap::new();
    let mut refused = 0;
    for (mesh, engine, group) in members {
        let shader = surfaces
            .get(engine)
            .copied()
            .filter(|shader| report::is_shader(&document.nodes[*shader].kind));
        if shader.is_none() && surfaces.contains_key(engine) {
            document.report.add(report::MATERIAL_UNSUPPORTED);
        }
        let faces = group.as_ref().map(|key| {
            let list = document.nodes[*mesh]
                .attrs
                .get(&format!("{key}.gcl"))
                .map_or(&[][..], Attr::texts);
            let (faces, unusable) = faces::components(list);
            refused += unusable + usize::from(faces.is_empty());
            faces
        });
        out.entry(*mesh).or_default().push(Bind { shader, faces });
    }
    document
        .report
        .add_count(report::FACE_MATERIAL_INVALID, refused);
    out
}

impl Graph {
    /// Node wired onto this input of a node, and the attribute by which it comes out.
    pub(super) fn input(&self, node: usize, names: &[&str]) -> Option<(usize, &str)> {
        names.iter().find_map(|name| {
            self.inputs
                .get(&(node, (*name).to_string()))
                .map(|(source, attribute)| (*source, attribute.as_str()))
        })
    }
}

/// Name of an attribute without its index or sub-attributes: `iog[0].og[1]` yields `iog`.
fn root(attribute: &str) -> &str {
    let head = attribute.split('.').next().unwrap_or(attribute);
    head.split('[').next().unwrap_or(head)
}

/// Key of the object group a source `iog[i].og[j]` names, as `setAttr` writes it on the mesh. A
/// source without a group claims the whole mesh. Maya leaves the instance index implicit in a
/// connection and writes it in a `setAttr`: absence therefore equals zero on both sides.
fn group(attribute: &str) -> Option<String> {
    let mut segments = attribute.split('.');
    let instance = segments.next()?;
    let object = segments.next()?;
    (root(instance) == "iog" && root(object) == "og")
        .then(|| format!("iog[{}].og[{}]", index(instance), index(object)))
}

/// Index written in brackets on an attribute segment, zero when it is left implicit.
fn index(segment: &str) -> usize {
    segment
        .split_once('[')
        .and_then(|(_, rest)| rest.trim_end_matches(']').parse().ok())
        .unwrap_or(0)
}
