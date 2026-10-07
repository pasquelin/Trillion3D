//! The path dependencies a manifest links into the build, read from its TOML as cargo reads it:
//! inline, dotted or as a table of their own, whatever the spacing and the line breaks.

/// A value as far as a dependency's `path` needs it: a string, a table, or anything else.
enum Value {
    Text(String),
    Table(Vec<(Vec<String>, Value)>),
    Other,
}

struct Reader {
    chars: Vec<char>,
    at: usize,
}

impl Reader {
    fn peek(&self) -> Option<char> {
        self.chars.get(self.at).copied()
    }

    fn starts(&self, text: &str) -> bool {
        text.chars()
            .enumerate()
            .all(|(i, c)| self.chars.get(self.at + i) == Some(&c))
    }

    /// Past blanks, line breaks and comments.
    fn space(&mut self) {
        while let Some(c) = self.peek() {
            match c {
                ' ' | '\t' | '\r' | '\n' => self.at += 1,
                '#' => {
                    while self.peek().is_some_and(|c| c != '\n') {
                        self.at += 1;
                    }
                }
                _ => break,
            }
        }
    }

    /// A string, basic or literal, on one line or three-quoted on several; escapes kept as written
    /// but for the quote and the backslash, which a path never needs otherwise.
    fn text(&mut self, quote: char) -> String {
        let fence: String = [quote; 3].iter().collect();
        let long = self.starts(&fence);
        self.at += if long { 3 } else { 1 };
        let mut out = String::new();
        while let Some(c) = self.peek() {
            if (long && self.starts(&fence)) || (!long && c == quote) {
                self.at += if long { 3 } else { 1 };
                break;
            }
            self.at += 1;
            if c == '\\' && quote == '"' {
                if let Some(next) = self.peek() {
                    self.at += 1;
                    out.push(next);
                }
            } else {
                out.push(c);
            }
        }
        out
    }

    /// A dotted key: bare or quoted parts joined by `.`.
    fn key(&mut self) -> Vec<String> {
        let mut parts = Vec::new();
        loop {
            self.space();
            match self.peek() {
                Some(quote @ ('"' | '\'')) => parts.push(self.text(quote)),
                _ => {
                    let start = self.at;
                    while self
                        .peek()
                        .is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '-')
                    {
                        self.at += 1;
                    }
                    parts.push(self.chars[start..self.at].iter().collect());
                }
            }
            self.space();
            if self.peek() != Some('.') {
                return parts;
            }
            self.at += 1;
        }
    }

    fn value(&mut self) -> Value {
        self.space();
        match self.peek() {
            Some(quote @ ('"' | '\'')) => Value::Text(self.text(quote)),
            Some(open @ ('{' | '[')) => {
                let close = if open == '{' { '}' } else { ']' };
                self.at += 1;
                let mut items = Vec::new();
                loop {
                    self.space();
                    match self.peek() {
                        None => break,
                        Some(c) if c == close => {
                            self.at += 1;
                            break;
                        }
                        Some(',') => self.at += 1,
                        Some(_) if open == '[' => drop(self.value()),
                        Some(_) => {
                            let start = self.at;
                            let key = self.key();
                            if self.peek() == Some('=') {
                                self.at += 1;
                                items.push((key, self.value()));
                            } else if self.at == start {
                                self.at += 1;
                            }
                        }
                    }
                }
                if open == '{' {
                    Value::Table(items)
                } else {
                    Value::Other
                }
            }
            _ => {
                let end = |c: char| c.is_whitespace() || matches!(c, ',' | '}' | ']' | '#');
                while self.peek().is_some_and(|c| !end(c)) {
                    self.at += 1;
                }
                Value::Other
            }
        }
    }
}

/// Every string of `value` under its full key from the document's root.
fn flatten(key: Vec<String>, value: Value, into: &mut Vec<(Vec<String>, String)>) {
    match value {
        Value::Text(text) => into.push((key, text)),
        Value::Table(items) => {
            for (inner, value) in items {
                flatten([key.clone(), inner].concat(), value, into);
            }
        }
        Value::Other => {}
    }
}

/// The `path` of every dependency `manifest` links into the build — those of `[dependencies]` and
/// `[build-dependencies]`, of a target's too, never of `[dev-dependencies]` —, as written:
/// `name = { path = "…" }` on one line or several, `name.path = "…"`, or `path = "…"` in a
/// `[dependencies.name]` table.
pub fn dependency_paths(manifest: &str) -> Vec<String> {
    let mut reader = Reader {
        chars: manifest.chars().collect(),
        at: 0,
    };
    let mut table = Vec::new();
    let mut strings = Vec::new();
    loop {
        reader.space();
        let Some(c) = reader.peek() else { break };
        let start = reader.at;
        if c == '[' {
            reader.at += if reader.starts("[[") { 2 } else { 1 };
            table = reader.key();
            while reader.peek() == Some(']') {
                reader.at += 1;
            }
        } else {
            let key = reader.key();
            if reader.peek() == Some('=') {
                reader.at += 1;
                flatten([table.clone(), key].concat(), reader.value(), &mut strings);
            }
        }
        if reader.at == start {
            reader.at += 1;
        }
    }
    let linked = ["dependencies", "build-dependencies", "build_dependencies"];
    strings
        .into_iter()
        .filter(|(key, _)| match key.as_slice() {
            [scope @ .., kind, _, last] => {
                last == "path"
                    && linked.contains(&kind.as_str())
                    && (scope.is_empty() || (scope.len() == 2 && scope[0] == "target"))
            }
            _ => false,
        })
        .map(|(_, path)| path)
        .collect()
}
