/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from "path";
import * as fs from "fs";
import {
	workspace,
	ExtensionContext,
	commands,
	window,
	languages,
	TextDocument,
	Position,
	CancellationToken,
	Hover,
	MarkdownString,
	SignatureHelp,
	// DocumentHighlight,
	DocumentRangeFormattingEditProvider,
	FormattingOptions,
	ProviderResult,
	Range,
	TextEdit,
} from "vscode";

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient;

class LunorDocumentRangeFormatter
	implements DocumentRangeFormattingEditProvider
{
	public provideDocumentRangeFormattingEdits(
		document: TextDocument,
		range: Range,
		options: FormattingOptions,
		token: CancellationToken
	): ProviderResult<TextEdit[]> {
		const params = {
			textDocument: { uri: document.uri.toString() },
			range: {
				start: {
					line: range.start.line,
					character: range.start.character,
				},
				end: { line: range.end.line, character: range.end.character },
			},
			options,
		};

		return client.sendRequest<TextEdit[]>(
			"textDocument/rangeFormatting",
			params,
			token
		);
	}
}

export function activate(context: ExtensionContext) {
	// The server is implemented in node
	const serverModule = context.asAbsolutePath(
		path.join("server", "out", "server.js")
	);

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
		},
	};

	// Options to control the language client
	const clientOptions: LanguageClientOptions = {
		// Register the server for plain text documents
		documentSelector: [{ scheme: "file", language: "lunor" }],
		synchronize: {
			// Notify the server about file changes to '.clientrc files contained in the workspace
			fileEvents: [
				workspace.createFileSystemWatcher("**/.clientrc"),
				workspace.createFileSystemWatcher("**/*.lnr"),
			],
		},
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		"languageServerExample",
		"Language Server Example",
		serverOptions,
		clientOptions
	);

	// Start the client. This will also launch the server
	client.start();
	context.subscriptions.push(
		languages.registerHoverProvider("lunor", {
			async provideHover(
				document: TextDocument,
				position: Position,
				token: CancellationToken
			): Promise<Hover | undefined> {
				const params = {
					textDocument: { uri: document.uri.toString() },
					position: position,
				};
				// Request hover information from the server
				const result = await client.sendRequest<string>(
					"textDocument/hover",
					params,
					token
				);
				if (result) {
					return new Hover(new MarkdownString(result));
				}
				return undefined;
			},
		})
	);

	context.subscriptions.push(
		languages.registerDocumentRangeFormattingEditProvider(
			"lunor",
			new LunorDocumentRangeFormatter()
		)
	);

	// // on save
	// context.subscriptions.push(
	// 	workspace.onDidSaveTextDocument((document) => {
	// 		if (document.languageId === "lunor") {
	// 			const params = {
	// 				textDocument: { uri: document.uri.toString() },
	// 			};
	// 			client
	// 				.sendRequest("textDocument/didSave", params)
	// 				.catch((err) => {
	// 					console.error(
	// 						`Error while saving document ${document.uri.toString()}:`,
	// 						err
	// 					);
	// 					window.showErrorMessage(
	// 						`Napaka pri shranjevanju dokumenta: ${document.uri.toString()}`
	// 					);
	// 				});
	// 		}
	// 	})
	// );

	context.subscriptions.push(
		languages.registerSignatureHelpProvider(
			"lunor",
			{
				async provideSignatureHelp(
					document: TextDocument,
					position: Position,
					token: CancellationToken
				): Promise<SignatureHelp | undefined> {
					const params = {
						textDocument: { uri: document.uri.toString() },
						position,
					};
					const result = await client.sendRequest<SignatureHelp>(
						"textDocument/signatureHelp",
						params,
						token
					);
					return result;
				},
			},
			"(",
			"," // trigger on "(" and on comma between parameters
		)
	);

	context.subscriptions.push(
		commands.registerCommand("lunor.processAllFiles", async () => {
			const projectRoot = workspace.workspaceFolders?.[0].uri.fsPath;
			if (!projectRoot) {
				window.showErrorMessage("Projektna mapa ni najdena.");
				return;
			}
			const lunorDir = path.join(projectRoot, "lunor");
			if (!fs.existsSync(lunorDir)) {
				window.showErrorMessage("Lunor mapa ne obstaja.");
				return;
			}

			// pogledamo tudi podmape
			const lunorFiles = fs
				.readdirSync(lunorDir, { withFileTypes: true })
				.flatMap((dirent) => {
					if (dirent.isDirectory()) {
						return fs
							.readdirSync(path.join(lunorDir, dirent.name))
							.filter((file) => file.endsWith(".lnr"))
							.map((file) => path.join(dirent.name, file));
					} else if (
						dirent.isFile() &&
						dirent.name.endsWith(".lnr")
					) {
						return [dirent.name];
					}
					return [];
				});

			if (lunorFiles.length === 0) {
				window.showInformationMessage("Ni najdenih lunor datotek.");
				return;
			}

			for (const file of lunorFiles) {
				const filePath = path.join(lunorDir, file);
				const doc = await workspace.openTextDocument(filePath);
				await window.showTextDocument(doc);

				// Pošlji besedilo strežniku
				const text = doc.getText();
				const result = await client.sendRequest<string>(
					"lunor/generateReact",
					{
						uri: doc.uri.toString(),
						text,
					}
				);

				if (!result) {
					window.showErrorMessage(
						`Pretvorba datoteke ${file} ni uspela.`
					);
					continue;
				}

				const relativePath = path.relative(
					path.join(projectRoot, "lunor"),
					filePath
				);
				const parsed = path.parse(relativePath);

				const outputDir = path.join(projectRoot, "src", parsed.dir);
				const outputFile = path.join(outputDir, parsed.name + ".tsx");

				if (!fs.existsSync(outputDir)) {
					fs.mkdirSync(outputDir, { recursive: true });
				}

				fs.writeFileSync(outputFile, result, "utf-8");

				window.showInformationMessage(
					`React component created: ${path.relative(
						projectRoot,
						outputFile
					)}`
				);
			}
			window.showInformationMessage(
				"All lunor files processed successfully."
			);
		})
	);

	context.subscriptions.push(
		commands.registerCommand("lunor.generateReact", async () => {
			const editor = window.activeTextEditor;
			if (!editor) {
				window.showErrorMessage("Ni odprtega urejevalnika.");
				return;
			}

			const doc = editor.document;
			if (doc.languageId !== "lunor") {
				window.showErrorMessage("File is not a Lunor file.");
				return;
			}
			const text = doc.getText();

			// Pošlji besedilo strežniku
			const result = await client.sendRequest<string>(
				"lunor/generateReact",
				{
					uri: doc.uri.toString(),
					text,
				}
			);

			if (!result) {
				window.showErrorMessage("Pretvorba ni uspela.");
				return;
			}

			const projectRoot = workspace.workspaceFolders?.[0].uri.fsPath;
			if (!projectRoot) {
				window.showErrorMessage("Projektna mapa ni najdena.");
				return;
			}
			const docPath = doc.uri.fsPath;

			// Pot od lunor mape naprej
			const relativePath = path.relative(
				path.join(projectRoot, "lunor"),
				docPath
			);
			const parsed = path.parse(relativePath);

			const outputDir = path.join(projectRoot, "src", parsed.dir);
			const outputFile = path.join(outputDir, parsed.name + ".tsx");

			if (!fs.existsSync(outputDir)) {
				fs.mkdirSync(outputDir, { recursive: true });
			}

			fs.writeFileSync(outputFile, result, "utf-8");

			window.showInformationMessage(
				`React component created: ${path.relative(
					projectRoot,
					outputFile
				)}`
			);
		})
	);
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
