//! Le parcours du document : la hiérarchie des `transform`, leurs formes, et la racine de la scène.
//!
//! Un `transform` de Maya porte la pose ; c'est sa forme fille, le nœud `mesh`, qui porte la
//! géométrie. Un nœud glTF réunit les deux quand il n'y en a qu'une, et prend un enfant par forme
//! supplémentaire — dont celles qu'un `parent -add` lui accroche, qui citent alors le même maillage
//! glTF que leur transform d'origine : ce sont des instances, et la géométrie n'est écrite qu'une
//! fois. Un transform invisible n'est pas parcouru : ce que le fichier cache ne s'affiche pas.
use super::*;

mod shape;

/// Profondeur maximale d'une hiérarchie : un fichier dont les pères bouclent ne fait pas déborder
/// la pile, il est coupé et compté.
const MAX_DEPTH: usize = 256;

/// Ce qu'un parcours a sous la main : le document lu, son graphe de nuançage, et la scène en cours.
pub(super) struct World<'a> {
    pub(super) document: &'a Document,
    pub(super) graph: &'a Graph,
    pub(super) scene: &'a mut Scene,
    /// Le dossier contre lequel les URI relatives d'images se résolvent, `scene::image_root`.
    pub(super) images: &'a Path,
    /// Les enfants de chaque nœud du document, par rang de père.
    kids: Vec<Vec<usize>>,
    /// Les formes qu'un `parent -add` accroche à chaque nœud, par rang d'hôte.
    added: Vec<Vec<usize>>,
    /// Les matériaux déjà construits, par rang de nœud nuanceur.
    pub(super) materials: HashMap<usize, Option<usize>>,
    /// Les maillages déjà construits, par rang de nœud `mesh`.
    pub(super) meshes: HashMap<usize, Option<usize>>,
    /// Les nœuds glTF qui n'héritent pas de leur père : la racine de la scène les reprend.
    detached: Vec<usize>,
    pub(super) cancelled: &'a AtomicBool,
}

impl World<'_> {
    /// Compte un refus nommé une fois.
    pub(super) fn refuse(&mut self, reason: &str) {
        self.scene.report.add(reason);
    }
}

/// Remplit les tables de la scène depuis le document.
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

/// Le nœud glTF d'un `transform` et de sa descendance, ou rien quand il ne porte aucune surface.
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
    // Les enfants sont posés avant leur père : un nœud glTF cite ses enfants par leur rang.
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
    // Un nœud qui n'hérite pas de son père se pose dans le repère de la scène : la racine le
    // reprend, elle qui ne porte que l'unité du fichier, et son père ne le cite pas.
    if !xform::inherits(entry) {
        world.detached.push(rank);
        return None;
    }
    Some(rank)
}
