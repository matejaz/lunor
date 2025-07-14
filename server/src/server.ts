/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentSyncKind,
	InitializeResult,
	DocumentDiagnosticReportKind,
	type DocumentDiagnosticReport,
	InsertTextFormat,
	SignatureHelp,
	SignatureInformation,
	ParameterInformation,
	SignatureHelpParams,
	DiagnosticSeverity,
	Diagnostic,
	CodeAction,
	CodeActionKind,
	DocumentSymbol,
	SymbolKind,
	Range,
} from "vscode-languageserver/node";
import { URI } from "vscode-uri";
import * as fs from "fs";
import * as path from "path";
import * as glob from "fast-glob";
import { TextDocument } from "vscode-languageserver-textdocument";
import { generateReactCode, parseLunor } from "./parser/lunorParser";
import type { AstNode, ForNode, IfNode } from "./parser/types";

let workspaceRoot = ""; // Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents = new TextDocuments(TextDocument);

// In‐memory map of component signatures parsed from first line of each Lunor file
const componentSignatures = new Map<string, SignatureInformation>();
const hasConfigurationCapability = false;
const hasWorkspaceFolderCapability = false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
	// pick the “lunor” folder if there are multiple roots,
	// else just take the single one
	if (params.workspaceFolders) {
		const roots = params.workspaceFolders.map(
			(f) => URI.parse(f.uri).fsPath
		);
		workspaceRoot =
			roots.find((r) => path.basename(r).toLowerCase() === "lunor") ||
			roots[0];
	} else if (params.rootUri) {
		workspaceRoot = URI.parse(params.rootUri).fsPath;
	}
	// If there's a 'lunor' subfolder under the root, use that for scanning
	const lunorSubdir = path.join(workspaceRoot, "lunor");
	if (fs.existsSync(lunorSubdir) && fs.statSync(lunorSubdir).isDirectory()) {
		workspaceRoot = lunorSubdir;
	}

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			completionProvider: {
				resolveProvider: true,
				triggerCharacters: [":"],
			},
			hoverProvider: true,
			signatureHelpProvider: { triggerCharacters: [" "] },
			documentFormattingProvider: true,
			codeActionProvider: true,
			diagnosticProvider: {
				interFileDependencies: false,
				workspaceDiagnostics: false,
			},
			renameProvider: true,
			documentSymbolProvider: true, // re-enabled
			workspaceSymbolProvider: true,
		},
	};
	return result;
});

// Helper: parse first line of a doc for “Tag param:type, …” definitions
function parseComponentDefinition(doc: TextDocument) {
	const text = doc.getText();
	const firstLine = text.split(/\r?\n/)[0].trim();
	const m = /^(\w+)\((.*)\)$/.exec(firstLine);
	if (!m) {
		return;
	}
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const [_a, tag, paramsRaw] = m;
	const rawList = paramsRaw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const parameters = rawList.map((spec) => {
		// matches name?:type or name:type
		const parts = /^(\w+)(\?)?:(\w+)$/.exec(spec);
		const label = parts ? `${parts[1]}${parts[2] || ""}:${parts[3]}` : spec;
		const docString = parts ? `Type: ${parts[3]}` : "";
		return ParameterInformation.create(label, docString);
	});
	const signature: SignatureInformation = {
		label: `:${tag} ${parameters.map((p) => p.label).join(" ")}`,
		documentation: `Props for ${tag}`,
		parameters,
	};
	componentSignatures.set(tag, signature);
}

// Update definitions when Lunor docs open or change
documents.onDidOpen((e) => parseComponentDefinition(e.document));
documents.onDidChangeContent((e) => parseComponentDefinition(e.document));

// Exported helper for testing and reuse: generate document symbols for a given text and URI
export function generateDocumentSymbols(
	text: string,
	uri: string
): DocumentSymbol[] {
	// only for Lunor documents
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

// Provide outline (Symbols) for .lnr files
connection.onDocumentSymbol((params): DocumentSymbol[] => {
	const doc = documents.get(params.textDocument.uri);
	if (!doc) {
		return [];
	}
	return generateDocumentSymbols(doc.getText(), params.textDocument.uri);
});
// Provide signature help based on parsed definitions
connection.onSignatureHelp((params: SignatureHelpParams): SignatureHelp => {
	const doc = documents.get(params.textDocument.uri);
	if (!doc) {
		return { signatures: [], activeSignature: 0, activeParameter: 0 };
	}

	// get text up to cursor, match “:Tag ”
	const offset = doc.offsetAt(params.position);
	const pre = doc.getText().slice(0, offset);
	const m = /:(\w+)\s{1}$/.exec(pre);
	if (!m) {
		return { signatures: [], activeSignature: 0, activeParameter: 0 };
	}
	const tag = m[1];
	const sigInfo = componentSignatures.get(tag);
	if (!sigInfo) {
		return { signatures: [], activeSignature: 0, activeParameter: 0 };
	}

	const afterParen = pre.split(" ").pop() || "";
	const activeParam = afterParen.split(" ").length - 1;

	return {
		signatures: [sigInfo],
		activeSignature: 0,
		activeParameter: Math.max(
			0,
			Math.min(activeParam, (sigInfo.parameters?.length ?? 0) - 1)
		),
	};
});

connection.onDidChangeTextDocument(async (change) => {
	const document = documents.get(change.textDocument.uri);
	if (!document) {
		return;
	}

	const changeEvent = change.contentChanges[0];
	if (!changeEvent || !("range" in changeEvent)) {
		return;
	}
});
connection.onInitialized(() => {
	scanAllComponentDefinitions();
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(
			DidChangeConfigurationNotification.type,
			undefined
		);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders((_event) => {
			connection.console.log("Workspace folder change event received.");
		});
	}
});
function scanAllComponentDefinitions() {
	if (!workspaceRoot) {
		return;
	}
	const pattern = path.join(workspaceRoot, "**/*.lunor").replace(/\\/g, "/");
	for (const file of glob.sync(pattern, { dot: false })) {
		try {
			const text = fs.readFileSync(file, "utf8");
			const fakeDoc = TextDocument.create(
				URI.file(file).toString(),
				"lunor",
				0,
				text
			);
			parseComponentDefinition(fakeDoc);
		} catch {
			// ignore
		}
	}
}

// The example settings
interface ExampleSettings {
	maxNumberOfProblems: number;
}

// Cache the settings of all open documents
const documentSettings = new Map<string, Thenable<ExampleSettings>>();

// // only for development
// connection.onDidSaveTextDocument(async (params) => {
// 	console.log("Tukaj");
// 	console.log(`Document saved: ${params.textDocument.uri}`);
// 	// Parse the document to update component definitions
// 	try {
// 		// Parsiraj besedilo in ga pretvori v JSX
// 		console.log("Pretvarjanje Lunor v React JSX ...");
// 		const { ast, diagnostics, component } = parseLunor(params.text ?? "");
// 		// determine current file path from URI
// 		const jsx = generateReactCode(ast, component, workspaceRoot);
// 		console.log("Problems:", diagnostics);
// 		console.log(ast);
// 		console.log(component);
// 		if (diagnostics.length > 0) {
// 			connection.sendDiagnostics({
// 				uri: params.textDocument.uri,
// 				diagnostics: diagnostics.map(
// 					(diag): Diagnostic => ({
// 						severity: diag.severity as DiagnosticSeverity,
// 						range: diag.range,
// 						message: diag.message,
// 						source: "lunor",
// 						code: diag.code,
// 					})
// 				),
// 			});
// 		}

// 		// Vrni JSX kodo kot rezultat
// 		return jsx;
// 	} catch (err) {
// 		// Poskrbi za napake pri parserju
// 		connection.console.error(`Napaka pri pretvorbi Lunor v React: ${err}`);
// 		return "// Napaka pri pretvorbi";
// 	}
// });

connection.onDidChangeConfiguration((_change) => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		// globalSettings =
		// change.settings.languageServerExample || defaultSettings;
	}
	// Refresh the diagnostics since the `maxNumberOfProblems` could have changed.
	// We could optimize things here and re-fetch the setting first can compare it
	// to the existing setting, but this is out of scope for this example.
	connection.languages.diagnostics.refresh();
});

// Only keep settings for open documents
documents.onDidClose((e) => {
	documentSettings.delete(e.document.uri);
});

// Replace your diagnostics handler with this:
connection.languages.diagnostics.on(async (params) => {
	const document = documents.get(params.textDocument.uri);
	if (!document) {
		return {
			kind: DocumentDiagnosticReportKind.Full,
			items: [],
		} satisfies DocumentDiagnosticReport;
	}

	const { diagnostics } = parseLunor(document.getText());

	// const items = validateDocument(document);
	const items: Diagnostic[] = diagnostics.map(
		(diag): Diagnostic => ({
			severity: diag.severity as DiagnosticSeverity,
			range: diag.range,
			message: diag.message,
			source: "lunor",
			code: diag.code, // Include code if available
		})
	);
	return {
		kind: DocumentDiagnosticReportKind.Full,
		items,
	} satisfies DocumentDiagnosticReport;
});

connection.onRequest("lunor/generateReact", async (params) => {
	console.log("Lunor to React request received");
	try {
		// Parsiraj besedilo in ga pretvori v JSX
		console.log("Pretvarjanje Lunor v React JSX LALALA ...");
		const { ast, diagnostics, component, imports } = parseLunor(
			params.text
		);
		console.log(ast);
		// determine current file path from URI
		const jsx = generateReactCode(ast, component, workspaceRoot, imports);
		console.log("Neki");
		if (diagnostics.length > 0) {
			connection.sendDiagnostics({
				uri: params.textDocument.uri,
				diagnostics: diagnostics.map(
					(diag): Diagnostic => ({
						severity: diag.severity as DiagnosticSeverity,
						range: diag.range,
						message: diag.message,
						source: "lunor",
						code: diag.code,
					})
				),
			});
		}

		// Vrni JSX kodo kot rezultat
		return jsx;
	} catch (err) {
		// Poskrbi za napake pri parserju
		connection.console.error(`Napaka pri pretvorbi Lunor v React: ${err}`);
		return "// Napaka pri pretvorbi";
	}
});

connection.onDidChangeWatchedFiles((ev) => {
	for (const change of ev.changes) {
		const uri = URI.parse(change.uri);
		if (!uri.fsPath.endsWith(".lnr")) {
			continue;
		}

		if (
			change.type === 1 /* Created */ ||
			change.type === 2 /* Changed */
		) {
			try {
				const text = fs.readFileSync(uri.fsPath, "utf8");
				const doc = TextDocument.create(change.uri, "lunor", 0, text);
				parseComponentDefinition(doc);
			} catch {
				/* ignore */
			}
		} else if (change.type === 3 /* Deleted */) {
			// remove any signature for that file's first‐line tag
			// easiest: clear the entire map and rescan

			componentSignatures.clear();
			scanAllComponentDefinitions();
		}
	}
});

connection.onCodeAction((params) => {
	const actions: CodeAction[] = [];

	for (const diag of params.context.diagnostics) {
		if (diag.code === "InvalidProperty") {
			const fix: CodeAction = {
				title: "Remove Invalid Property",
				kind: CodeActionKind.QuickFix,
				diagnostics: [diag],
				edit: {
					changes: {
						[params.textDocument.uri]: [
							{
								range: diag.range,
								newText: "", // Remove the invalid property
							},
						],
					},
				},
			};
			actions.push(fix);
		}
		if (diag.code === "InvalidDataValue") {
			const fix: CodeAction = {
				title: "Remove Invalid Data Value",
				kind: CodeActionKind.QuickFix,
				diagnostics: [diag],
				edit: {
					changes: {
						[params.textDocument.uri]: [
							{
								range: diag.range,
								newText: "", // Remove the invalid data value
							},
						],
					},
				},
			};
			actions.push(fix);
		}
	}
	return actions;
});

// This handler provides the initial list of the completion items.
connection.onCompletion((textDocumentPosition): CompletionItem[] => {
	const document = documents.get(textDocumentPosition.textDocument.uri);
	if (!document) {
		return [];
	}

	const items: CompletionItem[] = [];
	const text = document.getText();
	const position = textDocumentPosition.position;
	const lineContent = text.split(/\r?\n/)[position.line];

	const charBeforeCursor = lineContent.substring(
		position.character - 1,
		position.character
	);
	if (charBeforeCursor === ":") {
		const componentSuggestions: CompletionItem[] =
			getAllComponentTags().map((tag) => ({
				label: `:${tag}`,
				kind: CompletionItemKind.Class,
				insertText: `${tag} $0 `, // Snippet for component
				insertTextFormat: InsertTextFormat.Snippet,
				detail: `A ${tag} component.`,
				data: tag, // Use tag as data for later resolution
			}));

		items.push(...componentSuggestions);

		// add if, for, data, state and fetch suggestions
		const controlFlowSuggestions: CompletionItem[] = [
			{
				label: ":if",
				kind: CompletionItemKind.Function,
				insertText: "if condition \n\t$0\n",
				insertTextFormat: InsertTextFormat.Snippet,
				detail: "If statement",
				data: "if",
			},
			{
				label: ":for",
				kind: CompletionItemKind.Function,
				insertText: "for item in items \n\t$0\n",
				insertTextFormat: InsertTextFormat.Snippet,
				detail: "For loop",
				data: "for",
			},
			{
				label: ":data",
				kind: CompletionItemKind.Variable,
				insertText: "data key=value $0\n",
				insertTextFormat: InsertTextFormat.Snippet,
				detail: "Data binding",
				data: "data",
			},
			{
				label: ":state",
				kind: CompletionItemKind.Variable,
				insertText: "state key=value $0\n",
				insertTextFormat: InsertTextFormat.Snippet,
				detail: "State management",
				data: "state",
			},
			{
				label: ":fetch",
				kind: CompletionItemKind.Variable,
				insertText: "fetch $0 from '$1'",
				insertTextFormat: InsertTextFormat.Snippet,
				detail: "Fetch data",
				data: "fetch",
			},
			{
				label: ":js",
				kind: CompletionItemKind.Snippet,
				insertText: "js code here $0",
				insertTextFormat: InsertTextFormat.Snippet,
				detail: "JavaScript code block",
				data: "js",
			},
		];
		items.push(...controlFlowSuggestions);
	}

	return items;
});

// This handler resolves additional information for the item selected in
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
	// Resolve additional information for the completion item
	const allComponentSignatures = getAllComponentSignatures();

	allComponentSignatures.forEach((sig) => {
		if (item.data === sig.label) {
			item.detail = "" + sig.label + " details";
			item.documentation = "" + sig.documentation;
			return;
		}
	});

	return item;
});

connection.onHover(({ textDocument }) => {
	// Get the document
	const doc = documents.get(textDocument.uri);
	if (!doc) {
		return undefined;
	}

	// For now, let's return a static hover message.
	// You can implement logic here to determine what to show based on the position.
	// For example, inspect the word at the current position.
	return {
		contents: {
			kind: "markdown",
			value: "Hello from Lunor Language Server! You hovered here.",
		},
	};
});

function getAllComponentTags(): string[] {
	// Return all component tags from the signatures
	return Array.from(componentSignatures.keys());
}

function getAllComponentSignatures(): SignatureInformation[] {
	return Array.from(componentSignatures.values());
}
// Start server only when run directly
if (require.main === module) {
	documents.listen(connection);
	connection.listen();
}
