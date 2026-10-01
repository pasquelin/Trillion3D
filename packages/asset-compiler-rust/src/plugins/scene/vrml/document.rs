//! Bounded VRML97 token stream and node arena; USE retains graph identity without cloning trees.
use super::*;
#[derive(Clone, Debug)]
pub(super) enum Value {
    Numbers(Vec<f64>),
    Text(String),
    Bool(bool),
    Node(usize),
    List(Vec<Value>),
    Null,
}
pub(super) struct Node {
    pub kind: String,
    pub name: Option<String>,
    pub fields: BTreeMap<String, Value>,
}
pub(super) struct Document {
    pub nodes: Vec<Node>,
    pub roots: Vec<usize>,
}
struct Parser {
    tokens: Vec<String>,
    at: usize,
    document: Document,
    definitions: BTreeMap<String, usize>,
}
impl Parser {
    fn take(&mut self) -> Result<String> {
        let token = self
            .tokens
            .get(self.at)
            .cloned()
            .ok_or_else(|| source::invalid("vrml", "unexpected end"))?;
        self.at += 1;
        Ok(token)
    }
    fn expect(&mut self, want: &str) -> Result<()> {
        if self.take()? != want {
            return Err(source::invalid("vrml", format!("expected {want}")));
        }
        Ok(())
    }
    fn value(&mut self, depth: usize) -> Result<Value> {
        if depth >= 64 {
            return Err(source::invalid("vrml", "node nesting exceeds 64"));
        }
        let token = self.take()?;
        match token.as_str() {
            "[" => {
                let mut values = Vec::new();
                while self.tokens.get(self.at).is_some_and(|s| s != "]") {
                    values.push(self.value(depth + 1)?);
                }
                self.expect("]")?;
                Ok(Value::List(values))
            }
            "TRUE" => Ok(Value::Bool(true)),
            "FALSE" => Ok(Value::Bool(false)),
            "NULL" => Ok(Value::Null),
            "USE" => {
                let name = self.take()?;
                self.definitions
                    .get(&name)
                    .copied()
                    .map(Value::Node)
                    .ok_or_else(|| source::invalid("vrml", "USE of undefined node"))
            }
            "DEF" => {
                let name = self.take()?;
                let kind = self.take()?;
                self.node(kind, Some(name), depth)
            }
            _ => {
                if token.starts_with('"') {
                    return Ok(Value::Text(token[1..token.len() - 1].to_owned()));
                }
                if let Ok(number) = token.parse::<f64>() {
                    let mut numbers = vec![number];
                    while let Some(next) =
                        self.tokens.get(self.at).and_then(|s| s.parse::<f64>().ok())
                    {
                        numbers.push(next);
                        self.at += 1;
                    }
                    if numbers.iter().any(|n| !n.is_finite()) {
                        return Err(source::invalid("vrml", "non-finite number"));
                    }
                    return Ok(Value::Numbers(numbers));
                }
                self.node(token, None, depth)
            }
        }
    }
    fn node(&mut self, kind: String, name: Option<String>, depth: usize) -> Result<Value> {
        if matches!(kind.as_str(), "PROTO" | "EXTERNPROTO" | "ROUTE" | "Script") {
            return Err(source::unsupported("vrml", kind));
        }
        self.expect("{")?;
        let rank = self.document.nodes.len();
        self.document.nodes.push(Node {
            kind,
            name: name.clone(),
            fields: BTreeMap::new(),
        });
        if let Some(name) = name {
            if self.definitions.insert(name, rank).is_some() {
                return Err(source::invalid("vrml", "duplicate DEF"));
            }
        }
        while self.tokens.get(self.at).is_some_and(|s| s != "}") {
            let field = self.take()?;
            let value = self.value(depth + 1)?;
            if self.document.nodes[rank]
                .fields
                .insert(field, value)
                .is_some()
            {
                return Err(source::invalid("vrml", "duplicate field"));
            }
        }
        self.expect("}")?;
        Ok(Value::Node(rank))
    }
}
pub(super) fn parse(bytes: &[u8], request: &SceneRequest<'_>) -> Result<Document> {
    let text = std::str::from_utf8(bytes).map_err(|_| source::invalid("vrml", "invalid UTF-8"))?;
    if !text.starts_with("#VRML V2.0 utf8") {
        return Err(source::unsupported(
            "vrml",
            "only VRML97 V2.0 utf8 is supported",
        ));
    }
    let mut tokens = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        super::super::archive::check(request)?;
        if c == '#' {
            for c in chars.by_ref() {
                if c == '\n' {
                    break;
                }
            }
            continue;
        }
        if c.is_whitespace() || c == ',' {
            continue;
        }
        let mut token = c.to_string();
        if c == '"' {
            let mut closed = false;
            while let Some(c) = chars.next() {
                token.push(c);
                if c == '\\' {
                    token.push(
                        chars
                            .next()
                            .ok_or_else(|| source::invalid("vrml", "truncated escape"))?,
                    );
                } else if c == '"' {
                    closed = true;
                    break;
                }
            }
            if !closed {
                return Err(source::invalid("vrml", "unclosed string"));
            }
        } else if !"{}[]".contains(c) {
            while chars
                .peek()
                .is_some_and(|c| !c.is_whitespace() && !"{}[],#".contains(*c))
            {
                token.push(chars.next().unwrap());
            }
        }
        tokens.push(token);
        source::admit(
            tokens.len().saturating_mul(64),
            request.ram_budget / 4,
            "vrml",
        )?;
    }
    let mut parser = Parser {
        tokens,
        at: 0,
        document: Document {
            nodes: Vec::new(),
            roots: Vec::new(),
        },
        definitions: BTreeMap::new(),
    };
    while parser.at < parser.tokens.len() {
        let Value::Node(node) = parser.value(0)? else {
            return Err(source::invalid("vrml", "root is not a node"));
        };
        parser.document.roots.push(node);
    }
    Ok(parser.document)
}
