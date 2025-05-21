import { AstNode, MarkdownNode } from "./lunorParser";

export function generateReactCode(
	ast: AstNode[],
	componentName = "App"
): string {
	function indent(level: number): string {
		return "  ".repeat(level * 2);
	}

	function traverse(node: AstNode, level = 0): string {
		if (node.type === "markdown") {
			const markdownNode = node as MarkdownNode;
			return `${indent(level)}<${markdownNode.tag}>${
				markdownNode.value || ""
			}</${markdownNode.tag}>`;
		}
		return "";
	}

	const bodyCode = ast
		.map((node) => traverse(node, 4))
		.filter((code) => code)
		.join("\n");

	return `
	export default function ${componentName}() {
		return (
			<>
${bodyCode}
			</>
		);
	}
	`;
}
