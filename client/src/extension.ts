/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from "path";
import * as fs from "fs";
import { workspace, ExtensionContext, commands, window } from "vscode";

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient;

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
			fileEvents: workspace.createFileSystemWatcher("**/.clientrc"),
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
		commands.registerCommand("lunor.generateReact", async () => {
			const editor = window.activeTextEditor;
			if (!editor) {
				window.showErrorMessage("Ni odprtega urejevalnika.");
				return;
			}

			const doc = editor.document;
			if (doc.languageId !== "lunor") {
				window.showErrorMessage("Datoteka ni v lunor jeziku.");
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

			// 🔍 Pot od lunor mape naprej
			const relativePath = path.relative(
				path.join(projectRoot, "lunor"),
				docPath
			);
			const parsed = path.parse(relativePath);

			const outputDir = path.join(
				projectRoot,
				"src",
				"pages",
				parsed.dir
			);
			const outputFile = path.join(outputDir, parsed.name + ".tsx");

			if (!fs.existsSync(outputDir)) {
				fs.mkdirSync(outputDir, { recursive: true });
			}

			fs.writeFileSync(outputFile, result, "utf-8");

			window.showInformationMessage(
				`React komponenta ustvarjena: ${path.relative(
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
