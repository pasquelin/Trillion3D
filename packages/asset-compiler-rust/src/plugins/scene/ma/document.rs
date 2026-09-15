//! Le document lu : les nœuds, leurs attributs, leurs liaisons, et l'unité de la scène.
//!
//! Le document est le fichier tel qu'il est écrit, pas encore une scène : aucune géométrie n'y est
//! construite, aucun matériau n'y est converti. Les commandes s'y appliquent une par une, dans leur
//! ordre d'écriture, parce qu'un `setAttr` sans nom de nœud s'adresse au nœud que la commande
//! précédente a créé ou sélectionné. Tout ce qui n'est pas du sous-ensemble est compté par son nom.
use super::*;

mod edit;

/// Un nœud du fichier : son type, son nom, son père, et ses attributs écrits.
pub(super) struct Node {
    pub(super) kind: String,
    pub(super) name: String,
    pub(super) parent: Option<usize>,
    pub(super) attrs: HashMap<String, Attr>,
}

impl Node {
    /// L'attribut que l'un de ces noms désigne. `setAttr` accepte le nom court comme le long, et un
    /// fichier réel mélange les deux : les deux écritures sont donc cherchées ensemble.
    pub(super) fn attr(&self, names: &[&str]) -> Option<&Attr> {
        names.iter().find_map(|name| self.attrs.get(*name))
    }
}

/// Une liaison écrite par `connectAttr`, nœuds et attributs tels qu'ils y sont nommés.
pub(super) struct Link {
    pub(super) source: String,
    pub(super) source_attr: String,
    pub(super) target: String,
    pub(super) target_attr: String,
}

/// Le fichier lu en entier.
pub(super) struct Document {
    pub(super) nodes: Vec<Node>,
    /// Le rang de chaque nœud par son nom.
    pub(super) by_name: HashMap<String, usize>,
    pub(super) links: Vec<Link>,
    /// Les formes qu'un `parent -add` accroche sous un second transform : `(transform, forme)`.
    pub(super) instances: Vec<(usize, usize)>,
    /// Le facteur de l'unité linéaire du fichier vers le mètre. Maya écrit le centimètre par défaut.
    pub(super) meters_per_unit: f64,
    /// Le facteur de l'unité angulaire du fichier vers le degré.
    pub(super) degrees_per_unit: f64,
    pub(super) report: Report,
    /// Le nœud auquel un `setAttr` sans nom s'applique.
    current: Option<usize>,
}

impl Default for Document {
    fn default() -> Self {
        Self {
            nodes: Vec::new(),
            by_name: HashMap::new(),
            links: Vec::new(),
            instances: Vec::new(),
            meters_per_unit: 0.01,
            degrees_per_unit: 1.0,
            report: Report::default(),
            current: None,
        }
    }
}

/// Lit le texte d'un fichier Maya ASCII. Une commande hors du sous-ensemble est comptée par son nom
/// et laissée : ce lecteur n'est pas un interpréteur, il n'en exécute aucune.
pub(super) fn read(text: &str) -> Result<Document> {
    if !text.starts_with(HEADER) {
        return Err(CompilerError::new(
            FILE_INVALID,
            format!("ma: the file does not open with `{HEADER}`"),
        ));
    }
    let mut out = Document::default();
    for statement in lex::read(text) {
        out.apply(Command::new(statement?));
    }
    Ok(out)
}

impl Document {
    /// Applique une commande. Le nom décide ; tout le reste est compté.
    fn apply(&mut self, command: Command) {
        match command.name.as_str() {
            "createNode" => self.create(&command),
            "setAttr" => self.set(&command),
            "connectAttr" => self.connect(&command),
            "currentUnit" => self.unit(&command),
            "parent" => self.reparent(&command),
            "select" => self.current = self.selected(&command),
            "requires" | "fileInfo" => {}
            other => self.count(report::COMMAND_IGNORED, other),
        }
    }

    /// Compte une raison nommée d'après ce que le fichier écrivait, sans jamais l'exécuter.
    fn count(&mut self, reason: &str, what: &str) {
        self.report.add(&format!("{reason}:{what}"));
    }
}

/// Le nom d'un nœud au bout d'un chemin de scène : Maya écrit `|pere|enfant` dans une liaison et le
/// seul nom court dans le `createNode` qui l'a fait. C'est le nom court qui les rapproche.
pub(super) fn leaf(name: &str) -> &str {
    name.rsplit('|').next().unwrap_or(name)
}
