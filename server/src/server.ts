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
	Position,
} from "vscode-languageserver/node";

import { TextDocument, TextEdit } from "vscode-languageserver-textdocument";
import { parseLunor } from "./parser/lunorParser";
import { generateReactCode } from "./parser/lunorToJsx";
// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
// let hasDiagnosticRelatedInformationCapability = false;

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
	// hasDiagnosticRelatedInformationCapability = !!(
	// 	capabilities.textDocument &&
	// 	capabilities.textDocument.publishDiagnostics &&
	// 	capabilities.textDocument.publishDiagnostics.relatedInformation
	// );

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			// Tell the client that this server supports code completion.
			completionProvider: {
				resolveProvider: true,
			},
			diagnosticProvider: {
				interFileDependencies: false,
				workspaceDiagnostics: false,
			},
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

connection.onDidChangeTextDocument(async (change) => {
	const document = documents.get(change.textDocument.uri);
	if (!document) {
		return;
	}

	const changeEvent = change.contentChanges[0];
	if (!changeEvent || !("range" in changeEvent)) {
		return;
	} // ✅ varno preverjanje

	const startLine = changeEvent.range.start.line;
	const content = document.getText();
	const lines = content.split(/\r?\n/);
	const fullLine = lines[startLine];

	// Preveri, če vrstica vsebuje @ImeKomponente{...}
	const match = fullLine.trim().match(/^@(\w+)\{.*\}$/);
	if (!match) {
		return;
	}

	// Preveri, če naslednja vrstica že vsebuje @end
	const nextLine = lines[startLine + 1]?.trim();
	if (nextLine === "@end") {
		return;
	}

	// Vstavi @end v naslednjo vrstico
	const edit: TextEdit = {
		range: {
			start: Position.create(startLine + 1, 0),
			end: Position.create(startLine + 1, 0),
		},
		newText: "@end\n",
	};

	await connection.workspace.applyEdit({
		changes: {
			[change.textDocument.uri]: [edit],
		},
	});
});
connection.onInitialized(() => {
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

// The example settings
interface ExampleSettings {
	maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
// const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 };
// let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings = new Map<string, Thenable<ExampleSettings>>();

// eslint-disable-next-line @typescript-eslint/no-unused-vars
connection.onDidChangeConfiguration((change) => {
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

// function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
// 	if (!hasConfigurationCapability) {
// 		return Promise.resolve(globalSettings);
// 	}
// 	let result = documentSettings.get(resource);
// 	if (!result) {
// 		result = connection.workspace.getConfiguration({
// 			scopeUri: resource,
// 			section: "languageServerExample",
// 		});
// 		documentSettings.set(resource, result);
// 	}
// 	return result;
// }

// Only keep settings for open documents
documents.onDidClose((e) => {
	documentSettings.delete(e.document.uri);
});

connection.languages.diagnostics.on(async (params) => {
	const document = documents.get(params.textDocument.uri);
	if (document !== undefined) {
		return {
			kind: DocumentDiagnosticReportKind.Full,
			// items: await validateDocument(document),
			items: [],
		} satisfies DocumentDiagnosticReport;
	} else {
		// We don't know the document. We can either try to read it from disk
		// or we don't report problems for it.
		return {
			kind: DocumentDiagnosticReportKind.Full,
			items: [],
		} satisfies DocumentDiagnosticReport;
	}
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
// documents.onDidChangeContent((change) => {
// 	// validateDocument(change.document);
// });

connection.onRequest("lunor/generateReact", async ({ text }) => {
	try {
		// Parsiraj besedilo in ga pretvori v JSX
		const { ast, diagnostics } = parseLunor(text);
		const jsx = generateReactCode(ast);
		console.log("Problems:", diagnostics);
		return jsx; // Pošlji JSX nazaj klientu
	} catch (err) {
		// Poskrbi za napake pri parserju
		connection.console.error(`Napaka pri pretvorbi Lunor v React: ${err}`);
		return "// Napaka pri pretvorbi"; // Vrni napako, če se nekaj zgodi
	}
});

connection.onDidChangeWatchedFiles((_change) => {
	// Monitored files have change in VSCode
	connection.console.log("We received a file change event");
});

// This handler provides the initial list of the completion items.
connection.onCompletion((textDocumentPosition) => {
	const document = documents.get(textDocumentPosition.textDocument.uri);
	if (!document) {
		return [];
	}

	const text = document.getText();
	const lines = text.split(/\r?\n/);
	const { line } = textDocumentPosition.position;
	const currentLine = lines[line].trim();

	// Če vrstica izgleda kot @Komponenta{...}
	const match = currentLine.match(/^@(\w+)\{.*\}$/);
	if (!match) {
		return [];
	}

	return [
		{
			label: "@end",
			kind: CompletionItemKind.Snippet,
			insertText: "@end",
			detail: `Samodejno zapri komponento "${match[1]}"`,
		},
	];
});

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
	if (item.data === 1) {
		item.detail = "@Card details";
		item.documentation = "@Card documentation";
	} else if (item.data === 2) {
		item.detail = "JavaScript details";
		item.documentation = "JavaScript documentation";
	}
	return item;
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
