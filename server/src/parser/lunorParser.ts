import * as path from "path";
import * as fs from "fs";
import * as glob from "fast-glob";
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
	initVariable?: string;
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
	props?: { name: string; type: string; optional?: boolean }[];
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
		const [, variable, initVariable, url, method] = trimmedLine.match(
			context.fetchRegex
		)!;
		console.log(
			`Parsing fetch directive: variable=${variable}, initVariable=${initVariable}, url=${url}, method=${method}`
		);
		const fetchNode: FetchNode = {
			type: "Fetch",
			url: url.trim(),
			method: method ? method.toUpperCase().trim() : "GET",
			headers: {},
			variable: variable.trim(),
			initVariable: initVariable,
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
		fetchRegex:
			/^:fetch\s+(\w+)\s*\(\s*(\{[^}]*\}\[\])\s*\)\s+from\s+"([^"]+)"\s+(GET|POST|PUT|DELETE)\s*$/,
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

		// First line defines component name and props
		if (context.currentLine === 0) {
			const firstLine = line.trim();
			const m = /^(\w+)\(([^)]*)\)$/.exec(firstLine);
			if (!m) {
				context.diagnostics.push({
					message: `Invalid component signature: ${firstLine}`,
					line: context.currentLine + 1,
					severity: DiagnosticSeverity.Error,
					range: {
						start: { line: context.currentLine, character: 0 },
						end: {
							line: context.currentLine,
							character: firstLine.length,
						},
					},
					code: "InvalidComponentSignature",
				});
				context.parentComponent = { name: firstLine };
			} else {
				const tag = m[1];
				const paramsRaw = m[2];
				const rawList = paramsRaw
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean);
				const props: {
					name: string;
					type: string;
					optional?: boolean;
				}[] = [];
				for (const spec of rawList) {
					const parts = /^(\w+)(\?)?:(\w+(\[\])*)$/.exec(spec);
					if (parts) {
						const propName = parts[1];
						const optional = parts[2] || "";
						const type = parts[3];
						props.push({
							name: propName,
							type,
							optional: !!optional,
						});
					} else {
						const charIndex = line.indexOf(spec);
						context.diagnostics.push({
							message: `Invalid prop definition: ${spec}`,
							line: context.currentLine + 1,
							severity: DiagnosticSeverity.Error,
							range: {
								start: {
									line: context.currentLine,
									character: charIndex,
								},
								end: {
									line: context.currentLine,
									character: charIndex + spec.length,
								},
							},
							code: "InvalidPropDefinition",
						});
					}
				}
				context.parentComponent = { name: tag, props };
			}
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
	indentFn: (n: number) => string
): string {
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
		} ${propsStr}>\n${childrenCode}\n${indentFn(level)}</${node.name}>`;
	}
	return `${indentFn(level)}<${node.name} ${propsStr}/>`;
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
		`const [${node.variable}, set${node.variable}] = useState(${node.initVariable});`
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
	<>
      ${childrenCode}
  ${indentFn(level)}
  </>))}`;
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
				indentFn
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

function discoverComponentFiles(workspaceRoot: string): Record<string, string> {
	const map: Record<string, string> = {};
	// scan every .lnr under the root
	const pattern = path.join(workspaceRoot, "**/*.lnr").replace(/\\/g, "/");
	for (const abs of glob.sync(pattern, { dot: false })) {
		try {
			const firstLine = fs
				.readFileSync(abs, "utf8")
				.split(/\r?\n/)[0]
				.trim();
			const m = /^(\w+)\(/.exec(firstLine);
			if (m) {
				// compute path *relative* to workspaceRoot and drop extension
				const rel = path
					.relative(workspaceRoot, abs)
					.replace(/\\/g, "/")
					.replace(/\.lnr$/, "");
				map[m[1]] = rel;
			}
		} catch {
			// ignore unreadable files
		}
	}
	return map;
}
export function generateReactCode(
	ast: AstNode[],
	component: ParentComponent | null,
	workspaceRoot: string // pass in from your server
): string {
	const imports: string[] = [];
	const declarations: string[] = [];

	// 1) collect every component tag used in the AST
	const used = new Set<string>();
	function collect(n: AstNode) {
		if (n.type === "Component") {
			used.add((n as ComponentNode).name);
		}
		n.children?.forEach(collect);
	}
	ast.forEach(collect);

	// 2) build map of tag → relative .lnr path
	const lunorMap = discoverComponentFiles(workspaceRoot);

	const importStmts = Array.from(used)
		.map((tag) => {
			const rel = lunorMap[tag];
			if (rel) {
				// Use the relative path exactly as discovered to mirror folder structure
				return `import ${tag} from './${rel}';`;
			}
			return `import ${tag} from './${tag}';`;
		})
		.join("\n");
	function indent(l: number) {
		return "  ".repeat(l);
	}
	const body = ast
		.map((n) => generateNode(n, 2, indent, declarations, imports))
		.filter(Boolean)
		.join("\n");
	const hookImport = imports.length
		? `import { ${imports.join(", ")} } from 'react';\n`
		: "";
	const decls = declarations.length
		? declarations.map((d) => indent(1) + d).join("\n") + "\n"
		: "";

	const propsType = `type ${component?.name}Props = {
		${(component?.props ?? [])
			.map(({ name, type, optional }) => {
				name = name.replace(/[^a-zA-Z0-9_]/g, "_");
				if (typeof type === "string") {
					return `${name}${optional ? "?" : ""}: string;`;
				} else if (typeof type === "number") {
					return `${name}${optional ? "?" : ""}: number;`;
				} else if (typeof type === "boolean") {
					return `${name}${optional ? "?" : ""}: boolean;`;
				} else {
					return `${name}${optional ? "?" : ""}: any;`; // Fallback for complex types
				}
			})
			.join("\n")}
};\n`;

	const props = (component?.props ?? []).map(({ name }) => {
		return `${name}`;
	});
	return `// AUTO-GENERATED by LunorParser
${importStmts}
${hookImport}
${propsType ? propsType : ""}
export default function ${component?.name || "App"}({${props}}: ${
		component?.name
	}Props) {
${decls}  return (
	<>
${body}
	</>
  );
}
`;
}
