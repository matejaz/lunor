import { DiagnosticSeverity } from "vscode-languageserver";

interface AstNode {
	type: string;
	children?: AstNode[];
	value?: string | number | boolean | AstNode;
	tag?: string;
	attributes?: Record<string, string | AstNode>;
}

interface MarkdownNode extends AstNode {
	type: "Markdown";
	tag: string;
	value?: string | AstNode;
	children?: AstNode[];
	attributes?: Record<string, string | AstNode>;
}

interface ComponentNode extends AstNode {
	type: "Component";
	name: string;
	props: Record<string, string | number | boolean | AstNode>;
	children: AstNode[];
	styles?: Record<string, string>;
	hoverStyles?: Record<string, string>;
}

interface DataNode extends AstNode {
	type: "Data";
	name: string;
	value: string | number | boolean | AstNode;
}

interface StateNode extends AstNode {
	type: "State";
	name: string;
	value: string | number | boolean | AstNode;
}

interface ForNode extends AstNode {
	type: "For";
	variable: string;
	collection: string;
	children: AstNode[];
}

interface IfNode extends AstNode {
	type: "If";
	condition: string;
	children: AstNode[];
}

interface FetchNode extends AstNode {
	type: "Fetch";
	url: string;
	method?: string;
	body?: string;
	headers?: Record<string, string>;
	variable?: string;
}

interface ExpressionNode extends AstNode {
	type: "Expression";
	value: string;
}

interface Diagnostic {
	message: string;
	line: number;
	severity: number;
	range: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
	code?: string; // Optional code for diagnostics
}

interface ParseContext {
	lines: string[];
	diagnostics: Diagnostic[];
	stack: { node: AstNode; indent: number }[];
	ast: AstNode[];
	parentComponent: ParentComponent | null;
	currentLine: number;
	componentName?: string;
	markdownHeaderRegex: RegExp;
	markdownListRegex: RegExp;
	markdownLinkRegex: RegExp;
	markdownImageRegex: RegExp;
	componentRegex: RegExp;
	dataRegex: RegExp;
	forRegex: RegExp;
	ifRegex: RegExp;
	fetchRegex: RegExp;
	propRegex: RegExp;
	exprRegex: RegExp;
}

interface ParentComponent {
	name: string;
	props: Record<string, string | number | boolean | AstNode>;
}

function parseData(
	line: string,
	context: ParseContext
): DataNode | StateNode | null {
	const match = line.match(context.dataRegex);
	if (match) {
		const [, name, value] = match;
		let parsedValue: string | number | boolean | AstNode;
		try {
			parsedValue = JSON.parse(value.replace(/'/g, '"'));
		} catch (e) {
			const charIndex = line.indexOf(value);
			context.diagnostics.push({
				message: `Invalid value for :data ${name}: ${
					(e as Error).message
				}`,
				line: context.currentLine + 1,
				severity: DiagnosticSeverity.Error,
				range: {
					start: { line: context.currentLine, character: charIndex },
					end: {
						line: context.currentLine,
						character: charIndex + value.length,
					},
				},
				code: "InvalidDataValue",
			});
			return null;
		}
		if (name === "selectedRecipe" || name.startsWith("state_")) {
			return { type: "State", name, value: parsedValue };
		}
		return { type: "Data", name, value: parsedValue };
	}
	return null;
}

function parseComment(line: string, _context: ParseContext): AstNode | null {
	if (line.trim().startsWith("//")) {
		return { type: "Comment", value: line.trim().slice(2).trim() };
	}
	return null;
}

function parseMarkdown(line: string, context: ParseContext): AstNode | null {
	const trimmedLine = line.trim();

	// Krepko: **text**
	const boldMatch = trimmedLine.match(/^\*\*(.+?)\*\*$/);
	if (boldMatch) {
		const [, text] = boldMatch;
		const textNode = parseExpression(text, context.exprRegex);
		return {
			type: "Markdown",
			tag: "strong",
			children: [{ type: "Text", value: textNode }],
		};
	}

	// Kurzivno: *text*
	const italicMatch = trimmedLine.match(/^\*(.+?)\*$/);
	if (italicMatch) {
		const [, text] = italicMatch;
		const textNode = parseExpression(text, context.exprRegex);
		return {
			type: "Markdown",
			tag: "em",
			children: [{ type: "Text", value: textNode }],
		};
	}

	// Povezava: [text](url) ali [{expr}]({expr})
	const linkMatch = trimmedLine.match(context.markdownLinkRegex);
	if (linkMatch) {
		const [, text, url] = linkMatch;
		const textNode = parseExpression(text, context.exprRegex);
		const urlNode = parseExpression(url, context.exprRegex);
		return {
			type: "Markdown",
			tag: "a",
			attributes: { href: urlNode },
			children: [{ type: "Text", value: textNode }],
		};
	}

	// Slika: ![alt](src) ali ![alt]({expr})
	const imageMatch = trimmedLine.match(context.markdownImageRegex);
	if (imageMatch) {
		const [, alt, src] = imageMatch;
		const srcNode = parseExpression(src, context.exprRegex);
		return {
			type: "Markdown",
			tag: "img",
			attributes: { src: srcNode, alt },
		};
	}

	// Naslov
	const headerMatch = trimmedLine.match(context.markdownHeaderRegex);
	if (headerMatch) {
		const [, hashes, value] = headerMatch;
		return {
			type: "Markdown",
			tag: `h${hashes.length}`,
			value: parseExpression(value, context.exprRegex),
		};
	}

	// Seznam
	const listMatch = trimmedLine.match(context.markdownListRegex);
	if (listMatch) {
		const [, value] = listMatch;
		const liNode: MarkdownNode = {
			type: "Markdown",
			tag: "li",
			value: parseExpression(value, context.exprRegex),
		};
		const parent =
			context.stack.length > 0
				? context.stack[context.stack.length - 1].node
				: null;
		if (parent?.type === "Markdown" && parent.tag === "ul") {
			return liNode;
		}
		return { type: "Markdown", tag: "ul", children: [liNode] };
	}

	// Odstavek ali izraz
	if (trimmedLine) {
		return {
			type: "Markdown",
			tag: "div",
			value: parseExpression(trimmedLine, context.exprRegex),
		};
	}
	return null;
}

function parseExpression(text: string, exprRegex: RegExp): string | AstNode {
	const match = text.match(exprRegex);
	if (match) {
		return { type: "Expression", value: match[1] };
	}
	return text;
}

function parseComponent(
	line: string,
	context: ParseContext
): ComponentNode | null {
	const match = line.trim().match(context.componentRegex);
	if (match) {
		const [, name, propsStr] = match;
		const props: Record<string, string | number | boolean | AstNode> = {};
		const forNode = context.stack.find((n) => n.node.type === "For")
			?.node as ForNode | undefined;
		if (forNode) {
			props.title = {
				type: "Expression",
				value: `${forNode.variable}.title`,
			};
			props.description = {
				type: "Expression",
				value: `${forNode.variable}.description`,
			};
			props.image = {
				type: "Expression",
				value: `${forNode.variable}.image`,
			};
			props.link = {
				type: "Expression",
				value: `${forNode.variable}.link`,
			};
		}
		if (propsStr) {
			const propPairs = propsStr.split(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/);
			for (const prop of propPairs) {
				const [key, value] = prop.split("=").map((s) => s.trim());
				if (!key || !value) {
					const charIndex = line.indexOf(prop);
					context.diagnostics.push({
						message: `Nepravilna lastnost: ${prop}`,
						line: context.currentLine + 1,
						severity: DiagnosticSeverity.Error,
						range: {
							start: {
								line: context.currentLine,
								character: charIndex,
							},
							end: {
								line: context.currentLine,
								character: charIndex + prop.length,
							},
						},
						code: "InvalidProperty",
					});
					continue;
				}
				const exprMatch = value.match(context.exprRegex);
				if (exprMatch) {
					props[key] = { type: "Expression", value: exprMatch[1] };
				} else {
					const cleanValue = value.replace(/^"(.*)"$/, "$1");
					if (cleanValue === "true" || cleanValue === "false") {
						props[key] = cleanValue === "true";
					} else if (!isNaN(Number(cleanValue))) {
						props[key] = Number(cleanValue);
					} else {
						props[key] = cleanValue;
					}
				}
			}
		}
		return { type: "Component", name, props, children: [] };
	}
	return null;
}

function parseDirective(line: string, context: ParseContext): AstNode | null {
	const trimmedLine = line.trim();

	if (trimmedLine.match(context.forRegex)) {
		const [, variable, collection] = trimmedLine.match(context.forRegex)!;
		return { type: "For", variable, collection, children: [] } as ForNode;
	}
	if (trimmedLine.match(context.ifRegex)) {
		const [, condition] = trimmedLine.match(context.ifRegex)!;
		const exprMatch = condition.match(context.exprRegex);
		const cleanCondition = exprMatch ? exprMatch[1] : condition;
		return {
			type: "If",
			condition: cleanCondition,
			children: [],
		} as IfNode;
	}

	if (trimmedLine.match(context.fetchRegex)) {
		const [, variable, url, method] = trimmedLine.match(
			context.fetchRegex
		)!;
		const fetchNode: FetchNode = {
			type: "Fetch",
			url: url.trim(),
			method: method ? method.toUpperCase().trim() : "GET",
			headers: {},
			variable: variable.trim(),
		};
		if (url) {
			const fromMatch = variable.match(context.exprRegex);
			if (fromMatch) {
				fetchNode.url = fromMatch[1];
			} else {
				fetchNode.url = url.trim();
			}
		}
		return fetchNode;
	}

	return null;
}

function handleIndentation(
	indent: number,
	context: ParseContext
): AstNode | null {
	while (
		context.stack.length > 0 &&
		indent < context.stack[context.stack.length - 1].indent
	) {
		context.stack.pop();
	}
	return context.stack.length > 0
		? context.stack[context.stack.length - 1].node
		: null;
}

function parseLine(line: string, context: ParseContext): void {
	const indent = line.match(/^\s*/)?.[0].length || 0;
	const parent = handleIndentation(indent, context);
	const node =
		parseComment(line, context) ||
		parseData(line, context) ||
		parseDirective(line, context) ||
		parseComponent(line, context) ||
		(context.currentLine > 0 ? parseMarkdown(line, context) : null);

	if (node) {
		if (parent) {
			(parent.children = parent.children || []).push(node);
			if (
				node.type === "Component" ||
				node.type === "For" ||
				node.type === "If" ||
				(node.type === "Markdown" && node.tag === "ul")
			) {
				context.stack.push({ node, indent });
			}
		} else {
			context.ast.push(node);
			if (
				node.type === "Component" ||
				node.type === "For" ||
				node.type === "If" ||
				(node.type === "Markdown" && node.tag === "ul")
			) {
				context.stack.push({ node, indent });
			}
		}
	}
}

export function parseLunor(text: string): {
	ast: AstNode[];
	diagnostics: {
		code?: string;
		range: {
			start: { line: number; character: number };
			end: { line: number; character: number };
		};
		severity: number;
		message: string;
		line: number;
	}[];
	component: ParentComponent | null;
} {
	const diagnostics: {
		message: string;
		line: number;
		range: {
			start: { line: number; character: number };
			end: { line: number; character: number };
		};
		severity: number;
		code?: string; // Optional code for diagnostics
	}[] = [];
	const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
	const ast: AstNode[] = [];
	const stack: { node: AstNode; indent: number }[] = [];
	const context: ParseContext = {
		lines,
		diagnostics,
		stack,
		ast,
		parentComponent: null,
		currentLine: 0,
		markdownHeaderRegex: /^(#+)\s+(.+)$/,
		markdownListRegex: /^-\s+(.+)$/,
		markdownLinkRegex: /^\[([^\]]*)\]\(([^)]+)\)$/,
		markdownImageRegex: /^!\[([^\]]*)\]\(([^)]+)\)$/,
		componentRegex: /^:(\w+)(?:\s+(.+))?$/,
		dataRegex: /^:data\s+(\w+)=(.+)$/,
		forRegex: /^:(?:for|forEach)\s+(\w+)\s+in\s+([\w.]+)$/,
		ifRegex: /^:if\s+(.+)$/,
		fetchRegex: /^:fetch\s+(.+)from\s+(.+)\s(GET|PUT|POST|DELETE{1})$/,
		propRegex: /^(\w+):(.+)$/,
		exprRegex: /\{(.+?)\}/,
	};

	// first line is always the component name
	if (lines.length === 0 || !lines[0].trim()) {
		diagnostics.push({
			message: "Datoteka ne sme biti prazna",
			line: 1,
			severity: DiagnosticSeverity.Error,
			range: {
				start: { line: 0, character: 0 },
				end: { line: 0, character: 0 },
			},
			code: "EmptyFile",
		});
		return { ast, diagnostics, component: null };
	}

	for (; context.currentLine < lines.length; context.currentLine++) {
		const line = lines[context.currentLine];

		if (!line.trim()) {
			continue;
		}

		// Prva vrstica je vedno komponenta
		if (context.currentLine === 0) {
			const name = line.trim();
			if (!name.match(/^(\w+)\(([^)]*)\)$/)) {
				context.diagnostics.push({
					message: `Neveljavno ime komponente: ${name}`,
					line: context.currentLine + 1,
					severity: DiagnosticSeverity.Error,
					range: {
						start: { line: context.currentLine, character: 0 },
						end: {
							line: context.currentLine,
							character: line.length,
						},
					},
					code: "InvalidComponentName",
				});
			}

			context.parentComponent = {
				name,
				props: {},
			};
		} else {
			parseLine(line, context);
		}
	}

	return { ast, diagnostics, component: context.parentComponent };
}

function generateMarkdownNode(
	node: MarkdownNode,
	level: number,
	indentFn: (n: number) => string
): string {
	if (node.tag === "a") {
		const href = node.attributes?.href;
		const hrefValue =
			href && typeof href === "object" && href.type === "Expression"
				? `{${href.value}}`
				: `"${href || ""}"`;
		const textNode = node.children?.[0];
		const textValue =
			textNode &&
			textNode.type === "Text" &&
			typeof textNode.value === "object" &&
			textNode.value.type === "Expression"
				? `{${(textNode.value as ExpressionNode).value}}`
				: textNode?.value || "";
		return `${indentFn(level)}<a href=${hrefValue}>${textValue}</a>`;
	}
	if (node.tag === "img") {
		const src = node.attributes?.src;
		const srcValue =
			src && typeof src === "object" && src.type === "Expression"
				? `{${src.value}}`
				: `"${src || ""}"`;
		return `${indentFn(level)}<img src=${srcValue} alt="${
			node.attributes?.alt || ""
		}" />`;
	}
	if (node.tag === "strong" || node.tag === "em") {
		const textNode = node.children?.[0];
		const textValue =
			textNode &&
			textNode.type === "Text" &&
			typeof textNode.value === "object" &&
			textNode.value.type === "Expression"
				? `{${(textNode.value as ExpressionNode).value}}`
				: textNode?.value || "";
		return `${indentFn(level)}<${node.tag}>${textValue}</${node.tag}>`;
	}
	if (node.children) {
		const childrenCode = node.children
			.map((child) => generateNode(child, level + 1, indentFn))
			.join("\n");
		return `${indentFn(level)}<${node.tag}>\n${childrenCode}\n${indentFn(
			level
		)}</${node.tag}>`;
	}
	const value =
		node.value &&
		typeof node.value === "object" &&
		node.value.type === "Expression"
			? `{${(node.value as ExpressionNode).value}}`
			: node.value || "";
	return `${indentFn(level)}<${node.tag}>${value}</${node.tag}>`;
}

function generateComponentNode(
	node: ComponentNode,
	level: number,
	indentFn: (n: number) => string,
	declarations: string[],
	imports: string[]
): string {
	let styleCode = "";
	if (node.styles) {
		styleCode = ` style={${JSON.stringify(node.styles)}}`;
	}
	if (node.hoverStyles && Object.keys(node.hoverStyles).length > 0) {
		const hoverVar = `isHovered${node.name}${Math.random()
			.toString(36)
			.slice(2, 8)}`;
		declarations.push(
			`const [${hoverVar}, set${
				hoverVar.charAt(0).toUpperCase() + hoverVar.slice(1)
			}] = useState(false);`
		);
		if (!imports.includes("useState")) {
			imports.push("useState");
		}
		styleCode =
			` style={${hoverVar} ? ${JSON.stringify(node.hoverStyles)} : ${
				node.styles ? JSON.stringify(node.styles) : "{}"
			}}` +
			` onMouseOver={() => set${
				hoverVar.charAt(0).toUpperCase() + hoverVar.slice(1)
			}(true)}` +
			` onMouseOut={() => set${
				hoverVar.charAt(0).toUpperCase() + hoverVar.slice(1)
			}(false)}`;
	}

	const propsStr = Object.entries(node.props)
		.map(([key, value]) => {
			if (
				value &&
				typeof value === "object" &&
				value.type === "Expression"
			) {
				return `${key}={${(value as ExpressionNode).value}}`;
			}
			if (typeof value === "string") {
				return `${key}="${value}"`;
			}
			return `${key}={${value}}`;
		})
		.join(" ");
	const childrenCode = node.children
		.filter((child) => child.type !== "On")
		.map((child) => generateNode(child, level + 1, indentFn))
		.filter((code) => code)
		.join("\n");

	if (childrenCode) {
		return `${indentFn(level)}<${
			node.name
		} ${propsStr}${styleCode}>\n${childrenCode}\n${indentFn(level)}</${
			node.name
		}>`;
	}
	return `${indentFn(level)}<${node.name} ${propsStr}${styleCode} />`;
}

function generateDataNode(node: DataNode, declarations: string[]): string {
	declarations.push(`const ${node.name} = ${JSON.stringify(node.value)};`);
	return "";
}

function generateStateNode(
	node: StateNode,
	declarations: string[],
	imports: string[]
): string {
	declarations.push(
		`const [${node.name}, set${
			node.name.charAt(0).toUpperCase() + node.name.slice(1)
		}] = useState(${JSON.stringify(node.value)});`
	);
	if (!imports.includes("useState")) {
		imports.push("useState");
	}
	return "";
}

function generateFetchNode(
	node: FetchNode,
	declarations: string[],
	imports: string[]
): string {
	if (!node.url) {
		throw new Error("Fetch node must have a URL.");
	}

	const fetchCode = `fetch(${node.url}, {
  method: '${node.method || "GET"}',
  headers: ${JSON.stringify(node.headers || {})},
  body: ${node.body ? JSON.stringify(node.body) : "null"}
})`;
	if (!imports.includes("useEffect")) {
		imports.push("useEffect");
	}
	if (!imports.includes("useState")) {
		imports.push("useState");
	}
	declarations.push(
		`const [${node.variable}, set${node.variable}] = useState();`
	);
	declarations.push(
		`useEffect(() => {
		  ${fetchCode}
	.then(response => response.json())
	.then(data => set${node.variable}(data))
	.catch(error => console.error('Fetch error:', error));
	}, []);`
	);
	return "";
}

function generateForNode(
	node: ForNode,
	level: number,
	indentFn: (n: number) => string
): string {
	const childrenCode = node.children
		.map((child) => generateNode(child, level + 1, indentFn))
		.join("\n");
	return `${indentFn(level)}{${node.collection}.map((${node.variable}, i) => (
    <div key={i} title={${node.variable}.title} description={${
		node.variable
	}.description} image={${node.variable}.image} link={${node.variable}.link}>
      ${childrenCode}
    </div>
  ${indentFn(level)})}`;
}

function generateIfNode(
	node: IfNode,
	level: number,
	indentFn: (n: number) => string
): string {
	const childrenCode = node.children
		.map((child) => generateNode(child, level + 1, indentFn))
		.join("\n");
	return `${indentFn(level)}{${node.condition} && (${childrenCode}${indentFn(
		level
	)})}`;
}

function generateCommentNode(
	node: AstNode,
	level: number,
	indentFn: (n: number) => string
): string {
	return `${indentFn(level)}{/* ${node.value || ""} */}`;
}

function generateNode(
	node: AstNode,
	level: number,
	indentFn: (n: number) => string,
	declarations: string[] = [],
	imports: string[] = []
): string {
	switch (node.type) {
		case "Markdown":
			return generateMarkdownNode(node as MarkdownNode, level, indentFn);
		case "Component":
			return generateComponentNode(
				node as ComponentNode,
				level,
				indentFn,
				declarations,
				imports
			);
		case "Fetch":
			return generateFetchNode(node as FetchNode, declarations, imports);
		case "Data":
			return generateDataNode(node as DataNode, declarations);
		case "State":
			return generateStateNode(node as StateNode, declarations, imports);
		case "For":
			return generateForNode(node as ForNode, level, indentFn);
		case "If":
			return generateIfNode(node as IfNode, level, indentFn);
		case "Comment":
			return generateCommentNode(node, level, indentFn);
		case "Text": {
			const value =
				node.value &&
				typeof node.value === "object" &&
				node.value.type === "Expression"
					? `{${(node.value as ExpressionNode).value}}`
					: node.value || "";
			return typeof value === "string" ? value : String(value);
		}
		default:
			return "";
	}
}

export function generateReactCode(
	ast: AstNode[],
	component: ParentComponent | null
): string {
	const imports: string[] = [];
	const declarations: string[] = [];

	function indent(level: number): string {
		return " ".repeat(level * 2);
	}

	const bodyCode = ast
		.map((node) => generateNode(node, 3, indent, declarations, imports))
		.filter(Boolean)
		.join("\n");
	const importStatement =
		imports.length > 0
			? `import { ${imports.join(", ")} } from 'react';\n`
			: "";
	const declarationStatement =
		declarations.length > 0 ? declarations.join("\n") + "\n\n" : "";

	return `${importStatement}export default function ${component?.name} {
  ${declarationStatement}  return (
    <>
      ${bodyCode}
    </>
  );
}
`;
}
