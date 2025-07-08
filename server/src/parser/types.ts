export interface AstNode {
	type: string;
	children?: AstNode[];
	value?: string | number | boolean | AstNode;
	tag?: string;
	attributes?: Record<string, string | AstNode>;
}

export interface MarkdownNode extends AstNode {
	type: "Markdown";
	tag: string;
	value?: string | AstNode;
	children?: AstNode[];
	attributes?: Record<string, string | AstNode>;
}

export interface ComponentNode extends AstNode {
	type: "Component";
	name: string;
	props: Record<string, string | number | boolean | AstNode>;
	children: AstNode[];
	styles?: Record<string, string>;
	hoverStyles?: Record<string, string>;
}

export interface DataNode extends AstNode {
	type: "Data";
	name: string;
	value: string | number | boolean | AstNode;
}

export interface StateNode extends AstNode {
	type: "State";
	name: string;
	value: string | number | boolean | AstNode;
}

export interface ForNode extends AstNode {
	type: "For";
	variable: string;
	collection: string;
	children: AstNode[];
}

export interface IfNode extends AstNode {
	type: "If";
	condition: string;
	children: AstNode[];
}

export interface FetchNode extends AstNode {
	type: "Fetch";
	url: string;
	method?: string;
	body?: string;
	headers?: Record<string, string>;
	variable?: string;
	initVariable?: string;
}

export interface FunctionNode extends AstNode {
	type: "JavaScript";
	signature: string;
	body: string[];
}

export interface ExpressionNode extends AstNode {
	type: "Expression";
	value: string;
}

export interface Diagnostic {
	message: string;
	line: number;
	severity: number;
	range: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
	code?: string; // Optional code for diagnostics
}

export interface ParseContext {
	lines: string[];
	diagnostics: Diagnostic[];
	stack: { node: AstNode; indent: number }[];
	ast: AstNode[];
	imports: string[]; // List of imported components or modules
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
	stateRegex: RegExp;
	functionRegex: RegExp;
	importRegex: RegExp;
}

export interface ParentComponent {
	name: string;
	props?: { name: string; type: string; optional?: boolean }[];
}
