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
} from "vscode-languageserver/node";
import { URI } from "vscode-uri";
import * as fs from "fs";
import * as path from "path";
import * as glob from "fast-glob";
import { TextDocument } from "vscode-languageserver-textdocument";
import { generateReactCode, parseLunor } from "./parser/lunorParser";

let workspaceRoots: string[] = [];
// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents = new TextDocuments(TextDocument);

// In‐memory map of component signatures parsed from first line of each Lunor file
const componentSignatures = new Map<string, SignatureInformation>();
let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);

	if (params.workspaceFolders) {
		workspaceRoots = params.workspaceFolders.map(
			(folder) => URI.parse(folder.uri).fsPath
		);
	} else if (params.rootUri) {
		workspaceRoots = [URI.parse(params.rootUri).fsPath];
	}
	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			// Tell the client that this server supports code completion.
			completionProvider: {
				resolveProvider: true,
				triggerCharacters: [":"], // Add trigger character
			},
			diagnosticProvider: {
				interFileDependencies: false,
				workspaceDiagnostics: false,
			},
			hoverProvider: true, // Enable hover provider
			signatureHelpProvider: {
				triggerCharacters: ["(", ","],
			},
			documentFormattingProvider: true, // Enable document formatting provider
			codeActionProvider: true,
		},
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true,
			},
		};
	}
	return result;
});

// Helper: parse first line of a doc for “Tag(param:type, …)” definitions
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
		label: `${tag}(${parameters.map((p) => p.label).join(", ")})`,
		documentation: `Props for ${tag}`,
		parameters,
	};
	componentSignatures.set(tag, signature);
}

// Update definitions when Lunor docs open or change
documents.onDidOpen((e) => parseComponentDefinition(e.document));
documents.onDidChangeContent((e) => parseComponentDefinition(e.document));

// Provide signature help based on parsed definitions
connection.onSignatureHelp((params: SignatureHelpParams): SignatureHelp => {
	const doc = documents.get(params.textDocument.uri);
	if (!doc) {
		return { signatures: [], activeSignature: 0, activeParameter: 0 };
	}

	// get text up to cursor, match “:Tag(”
	const offset = doc.offsetAt(params.position);
	const pre = doc.getText().slice(0, offset);
	const m = /:(\w+)\s*\($/.exec(pre);
	if (!m) {
		return { signatures: [], activeSignature: 0, activeParameter: 0 };
	}
	const tag = m[1];
	const sigInfo = componentSignatures.get(tag);
	if (!sigInfo) {
		return { signatures: [], activeSignature: 0, activeParameter: 0 };
	}

	// determine active parameter index by counting commas after the “(”
	const afterParen = pre.split("(").pop() || "";
	const activeParam = afterParen.split(",").length - 1;

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
	for (const root of workspaceRoots) {
		const pattern = path.join(root, "**/*.lunor").replace(/\\/g, "/");
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
}
// The example settings
interface ExampleSettings {
	maxNumberOfProblems: number;
}

// Cache the settings of all open documents
const documentSettings = new Map<string, Thenable<ExampleSettings>>();

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
	try {
		// Parsiraj besedilo in ga pretvori v JSX
		console.log("Pretvarjanje Lunor v React JSX ...");
		const { ast, diagnostics, component } = parseLunor(params.text);
		const jsx = generateReactCode(ast, component);
		console.log("Problems:", diagnostics);
		console.log(ast);
		console.log(component);

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
		if (!uri.fsPath.endsWith(".lunor")) {
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

	// New component completion logic
	// Check character before cursor, or use context if available
	const charBeforeCursor = lineContent.substring(
		position.character - 1,
		position.character
	);
	if (charBeforeCursor === ":") {
		const componentSuggestions: CompletionItem[] =
			getAllComponentTags().map((tag) => ({
				label: `:${tag}`,
				kind: CompletionItemKind.Class,
				insertText: `${tag}{\n\t$0\n}`, // Snippet for component
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
// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
