import Ajv, { JSONSchemaType, ValidateFunction } from "ajv";
import { readFileSync } from "fs";

const ajv = new Ajv({ allowUnionTypes: true });

export class JsonLoader<T> {
    private ajvValidator?: ValidateFunction<T>;

    constructor(
        public schema: string | JSONSchemaType<T>,
        public formatName: string = "JSON"
    ) {}

    getValidator() {
        if (!this.ajvValidator) {
            const schema = typeof this.schema === "string" ? (JSON.parse(readFileSync(this.schema).toString()) as JSONSchemaType<T>) : this.schema;
            this.ajvValidator = ajv.compile(schema);
        }
        return this.ajvValidator;
    }

    load(filename: string): T {
        const data = JSON.parse(readFileSync(filename).toString());
        return this.validate(data);
    }

    validate(data: unknown): T {
        const validator = this.getValidator();
        if (validator(data)) {
            delete (data as any)["$schema"]; // $schema field is only needed for validation, might interfere otherwise
            return data;
        }
        throw new Error(`Invalid ${this.formatName} format: ${JSON.stringify(validator.errors)}`);
    }
}
