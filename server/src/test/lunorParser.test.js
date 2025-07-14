"use strict";
/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-env mocha */
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const lunorParser_1 = require("../src/parser/lunorParser");
describe("lunorParser", () => {
    it("should error on empty file", () => {
        const { ast, diagnostics, component } = (0, lunorParser_1.parseLunor)("");
        (0, chai_1.expect)(ast).to.be.an("array").that.is.empty;
        (0, chai_1.expect)(component).to.be.null;
        (0, chai_1.expect)(diagnostics).to.have.lengthOf(1);
        (0, chai_1.expect)(diagnostics[0].code).to.equal("EmptyFile");
    });
    it("should parse simple component with no props", () => {
        const text = `MyComp()`;
        const { ast, diagnostics, component } = (0, lunorParser_1.parseLunor)(text);
        (0, chai_1.expect)(diagnostics).to.be.empty;
        (0, chai_1.expect)(component).to.not.be.null;
        (0, chai_1.expect)(component?.name).to.equal("MyComp");
        (0, chai_1.expect)(component?.props).to.be.an("array").that.is.empty;
        (0, chai_1.expect)(ast).to.be.an("array").that.is.empty;
    });
});
//# sourceMappingURL=lunorParser.test.js.map