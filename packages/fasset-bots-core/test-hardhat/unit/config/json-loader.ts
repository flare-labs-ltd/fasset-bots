import { expect } from "chai";
import { JsonLoader } from "../../../src/config/json-loader";
import { JSONSchemaType } from "ajv";

interface MyData {
    foo: number;
    bar?: string;
}

const schema: JSONSchemaType<MyData> = {
    type: "object",
    properties: {
        foo: { type: "integer" },
        bar: { type: "string", nullable: true },
    },
    required: ["foo"],
    additionalProperties: false,
};

describe("Json loader unit tests", () => {
    it("Should create tracked state config", async () => {
        const botConfigLoader = new JsonLoader<MyData>(schema);
        expect(botConfigLoader.formatName).to.eq("JSON");
        const configPath: string = "./test-hardhat/test-utils/run-config-tests/run-config-missing-contracts-and-addressUpdater.json";
        const fn = () => {
            botConfigLoader.load(configPath);
        };
        expect(fn).to.throw("Invalid JSON format:");
    });
});
