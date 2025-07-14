import * as path from "path";
import * as fs from "fs";
import * as glob from "fast-glob";
import { DiagnosticSeverity } from "vscode-languageserver";
import {
	ParseContext,
	AstNode,
	DataNode,
	StateNode,
	MarkdownNode,
	ComponentNode,
	ExpressionNode,
	FetchNode,
	ForNode,
	IfNode,
	ParentComponent,
	JavaScriptNode,
} from "./types";
// Helper: attach line/column info to AST nodes
function attachPosition<T extends AstNode>(
	node: T,
	startCol: number,
	endCol: number,
	context: ParseContext
): T {
	node.startLine = context.currentLine;
	node.startColumn = startCol;
	node.endLine = context.currentLine;
	node.endColumn = endCol;
	return node;
}
function parseData(
	line: string,
	context: ParseContext
): DataNode | StateNode | null {
	const dataMatch = line.match(context.dataRegex);
	const stateMatch = line.match(context.stateRegex);
	if (dataMatch) {
		const [, name, value] = dataMatch;
		// support unquoted function call or expression values
		let parsedValue: string | number | boolean | AstNode;
		const rawVal = value.trim();
		// detect simple function calls or dot-expressions, e.g. useParams().id
		const fnMatch = rawVal.match(
			/^([A-Za-z_$][\w$]*\([^)]*\)(?:\.[A-Za-z_$][\w$]*)*)$/
		);
		if (fnMatch) {
			parsedValue = { type: "Expression", value: fnMatch[1] };
		} else {
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
						start: {
							line: context.currentLine,
							character: charIndex,
						},
						end: {
							line: context.currentLine,
							character: charIndex + value.length,
						},
					},
					code: "InvalidDataValue",
				});
				return null;
			}
		}

		return { type: "Data", name, value: parsedValue };
	}

	if (stateMatch) {
		const [, name, value] = stateMatch;
		let parsedValue: string | number | boolean | AstNode;
		try {
			parsedValue = JSON.parse(value.replace(/'/g, '"'));
		} catch (e) {
			const charIndex = line.indexOf(value);
			context.diagnostics.push({
				message: `Invalid value for :state ${name}: ${
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
				code: "InvalidStateValue",
			});
			return null;
		}

		return { type: "State", name, value: parsedValue };
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
	// extract trailing style attribute
	let trimmedLine = line.trim();
	let styleValue: string | undefined;
	const styleMatch = trimmedLine.match(/\s+style="([^"]+)"$/);
	if (styleMatch) {
		styleValue = styleMatch[1];
		trimmedLine = trimmedLine.slice(0, styleMatch.index).trim();
	}

	// Krepko: **text**
	const boldMatch = trimmedLine.match(/^\*\*(.+?)\*\*$/);
	if (boldMatch) {
		const [, text] = boldMatch;
		const textNode = parseExpression(text, context.exprRegex);
		const node: MarkdownNode = {
			type: "Markdown",
			tag: "strong",
			children: [{ type: "Text", value: textNode }],
		};
		if (styleValue) {
			node.attributes = { style: styleValue };
		}
		return node;
	}

	// Kurzivno: *text*
	const italicMatch = trimmedLine.match(/^\*(.+?)\*$/);
	if (italicMatch) {
		const [, text] = italicMatch;
		const textNode = parseExpression(text, context.exprRegex);
		const node: MarkdownNode = {
			type: "Markdown",
			tag: "em",
			children: [{ type: "Text", value: textNode }],
		};
		if (styleValue) {
			node.attributes = { style: styleValue };
		}
		return node;
	}

	// Povezava: [text](url) ali [{expr}]({expr})
	const linkMatch = trimmedLine.match(context.markdownLinkRegex);
	if (linkMatch) {
		const [, text, url] = linkMatch;
		const textNode = parseExpression(text, context.exprRegex);
		const urlNode = parseExpression(url, context.exprRegex);
		const node: MarkdownNode = {
			type: "Markdown",
			tag: "a",
			attributes: { href: urlNode },
			children: [{ type: "Text", value: textNode }],
		};
		if (styleValue) {
			node.attributes = { ...node.attributes, style: styleValue };
		}
		return node;
	}

	// Slika: ![alt](src) ali ![alt]({expr})
	const imageMatch = trimmedLine.match(context.markdownImageRegex);
	if (imageMatch) {
		const [, alt, src] = imageMatch;
		const srcNode = parseExpression(src, context.exprRegex);
		const node: MarkdownNode = {
			type: "Markdown",
			tag: "img",
			attributes: { src: srcNode, alt },
		};
		if (styleValue) {
			node.attributes = { ...node.attributes, style: styleValue };
		}
		return node;
	}

	// Naslov
	const headerMatch = trimmedLine.match(context.markdownHeaderRegex);
	if (headerMatch) {
		const [, hashes, value] = headerMatch;
		const node: MarkdownNode = {
			type: "Markdown",
			tag: `h${hashes.length}`,
			value: parseExpression(value, context.exprRegex),
		};
		if (styleValue) {
			node.attributes = { style: styleValue };
		}
		return node;
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
		if (styleValue) {
			liNode.attributes = { style: styleValue };
		}
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
		const node: MarkdownNode = {
			type: "Markdown",
			tag: "p",
			value: parseExpression(trimmedLine, context.exprRegex),
		};
		if (styleValue) {
			node.attributes = { style: styleValue };
		}
		return node;
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

		if (propsStr) {
			// split props, ignoring spaces within braces or quotes
			const propPairs: string[] = [];
			let current = "";
			let braceDepth = 0;
			let inQuotes = false;
			for (let i = 0; i < propsStr.length; i++) {
				const char = propsStr[i];
				if (char === '"' && propsStr[i - 1] !== "\\") {
					inQuotes = !inQuotes;
					current += char;
				} else if (!inQuotes) {
					if (char === "{") {
						braceDepth++;
						current += char;
					} else if (char === "}") {
						braceDepth--;
						current += char;
					} else if (char === " " && braceDepth === 0) {
						if (current.trim()) {
							propPairs.push(current.trim());
						}
						current = "";
					} else {
						current += char;
					}
				} else {
					current += char;
				}
			}
			if (current.trim()) {
				propPairs.push(current.trim());
			}
			// parse each key=value
			for (const prop of propPairs) {
				const [key, ...rest] = prop.split("=");
				const value = rest.join("=").trim();
				const propName = key.trim();
				if (!propName || !value) {
					const charIndex = line.indexOf(prop);
					context.diagnostics.push({
						message: `Invalid property: ${prop}`,
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

				// full expression in braces, including template literals
				if (value.startsWith("{") && value.endsWith("}")) {
					const inner = value.slice(1, -1);
					props[propName] = { type: "Expression", value: inner };
				} else if (value.startsWith('"') && value.endsWith('"')) {
					props[propName] = value.slice(1, -1);
				} else if (value === "true" || value === "false") {
					props[propName] = value === "true";
				} else if (!isNaN(Number(value))) {
					props[propName] = Number(value);
				} else {
					// fallback: treat as raw string or template literal
					props[propName] = value;
				}

				// if we have Route and Element, change element to Component
				if (name === "Route" && props.element) {
					props.element = {
						type: "Expression",
						value: `<${(props.element as ExpressionNode).value}/>`,
					};
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
		const [, variable, initVariable, url, method, auth] = trimmedLine.match(
			context.fetchRegex
		)!;

		const fetchNode: FetchNode = {
			type: "Fetch",
			url: "`" + url.trim() + "`", // Use template literal for URL
			method: method ? method.toUpperCase().trim() : "GET",
			headers: auth
				? {
						Authorization:
							"Bearer ${localStorage.getItem('token')}",
				  }
				: {},
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

// Parse function directive and create FunctionNode
function parseFunction(
	line: string,
	context: ParseContext
): JavaScriptNode | null {
	const trimmed = line.trim();
	const match = trimmed.match(context.functionRegex);
	if (match) {
		// compute columns for signature
		const sigText = match[0];
		const startCol = line.indexOf(sigText);
		const endCol = startCol + sigText.length;
		const fn: JavaScriptNode = attachPosition(
			{
				type: "JavaScript",
				signature: "",
				body: [],
			},
			startCol,
			endCol,
			context
		);
		return fn;
	}
	return null;
}

function handleIndentation(
	indent: number,
	context: ParseContext
): AstNode | null {
	// Pop contexts when current indent is not greater than parent's indent
	while (
		context.stack.length > 0 &&
		indent <= context.stack[context.stack.length - 1].indent
	) {
		context.stack.pop();
	}
	// The remaining top of stack (if any) is the parent for deeper indented nodes
	return context.stack.length > 0
		? context.stack[context.stack.length - 1].node
		: null;
}

function parseLine(line: string, context: ParseContext): void {
	const indent = line.match(/^\s*/)?.[0].length || 0;
	const parent = handleIndentation(indent, context);

	// if we're inside a function block, capture raw body lines
	if (parent && parent.type === "JavaScript") {
		const fnNode = parent as JavaScriptNode;
		// check if it is import statement
		if (line.trim().startsWith("import ")) {
			const importMatch = line.trim().match(context.importRegex);
			if (importMatch) {
				context.imports.push(importMatch[0]);
				return;
			}
		}
		fnNode.body.push(line.trim());
		fnNode.endLine = context.currentLine;
		return;
	}

	const node =
		parseComment(line, context) ||
		parseData(line, context) ||
		parseFunction(line, context) ||
		parseDirective(line, context) ||
		parseComponent(line, context) ||
		(context.currentLine > 0 ? parseMarkdown(line, context) : null);

	if (node) {
		// attach overall position to every node
		attachPosition(node, indent, indent + line.trim().length, context);
		if (parent) {
			(parent.children = parent.children || []).push(node);
			if (
				node.type === "Component" ||
				node.type === "JavaScript" ||
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
				node.type === "JavaScript" ||
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
	imports: string[]; // List of imported components or modules
} {
	const diagnostics: {
		message: string;
		line: number;
		range: {
			start: { line: number; character: number };
			end: { line: number; character: number };
		};
		severity: number;
		code?: string; // Optional code for codeactions
	}[] = [];
	const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
	const ast: AstNode[] = [];
	const stack: { node: AstNode; indent: number }[] = [];
	const imports: string[] = [];
	const context: ParseContext = {
		lines,
		diagnostics,
		imports, // List of imported components or modules
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
			/^:fetch\s+(\w+)\s*\(\s*(\{[^}]*\}\[*\]*)\s*\)\s+from\s+["`]?([^"`]+)["`]?[ ]+(GET|POST|PUT|DELETE)\s?(auth)*$/,
		propRegex: /^(\w+):(.+)$/,
		exprRegex: /\{(.+?)\}/,
		stateRegex: /^:state\s+(\w+)=(.+)$/,
		functionRegex: /^:js$/,
		importRegex:
			/^import\s+(?:\*\s+as\s+\w+|\w+(?:\s*,\s*\{[^}]+\})?|\{[^}]+\})\s+from\s+['"][^'"]+['"];$/,
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
		return { ast, diagnostics, component: null, imports };
	}

	for (; context.currentLine < lines.length; context.currentLine++) {
		const line = lines[context.currentLine];

		if (!line.trim()) {
			continue;
		}

		// First line defines component name and props
		if (context.currentLine === 0) {
			const firstLine = line.trim();
			const m = /^(\w+)\((.*)\)$/.exec(firstLine);
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
					.split(/,(?![^(]*\))/) // split by commas not inside parentheses
					.map((s) => s.trim())
					.filter(Boolean);
				const props: {
					name: string;
					type: string;
					optional?: boolean;
				}[] = [];

				for (const spec of rawList) {
					const parts = /^(\w+)(\?)?:\s*(.+)$/.exec(spec);
					if (parts) {
						const propName = parts[1];
						const optional = parts[2] || "";
						const type = parts[3].trim();
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

	return { ast, diagnostics, component: context.parentComponent, imports };
}

function generateMarkdownNode(
	node: MarkdownNode,
	level: number,
	indentFn: (n: number) => string
): string {
	const styleAttr = node.attributes?.style
		? ` className="${node.attributes.style}"`
		: "";
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
		return `${indentFn(
			level
		)}<a href=${hrefValue}${styleAttr}>${textValue}</a>`;
	}
	if (node.tag === "img") {
		const src = node.attributes?.src;
		const srcValue =
			src && typeof src === "object" && src.type === "Expression"
				? `{${src.value}}`
				: `"${src || ""}"`;
		return `${indentFn(level)}<img src=${srcValue} alt="${
			node.attributes?.alt || ""
		}"${styleAttr} />`;
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
		return `${indentFn(level)}<${node.tag}${styleAttr}>${textValue}</${
			node.tag
		}>`;
	}
	if (node.children) {
		const childrenCode = node.children
			.map((child) => generateNode(child, level + 1, indentFn))
			.join("\n");
		return `${indentFn(level)}<${
			node.tag
		}${styleAttr}>\n${childrenCode}\n${indentFn(level)}</${node.tag}>`;
	}
	const value =
		node.value &&
		typeof node.value === "object" &&
		node.value.type === "Expression"
			? `{${(node.value as ExpressionNode).value}}`
			: node.value || "";
	return `${indentFn(level)}<${node.tag}${styleAttr}>${value}</${node.tag}>`;
}

function generateComponentNode(
	node: ComponentNode,
	level: number,
	indentFn: (n: number) => string
): string {
	// we should skip style otherwise it is twice in the props
	const propsStr = Object.entries(node.props)
		.filter(([key]) => key !== "style")
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
	// include style prop if present
	const styleEntry = node.props.style
		? typeof node.props.style === "string"
			? `className="${node.props.style}"`
			: `className={${(node.props.style as ExpressionNode).value}}`
		: "";
	const fullProps = [propsStr, styleEntry].filter(Boolean).join(" ");
	const childrenCode = node.children
		.filter((child) => child.type !== "On")
		.map((child) => generateNode(child, level + 1, indentFn))
		.filter((code) => code)
		.join("\n");

	// if there are no children, self-close the tag
	if (node.children.length === 0 && !fullProps) {
		return `${indentFn(level)}<${node.name} />`;
	}

	if (childrenCode) {
		return `${indentFn(level)}<${
			node.name
		} ${fullProps}>\n${childrenCode}\n${indentFn(level)}</${node.name}>`;
	}
	return `${indentFn(level)}<${node.name} ${fullProps}/>`;
}

function generateDataNode(node: DataNode, declarations: string[]): string {
	// handle expression AST values directly
	if (
		typeof node.value === "object" &&
		(node.value as ExpressionNode).type === "Expression"
	) {
		// emit raw expression
		declarations.push(
			`let ${node.name} = ${(node.value as ExpressionNode).value};`
		);
	} else {
		// emit JSON literal for primitive values
		declarations.push(`let ${node.name} = ${JSON.stringify(node.value)};`);
	}
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

	const nodeURL = "`" + node.url + "`"; // Use template literal for URL
	// if Authorization header is set, use it, but not around the token

	const fetchCode = `fetch(${nodeURL}, {
  		method: '${node.method || "GET"}',
  		headers: ${JSON.stringify(node.headers || {}).replace(
			"\"Bearer ${localStorage.getItem('token')}\"",
			'`Bearer ${localStorage.getItem("token")}`'
		)},
  		body: ${node.body ? JSON.stringify(node.body) : "null"}
		})`;

	if (!imports.includes("useEffect")) {
		imports.push("useEffect");
	}
	if (!imports.includes("useState")) {
		imports.push("useState");
	}
	const variableName = node.variable ?? "data";
	declarations.push(
		`const [${variableName}, set${
			variableName.charAt(0).toUpperCase() + variableName.slice(1)
		}] = useState<${node.initVariable}>();`
	);
	declarations.push(
		`useEffect(() => {
		${fetchCode}
		.then(response => response.json())
		.then(data => set${node.variable
			?.charAt(0)
			.toUpperCase()}${node.variable?.slice(1)}(data))
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
	return `${indentFn(level)}<>{${node.collection}.map((${
		node.variable
	}, i) => (

      ${childrenCode}
  ${indentFn(level)}
  ))}</>`;
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

function generateFunctionNode(
	node: JavaScriptNode,
	level: number,
	indentFn: (n: number) => string,
	functions: string[]
): string {
	// indent each body line one level deeper
	const bodyText = (node.body || [])
		.map((line) => indentFn(level + 1) + line)
		.join("\n");

	functions.push(`\n${bodyText}\n${indentFn(level)}`);
	return "";
}

function generateNode(
	node: AstNode,
	level: number,
	indentFn: (n: number) => string,
	declarations: string[] = [],
	imports: string[] = [],
	functions: string[] = []
): string {
	// handle special cases first
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
		case "JavaScript":
			return generateFunctionNode(
				node as JavaScriptNode,
				level,
				indentFn,
				functions
			);
		case "Function":
			return generateFunctionNode(
				node as JavaScriptNode,
				level,
				indentFn,
				functions
			);

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
	workspaceRoot: string,
	importsJS: string[] = []
): string {
	const imports: string[] = [];
	const declarations: string[] = [];
	const functions: string[] = [];
	// 1) collect every component tag used in the AST
	const used = new Set<string>();
	function collect(n: AstNode) {
		if (n.type === "Component") {
			used.add((n as ComponentNode).name);
		}
		// if component is Route and props contain element, add that element
		if (n.type === "Component" && (n as ComponentNode).name === "Route") {
			const elementProp = (n as ComponentNode).props["element"];
			if (
				typeof elementProp === "object" &&
				elementProp.type === "Expression"
			) {
				used.add((elementProp as ExpressionNode).value.slice(1, -2)); // remove < and />
			}
		}

		// check if useParams is used
		if (
			n.type === "Data" &&
			typeof n.value === "object" &&
			n.value.type === "Expression" &&
			typeof n.value.value === "string" &&
			n.value.value.startsWith("useParams")
		) {
			used.add("useParams");
		}

		n.children?.forEach(collect);
	}
	ast.forEach(collect);

	const routerTags = [
		"BrowserRouter",
		"Route",
		"Routes",
		"Link",
		"useParams",
	];
	const routerTagsUsed = routerTags.filter((tag) => used.has(tag));
	const routerImports = routerTagsUsed.length
		? `import { ${routerTagsUsed.join(", ")} } from 'react-router-dom';\n`
		: "";

	// 2) build map of tag → relative .lnr path
	const lunorMap = discoverComponentFiles(workspaceRoot);
	const importStmts = Array.from(used)
		.map((tag) => {
			if (tag[0] === tag[0].toLowerCase() || routerTags.includes(tag)) {
				return;
			}
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
		.map((n) =>
			generateNode(n, 2, indent, declarations, imports, functions)
		)
		.filter(Boolean)
		.join("\n");

	const hookImport = imports.length
		? `import { ${imports.join(", ")} } from 'react';\n`
		: "";
	const decls = declarations.length
		? declarations.map((d) => indent(1) + d).join("\n") + "\n"
		: "";

	const hasProps = component?.props && component.props.length > 0;
	const propsType = `type ${component?.name}Props = {
		${(component?.props ?? [])
			.map(({ name, type, optional }) => {
				name = name.replace(/[^a-zA-Z0-9_]/g, "_");
				return `\t${name}${optional ? "?" : ""}${
					type ? `: ${type}` : ""
				};`;
			})
			.join("\n")}
};\n`;

	const props = (component?.props ?? []).map(({ name }) => {
		return `${name}`;
	});

	return `// AUTO-GENERATED by LunorParser
${importStmts ? importStmts : ""}
${importsJS.join("\n")}
${routerImports}
${hookImport}
${hasProps && propsType ? propsType : ""}
${
	hasProps
		? `export default function ${component?.name || "App"}({${props}}: ${
				component?.name
		  }Props) {`
		: `export default function ${component?.name || "App"}() {`
}
${decls}
${functions.length > 0 ? functions.join("\n\n") + "\n" : ""}
  return (
	<>
${body}
	</>
  );
}
`;
}
