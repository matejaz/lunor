export interface AstNode {
	type: string;
	children?: AstNode[];
}

export interface MarkdownNode extends AstNode {
	type: "markdown";
	tag: string;
	value?: string;
	children?: AstNode[];
}

export function parseLunor(text: string): {
	ast: AstNode[];
	diagnostics: { message: string; line: number }[];
} {
	const diagnostics: { message: string; line: number }[] = [];
	const lines = text.split("\n").map((line) => line.replace(/\$/, ""));
	const ast: AstNode[] = [];

	const markdownHeaderRegex = /^(#+)\s+(.+)$/;

	// eslint-disable-next-line @typescript-eslint/prefer-for-of
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmedLine = line.trim();

		if (!trimmedLine) {
			continue;
		} // preskoči prazne vrstice

		// Naslovi
		const headerMatch = trimmedLine.match(markdownHeaderRegex);
		if (headerMatch) {
			const [, hashes, value] = headerMatch;
			const node: MarkdownNode = {
				type: "markdown",
				tag: `h${hashes.length}`,
				value,
			};
			ast.push(node);
			continue;
		}

		// Splošno besedilo
		const node: MarkdownNode = {
			type: "markdown",
			tag: "p",
			value: trimmedLine,
		};
		ast.push(node);
	}
	return { ast, diagnostics };
}
