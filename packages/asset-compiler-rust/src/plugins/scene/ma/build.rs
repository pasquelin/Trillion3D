//! Walk of the document: the `transform` hierarchy, their shapes, and the scene root.
//!
//! A Maya `transform` carries the pose; it is its child shape, the `mesh` node, that carries
//! the geometry. A glTF node unites the two when there is only one, and takes one child per
//! extra shape — including those a `parent -add` hangs on it, which then cite the same glTF
//! mesh as their original transform: they are instances, and the geometry is written only
//! once. An invisible transform is not walked: what the file hides is not displayed.
use super::*;

mod shape;

/// Maximum depth of a hierarchy: a file whose parents loop does not overflow the stack, it
/// is cut and counted.
const MAX_DEPTH: usize = 256;

/// What a walk has at hand: the document read, its shading graph, and the scene in progress.
pub(super) struct World<'a> {
    pub(super) document: &'a Document,
    pub(super) graph: &'a Graph,
    pub(super) scene: &'a mut Scene,
    /// Directory against which relative image URIs resolve, `scene::image_root`.
    pub(super) images: &'a Path,
    /// Children of each document node, by parent rank.
    kids: Vec<Vec<usize>>,
    /// Shapes a `parent -add` hangs on each node, by host rank.
    added: Vec<Vec<usize>>,
    /// Materials already built, by shader-node rank.
    pub(super) materials: HashMap<usize, Option<usize>>,
    /// Meshes already built, by `mesh` node rank.
    pub(super) meshes: HashMap<usize, Option<usize>>,
    /// glTF nodes that do not inherit from their parent: the scene root takes them back.
    detached: Vec<usize>,
    pub(super) cancelled: &'a AtomicBool,
}

impl World<'_> {
    /// Counts a named refusal once.
    pub(super) fn refuse(&mut self, reason: &str) {
        self.scene.report.add(reason);
    }
}

/// Fills the scene tables from the document.
pub(super) fn scene(
    document: &Document,
    graph: &Graph,
    scene: &mut Scene,
    request: &SceneRequest<'_>,
) {
    let images = crate::plugins::scene::image_root(request.source);
    let mut kids = vec![Vec::new(); document.nodes.len()];
    for (rank, node) in document.nodes.iter().enumerate() {
        if let Some(parent) = node.parent.filter(|parent| *parent != rank) {
            kids[parent].push(rank);
        }
    }
    let mut added = vec![Vec::new(); document.nodes.len()];
    for (host, shape) in &document.instances {
        added[*host].push(*shape);
    }
    let mut world = World {
        document,
        graph,
        scene,
        images: &images,
        kids,
        added,
        materials: HashMap::new(),
        meshes: HashMap::new(),
        detached: Vec::new(),
        cancelled: request.cancelled,
    };
    shape::ignored(&mut world);
    let mut children: Vec<usize> = (0..document.nodes.len())
        .filter(|node| document.nodes[*node].parent.is_none())
        .filter_map(|node| visit(&mut world, node, 0))
        .collect();
    children.append(&mut world.detached);
    (request.progress)(json!({"phase":"import-source","step":"nodes","plugin":NAME,
        "nodes":document.nodes.len(),"roots":children.len()}));
    world.scene.node(json!({
        "name": "ma-root",
        "matrix": xform::root(document.meters_per_unit),
        "children": children,
    }));
}

/// glTF node of a `transform` and its descendants, or nothing when it carries no surface.
fn visit(world: &mut World<'_>, node: usize, depth: usize) -> Option<usize> {
    if world.cancelled.load(Ordering::Relaxed) {
        return None;
    }
    if depth > MAX_DEPTH {
        world.refuse(report::HIERARCHY_TOO_DEEP);
        return None;
    }
    let document = world.document;
    let entry = &document.nodes[node];
    if !report::is_transform(&entry.kind) {
        return None;
    }
    if entry.attr(&["v", "visibility"]).and_then(Attr::flag) == Some(false) {
        world.scene.count("invisible", 1);
        return None;
    }
    let name = entry.name.clone();
    let matrix = xform::local(entry, document.degrees_per_unit, &mut world.scene.report);
    let meshes = shape::shapes(world, node);
    // Children are laid down before their parent: a glTF node cites its children by their rank.
    let mut children: Vec<usize> = meshes
        .iter()
        .skip(1)
        .map(|mesh| {
            let extra = json!({"name": format!("{name}|{mesh}"), "mesh": mesh});
            world.scene.node(extra)
        })
        .collect::<Vec<usize>>();
    for rank in 0..world.kids[node].len() {
        children.extend(visit(world, world.kids[node][rank], depth + 1));
    }
    let mut out = json!({ "name": name });
    if let Some(matrix) = matrix {
        out["matrix"] = json!(matrix);
    }
    match meshes.first() {
        Some(mesh) => out["mesh"] = json!(mesh),
        None if children.is_empty() => return None,
        None => {}
    }
    if !children.is_empty() {
        out["children"] = json!(children);
    }
    let rank = world.scene.node(out);
    // A node that does not inherit from its parent is posed in the scene's frame: the root
    // takes it back, it which only carries the file's unit, and its parent does not cite it.
    if !xform::inherits(entry) {
        world.detached.push(rank);
        return None;
    }
    Some(rank)
}
