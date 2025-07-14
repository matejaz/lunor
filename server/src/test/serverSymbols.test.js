"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-env mocha */
const chai_1 = require("chai");
const documentSymbols_1 = require("../src/documentSymbols");
describe("Document Symbols", () => {
    it("Returns no symbols for non-Lunor files", () => {
        const symbols = (0, documentSymbols_1.generateDocumentSymbols)("some text", "file.txt");
        (0, chai_1.expect)(symbols).to.have.lengthOf(0);
    });
    it("Empty Lunor returns empty", () => {
        const symbols = (0, documentSymbols_1.generateDocumentSymbols)("", "file.lnr");
        (0, chai_1.expect)(symbols).to.have.lengthOf(0);
    });
    it("Simple component symbol", () => {
        const text = `ComponentTest()`;
        const symbols = (0, documentSymbols_1.generateDocumentSymbols)(text, "file.lnr");
        (0, chai_1.expect)(symbols).to.have.lengthOf(1);
        const comp = symbols[0];
        (0, chai_1.expect)(comp.name).to.equal("ComponentTest");
    });
    it("Nested blocks produce correct symbols", () => {
        const text = [
            `MainComponent()`,
            `:for item in items`,
            `:if condition`,
        ].join("\n");
        const symbols = (0, documentSymbols_1.generateDocumentSymbols)(text, "file.lnr");
        (0, chai_1.expect)(symbols).to.have.lengthOf(1);
        const comp = symbols[0];
        (0, chai_1.expect)(comp.children).to.have.lengthOf(2);
        (0, chai_1.expect)(comp.children[0].name).to.match(/^for item in items$/);
        (0, chai_1.expect)(comp.children[1].name).to.match(/^if condition$/);
    });
});
//# sourceMappingURL=serverSymbols.test.js.map