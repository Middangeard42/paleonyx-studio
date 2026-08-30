use serde::Serialize;
use tree_sitter::{Node, Parser};

use crate::commands::{resolve_within_root, ProjectState};

/// AST-aware indexing for the Tier 1 languages (PRD.md §4).
///
/// Uses tree-sitter rather than a hand-rolled parser, which for three
/// languages is not a real alternative — and rather than each language's
/// own toolchain, which would mean shipping a TypeScript compiler, a
/// Python runtime, and no path at all for the tiers after these. It is
/// what GitHub, Neovim, Helix, and Zed navigate code with.
///
/// Deliberately a tree walk rather than tree-sitter's query language.
/// The queries would be four blocks of `.scm` in string literals, wrong
/// in ways only a runtime error reveals; matching node kinds is checked
/// by the compiler and reads as what it does.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodeSymbolDto {
    pub name: String,
    pub kind: String,
    /// 1-based and inclusive, matching what the editor shows.
    pub start_line: u32,
    pub end_line: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container: Option<String>,
}

/// Which grammar to parse a file with, by extension.
///
/// Returning None is an ordinary answer, not a failure: most files in a
/// project are not Tier 1 source, and they simply have no outline.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Grammar {
    Python,
    JavaScript,
    TypeScript,
    Tsx,
}

fn grammar_for(path: &str) -> Option<Grammar> {
    let extension = path.rsplit('.').next()?.to_ascii_lowercase();
    match extension.as_str() {
        "py" | "pyi" => Some(Grammar::Python),
        "js" | "mjs" | "cjs" | "jsx" => Some(Grammar::JavaScript),
        "ts" | "mts" | "cts" => Some(Grammar::TypeScript),
        "tsx" => Some(Grammar::Tsx),
        _ => None,
    }
}

/// Node kinds that name something worth listing, per grammar.
///
/// `method` versus `function` is decided by nesting rather than by kind:
/// Python writes both as `function_definition`, and the difference the
/// reader cares about is whether it hangs off a class.
fn symbol_kind(node_kind: &str) -> Option<&'static str> {
    match node_kind {
        "function_definition" | "function_declaration" => Some("function"),
        "class_definition" | "class_declaration" => Some("class"),
        "method_definition" => Some("method"),
        "interface_declaration" => Some("interface"),
        "type_alias_declaration" => Some("type"),
        "enum_declaration" => Some("enum"),
        _ => None,
    }
}

pub fn parse_symbols(source: &str, path: &str) -> Vec<CodeSymbolDto> {
    let Some(grammar) = grammar_for(path) else {
        return Vec::new();
    };

    let language = match grammar {
        Grammar::Python => tree_sitter_python::LANGUAGE.into(),
        Grammar::JavaScript => tree_sitter_javascript::LANGUAGE.into(),
        Grammar::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        Grammar::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
    };

    let mut parser = Parser::new();
    if parser.set_language(&language).is_err() {
        return Vec::new();
    }
    let Some(tree) = parser.parse(source, None) else {
        return Vec::new();
    };

    let mut symbols = Vec::new();
    walk(tree.root_node(), source.as_bytes(), None, &mut symbols);
    symbols
}

/// Depth-first walk collecting named definitions.
///
/// Carries the enclosing class down rather than looking it up on the way
/// back, so a method knows what it belongs to without a second pass.
fn walk(node: Node, source: &[u8], container: Option<&str>, out: &mut Vec<CodeSymbolDto>) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        // Owned so it can outlive the push below and still be borrowed
        // for the recursive call. A class name per nesting level is not
        // worth a lifetime puzzle to avoid copying.
        let mut entered_class: Option<String> = None;

        if let Some(kind) = symbol_kind(child.kind()) {
            if let Some(name) = name_of(child, source) {
                // A function nested in a class is a method whatever the
                // grammar calls it.
                let kind = if kind == "function" && container.is_some() {
                    "method"
                } else {
                    kind
                };

                out.push(CodeSymbolDto {
                    name: name.clone(),
                    kind: kind.to_string(),
                    start_line: child.start_position().row as u32 + 1,
                    end_line: child.end_position().row as u32 + 1,
                    container: container.map(str::to_string),
                });

                if kind == "class" {
                    entered_class = Some(name);
                }
            }
        }

        walk(child, source, entered_class.as_deref().or(container), out);
    }
}

/// The declared name, via the grammar's `name` field.
///
/// Anonymous definitions — a default-exported function, a callback — have
/// no name field and are skipped rather than listed as "anonymous",
/// which would fill an outline with entries nobody can navigate to.
fn name_of(node: Node, source: &[u8]) -> Option<String> {
    let name_node = node.child_by_field_name("name")?;
    name_node.utf8_text(source).ok().map(str::to_string)
}

#[tauri::command]
pub fn file_symbols(
    path: String,
    state: tauri::State<ProjectState>,
) -> Result<Vec<CodeSymbolDto>, String> {
    let root = {
        let guard = state.root.lock().map_err(|e| e.to_string())?;
        guard
            .as_ref()
            .cloned()
            .ok_or_else(|| "No project is open.".to_string())?
    };

    let resolved = resolve_within_root(&root, &path)?;
    let source =
        std::fs::read_to_string(&resolved).map_err(|e| format!("Could not read {path}: {e}"))?;
    Ok(parse_symbols(&source, &path))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(symbols: &[CodeSymbolDto]) -> Vec<String> {
        symbols.iter().map(|s| s.name.clone()).collect()
    }

    fn find<'a>(symbols: &'a [CodeSymbolDto], name: &str) -> &'a CodeSymbolDto {
        symbols
            .iter()
            .find(|s| s.name == name)
            .unwrap_or_else(|| panic!("no symbol named {name} in {:?}", names(symbols)))
    }

    #[test]
    fn finds_python_functions_and_classes() {
        let source =
            "def greet(name):\n    return name\n\nclass Thing:\n    def go(self):\n        pass\n";
        let symbols = parse_symbols(source, "a.py");
        assert_eq!(names(&symbols), vec!["greet", "Thing", "go"]);
        assert_eq!(find(&symbols, "greet").kind, "function");
        assert_eq!(find(&symbols, "Thing").kind, "class");
    }

    /// Python writes methods as plain function definitions, so nesting is
    /// the only thing that distinguishes them.
    #[test]
    fn a_python_function_inside_a_class_is_a_method() {
        let source = "class Thing:\n    def go(self):\n        pass\n";
        let symbols = parse_symbols(source, "a.py");
        let go = find(&symbols, "go");
        assert_eq!(go.kind, "method");
        assert_eq!(go.container.as_deref(), Some("Thing"));
    }

    #[test]
    fn a_top_level_python_function_has_no_container() {
        let symbols = parse_symbols("def free():\n    pass\n", "a.py");
        assert_eq!(find(&symbols, "free").container, None);
        assert_eq!(find(&symbols, "free").kind, "function");
    }

    #[test]
    fn reports_one_based_inclusive_line_ranges() {
        // greet spans lines 1-2; the editor numbers them the same way.
        let symbols = parse_symbols("def greet():\n    return 1\n", "a.py");
        let greet = find(&symbols, "greet");
        assert_eq!(greet.start_line, 1);
        assert_eq!(greet.end_line, 2);
    }

    #[test]
    fn finds_javascript_declarations() {
        let source = "function add(a, b) { return a + b; }\nclass Box { open() {} }\n";
        let symbols = parse_symbols(source, "a.js");
        assert_eq!(find(&symbols, "add").kind, "function");
        assert_eq!(find(&symbols, "Box").kind, "class");
        let open = find(&symbols, "open");
        assert_eq!(open.kind, "method");
        assert_eq!(open.container.as_deref(), Some("Box"));
    }

    #[test]
    fn finds_typescript_types_and_interfaces() {
        let source = "interface Shape { area(): number }\ntype Id = string;\nenum Color { Red }\nfunction go(): void {}\n";
        let symbols = parse_symbols(source, "a.ts");
        assert_eq!(find(&symbols, "Shape").kind, "interface");
        assert_eq!(find(&symbols, "Id").kind, "type");
        assert_eq!(find(&symbols, "Color").kind, "enum");
        assert_eq!(find(&symbols, "go").kind, "function");
    }

    /// TSX needs its own grammar: the TypeScript one cannot parse JSX,
    /// and using it would silently return nothing for every .tsx file.
    #[test]
    fn parses_tsx_which_the_typescript_grammar_cannot() {
        let source = "export function View() { return <div className=\"x\">hi</div>; }\n";
        let as_tsx = parse_symbols(source, "a.tsx");
        assert_eq!(names(&as_tsx), vec!["View"]);
    }

    #[test]
    fn returns_nothing_for_a_language_without_a_grammar() {
        assert!(parse_symbols("SELECT 1;", "a.sql").is_empty());
        assert!(parse_symbols("# hi", "README.md").is_empty());
    }

    /// A file being edited is usually broken. tree-sitter recovers, and
    /// an outline that vanishes mid-keystroke would be worse than one
    /// that is briefly incomplete.
    #[test]
    fn still_finds_what_it_can_in_a_file_that_does_not_compile() {
        let source = "def good():\n    pass\n\ndef broken(\n";
        let symbols = parse_symbols(source, "a.py");
        assert!(
            names(&symbols).contains(&"good".to_string()),
            "lost everything to one syntax error: {:?}",
            names(&symbols)
        );
    }

    #[test]
    fn skips_definitions_that_have_no_name() {
        // An anonymous default export has nothing to navigate to.
        let symbols = parse_symbols("export default function () {}\n", "a.js");
        assert!(symbols.is_empty(), "{:?}", names(&symbols));
    }

    #[test]
    fn handles_an_empty_file() {
        assert!(parse_symbols("", "a.py").is_empty());
    }
}
