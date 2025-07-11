/* --------------------------------------------------------------------------------------------
 * Tests for Lunor (.lnr) Document Symbols in the client extension
 * ------------------------------------------------------------------------------------------ */
import * as assert from "assert";
import * as vscode from "vscode";
import { getDocUri, activate } from "./helper";

suite("Lunor Document Symbols", () => {
	const docUri = getDocUri("simple.lnr");

	test("provides component and children symbols", async () => {
		// Activate and open the .lnr fixture
		await activate(docUri);

		// Request document symbols via the language client
		const symbols = (await vscode.commands.executeCommand(
			"vscode.executeDocumentSymbolProvider",
			docUri
		)) as vscode.DocumentSymbol[];

		// Expect a root component symbol
		assert.strictEqual(symbols.length, 1);
		const root = symbols[0];
		assert.strictEqual(root.name, "MyComp");

		// children: state, for, if
		assert.ok(
			Array.isArray(root.children),
			"root.children should be an array"
		);
		assert.strictEqual(root.children!.length, 3);

		assert.strictEqual(
			root.children![0].name,
			"State count",
			"first child should be state"
		);
		assert.match(
			root.children![1].name,
			/^for item in items$/,
			"second child should be for loop"
		);
		assert.match(
			root.children![2].name,
			/^if cond$/,
			"third child should be if condition"
		);
	});
});
