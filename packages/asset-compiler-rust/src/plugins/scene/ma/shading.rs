//! Le graphe de nuançage tel que `connectAttr` l'écrit : qui éclaire quoi, et avec quelle image.
//!
//! Maya ne pose pas un matériau sur un maillage : il met le maillage dans un ensemble, le
//! `shadingEngine`, dont un nuanceur est la surface. Le fichier écrit donc deux liaisons — le
//! nuanceur vers `.ss` de l'ensemble, et le `.iog` (`instObjGroups`) du maillage vers `.dsm`
//! (`dagSetMembers`) de l'ensemble. Une liaison partie d'un groupe d'objets, `.iog[i].og[j]`, ne
//! porte qu'une partie des faces : ce sont celles que la liste de composants `.gcl` du groupe
//! nomme, et elles font une primitive à part.
use super::*;

/// La liaison d'un matériau à un maillage, entière ou sur une partie de ses faces.
pub(super) struct Bind {
    /// Le nœud nuanceur, ou `None` quand l'ensemble n'en porte aucun que ce pilote convertisse.
    pub(super) shader: Option<usize>,
    /// Les faces que cette liaison réclame. `None` réclame tout ce qu'aucune autre n'a pris.
    pub(super) faces: Option<Vec<usize>>,
}

/// Ce que les liaisons du fichier disent, une fois résolues par nom.
pub(super) struct Graph {
    /// Les liaisons de chaque maillage, par rang de nœud.
    pub(super) binds: HashMap<usize, Vec<Bind>>,
    /// La source de chaque entrée branchée : `(nœud, attribut)` vers `(nœud source, attribut)`.
    inputs: HashMap<(usize, String), (usize, String)>,
}

/// Résout les liaisons du document. Rien n'y est encore converti : c'est une lecture de noms.
pub(super) fn resolve(document: &mut Document) -> Graph {
    let mut inputs = HashMap::new();
    let mut surfaces: HashMap<usize, usize> = HashMap::new();
    let mut members: Vec<(usize, usize, Option<String>)> = Vec::new();
    // Les deux bouts de chaque liaison sont résolus d'abord : un nom y est un chemin de scène, et
    // le résoudre compte ce qu'il a d'ambigu, donc il touche au rapport du document.
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

/// Les liaisons par maillage, chaque groupe d'objets rendant ses faces.
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
    /// Le nœud branché sur cette entrée d'un nœud, et l'attribut par lequel il sort.
    pub(super) fn input(&self, node: usize, names: &[&str]) -> Option<(usize, &str)> {
        names.iter().find_map(|name| {
            self.inputs
                .get(&(node, (*name).to_string()))
                .map(|(source, attribute)| (*source, attribute.as_str()))
        })
    }
}

/// Le nom d'un attribut sans son indice ni ses sous-attributs : `iog[0].og[1]` rend `iog`.
fn root(attribute: &str) -> &str {
    let head = attribute.split('.').next().unwrap_or(attribute);
    head.split('[').next().unwrap_or(head)
}

/// La clé du groupe d'objets qu'une source `iog[i].og[j]` désigne, telle que `setAttr` l'écrit sur
/// le maillage. Une source sans groupe réclame le maillage entier. Maya laisse l'indice d'instance
/// implicite dans une liaison et l'écrit dans un `setAttr` : l'absence vaut donc zéro des deux côtés.
fn group(attribute: &str) -> Option<String> {
    let mut segments = attribute.split('.');
    let instance = segments.next()?;
    let object = segments.next()?;
    (root(instance) == "iog" && root(object) == "og")
        .then(|| format!("iog[{}].og[{}]", index(instance), index(object)))
}

/// L'indice écrit entre crochets sur un segment d'attribut, zéro quand il est laissé implicite.
fn index(segment: &str) -> usize {
    segment
        .split_once('[')
        .and_then(|(_, rest)| rest.trim_end_matches(']').parse().ok())
        .unwrap_or(0)
}
