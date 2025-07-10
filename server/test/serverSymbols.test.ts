/* eslint-env mocha */
import { expect } from "chai";
import { generateDocumentSymbols } from "../src/documentSymbols";

describe("Document Symbols", () => {
	it("Returns no symbols for non-Lunor files", () => {
		const symbols = generateDocumentSymbols("some text", "file.txt");
		expect(symbols).to.have.lengthOf(0);
	});

	it("Empty Lunor returns empty", () => {
		const symbols = generateDocumentSymbols("", "file.lnr");
		expect(symbols).to.have.lengthOf(0);
	});

	it("Simple component symbol", () => {
		const text = `ComponentTest()`;
		const symbols = generateDocumentSymbols(text, "file.lnr");
		expect(symbols).to.have.lengthOf(1);
		const comp = symbols[0];
		expect(comp.name).to.equal("ComponentTest");
	});

	it("Nested blocks produce correct symbols", () => {
		const text = [
			`MainComponent()`,
			`:for item in items`,
			`:if condition`,
		].join("\n");
		const symbols = generateDocumentSymbols(text, "file.lnr");
		expect(symbols).to.have.lengthOf(1);
		const comp = symbols[0];
		expect(comp.children).to.have.lengthOf(2);
		expect(comp.children![0].name).to.match(/^for item in items$/);
		expect(comp.children![1].name).to.match(/^if condition$/);
	});
});
