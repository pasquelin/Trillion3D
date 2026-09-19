//! The document as read: nodes, their attributes, their connections, and the scene unit.
//!
//! The document is the file as written, not yet a scene: no geometry is built there, no material
//! is converted. Commands apply one by one, in writing order, because a `setAttr` without a node
//! name addresses the node the previous command created or selected. Anything outside the subset
//! is counted by name.
use super::*;

mod edit;
mod path;

/// A node of the file: its type, its name, its path, its parent, and its written attributes.
pub(super) struct Node {
    pub(super) kind: String,
    pub(super) name: String,
    /// Full path of the node in the scene, `|A|M`, which alone identifies it: two nodes of the
    /// same short name under two different parents are two nodes, and Maya distinguishes them
    /// that way.
    pub(super) path: String,
    pub(super) parent: Option<usize>,
    pub(super) attrs: HashMap<String, Attr>,
}

impl Node {
    /// Attribute one of these names refers to. `setAttr` accepts the short name as well as the
    /// long, and a real file mixes both: both writings are therefore looked up together.
    pub(super) fn attr(&self, names: &[&str]) -> Option<&Attr> {
        names.iter().find_map(|name| self.attrs.get(*name))
    }
}

/// A connection written by `connectAttr`, nodes and attributes as they are named there.
pub(super) struct Link {
    pub(super) source: String,
    pub(super) source_attr: String,
    pub(super) target: String,
    pub(super) target_attr: String,
}

/// The file read in full.
pub(super) struct Document {
    pub(super) nodes: Vec<Node>,
    /// Ranks of the nodes of each short name, in the order the file writes them.
    by_name: HashMap<String, Vec<usize>>,
    pub(super) links: Vec<Link>,
    /// Shapes a `parent -add` hangs under a second transform: `(transform, shape)`.
    pub(super) instances: Vec<(usize, usize)>,
    /// Factor of the file's linear unit into metres. Maya writes centimetres by default.
    pub(super) meters_per_unit: f64,
    /// Factor of the file's angular unit into degrees.
    pub(super) degrees_per_unit: f64,
    pub(super) report: Report,
    /// Node a nameless `setAttr` applies to.
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

/// Reads the text of a Maya ASCII file. A command outside the subset is counted by name and
/// left: this reader is not an interpreter, it executes none.
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
    /// Applies a command. The name decides; everything else is counted.
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

    /// Counts a named reason after what the file was writing, without ever executing it.
    fn count(&mut self, reason: &str, what: &str) {
        self.report.add(&format!("{reason}:{what}"));
    }
}

/// Name of a node at the end of a scene path: Maya writes `|parent|child` in a connection and the
/// short name alone in the `createNode` that made it. It is the short name that brings them together.
pub(super) fn leaf(name: &str) -> &str {
    name.rsplit('|').next().unwrap_or(name)
}
