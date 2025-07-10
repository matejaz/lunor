import { parseLunor } from "./parser/lunorParser";
import type { AstNode, ForNode, IfNode } from "./parser/types";
import { DocumentSymbol, SymbolKind, Range } from "vscode-languageserver/node";

/**
 * Generate document symbols for a Lunor document text and URI.
 * Returns an array containing a single root symbol with children representing AST nodes.
 */
export function generateDocumentSymbols(
	text: string,
	uri: string
): DocumentSymbol[] {
	if (!uri.toLowerCase().endsWith(".lnr")) {
		return [];
	}
	const lines = text.split(/\r?\n/);
	if (lines.length === 0) {
		return [];
	}
	const { ast, component } = parseLunor(text);
	if (!component) {
		return [];
	}
	const fullRange = Range.create(0, 0, lines.length - 1, 0);
	const selectRange = Range.create(0, 0, 0, component.name.length);
	const root = DocumentSymbol.create(
		component.name,
		undefined,
		SymbolKind.Class,
		fullRange,
		selectRange,
		[]
	);

	function visit(node: AstNode, parent: DocumentSymbol) {
		if (node.type === "For") {
			const forNode = node as ForNode;
			const symbol = DocumentSymbol.create(
				`for ${forNode.variable} in ${forNode.collection}`,
				undefined,
				SymbolKind.Function,
				Range.create(
					node.startLine ?? 0,
					0,
					node.endLine ?? node.startLine ?? 0,
					0
				),
				Range.create(
					node.startLine ?? 0,
					0,
					node.endLine ?? node.startLine ?? 0,
					0
				),
				[]
			);
			parent.children?.push(symbol);
			return;
		}
		if (node.type === "If") {
			const ifNode = node as IfNode;
			const symbol = DocumentSymbol.create(
				`if ${ifNode.condition}`,
				undefined,
				SymbolKind.Function,
				Range.create(
					node.startLine ?? 0,
					0,
					node.endLine ?? node.startLine ?? 0,
					0
				),
				Range.create(
					node.startLine ?? 0,
					0,
					node.endLine ?? node.startLine ?? 0,
					0
				),
				[]
			);
			parent.children?.push(symbol);
			return;
		}
		if (node.type === "State" || node.type === "Data") {
			const stateOrDataNode = node as
				| { type: "State"; name: string }
				| { type: "Data"; name: string };
			const symbol = DocumentSymbol.create(
				`${node.type} ${stateOrDataNode.name}`,
				undefined,
				SymbolKind.Variable,
				Range.create(
					node.startLine ?? 0,
					0,
					node.endLine ?? node.startLine ?? 0,
					0
				),
				Range.create(
					node.startLine ?? 0,
					0,
					node.endLine ?? node.startLine ?? 0,
					0
				),
				[]
			);
			parent.children?.push(symbol);
			return;
		}
		node.children?.forEach((child) => visit(child, parent));
	}

	ast.forEach((n) => visit(n, root));
	return [root];
}
