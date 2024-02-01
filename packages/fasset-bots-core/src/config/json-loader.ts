import Ajv, { ErrorObject, JSONSchemaType, ValidateFunction } from "ajv";
import { readFileSync } from "fs";

const ajv = new Ajv({ allowUnionTypes: true });

export interface IJsonLoader<T> {
    load(filename: string): T;
    validate(data: unknown): T;
}

export class JsonLoaderError extends Error {
    constructor(
        message: string,
        public validatorErrors: ErrorObject[]
    ) {
        super(message);
    }
}

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
        throw new JsonLoaderError(`Invalid ${this.formatName} format: ${this.formatErrors(validator.errors ?? [])}`, validator.errors ?? []);
    }

    private formatErrors(errors: ErrorObject[]) {
        const linePrefix = errors.length > 1 ? "\n    - " : "";
        return errors.map(err => `${linePrefix}${err.propertyName ?? err.instancePath.replace(/^\//, "")} ${err.message}`).join("");
    }
}
