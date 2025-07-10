/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-env mocha */

import { expect } from "chai";
import { parseLunor } from "../src/parser/lunorParser";

describe("lunorParser", () => {
	it("should error on empty file", () => {
		const { ast, diagnostics, component } = parseLunor("");
		expect(ast).to.be.an("array").that.is.empty;
		expect(component).to.be.null;
		expect(diagnostics).to.have.lengthOf(1);
		expect(diagnostics[0].code).to.equal("EmptyFile");
	});

	it("should parse simple component with no props", () => {
		const text = `MyComp()`;
		const { ast, diagnostics, component } = parseLunor(text);
		expect(diagnostics).to.be.empty;
		expect(component).to.not.be.null;
		expect(component?.name).to.equal("MyComp");
		expect(component?.props).to.be.an("array").that.is.empty;
		expect(ast).to.be.an("array").that.is.empty;
	});
});
