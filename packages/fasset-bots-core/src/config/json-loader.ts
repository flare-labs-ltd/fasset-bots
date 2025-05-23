import Ajv, { ErrorObject, JSONSchemaType, ValidateFunction } from "ajv";
import { readFileSync } from "fs";

const ajv = new Ajv({ allowUnionTypes: true });

export interface IJsonLoader<T> {
    load(filename: string): T;
    validate(data: unknown, filename: string): T;
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
        public formatName: string = "JSON",
        public subtypeName?: string,
    ) {}

    getValidator() {
        if (!this.ajvValidator) {
            let schema = typeof this.schema === "string" ? (JSON.parse(readFileSync(this.schema).toString()) as JSONSchemaType<T>) : this.schema;
            if (this.subtypeName != null) {
                const subtypeSchema = schema.definitions?.[this.subtypeName] as any;
                schema = { ...schema, ...subtypeSchema };   // override `properties`, `required` and `type` with subtype defs
            }
            this.ajvValidator = ajv.compile(schema);
        }
        return this.ajvValidator;
    }

    load(filename: string): T {
        const data = JsonLoader.loadSimple(filename);
        return this.validate(data, filename);
    }

    static loadSimple(filename: string): unknown {
        try {
            return JSON.parse(readFileSync(filename).toString());
        } catch (error: any) {
            throw new JsonLoaderError(`Invalid JSON file ${filename}: ${error?.message ?? error}`, []);
        }
    }

    validate(data: unknown, filename: string, subpath?: string): T {
        const validator = this.getValidator();
        const ctx = subpath ? { instancePath: subpath } as any : undefined;
        if (validator(data, ctx)) {
            delete (data as any)["$schema"]; // $schema field is only needed for validation, might interfere otherwise
            return data;
        }
        throw new JsonLoaderError(`Invalid ${this.formatName} format: ${this.formatErrors(validator.errors ?? [])} in ${filename}`, validator.errors ?? []);
    }

    private formatErrors(errors: ErrorObject[]) {
        const linePrefix = errors.length > 1 ? "\n    - " : "";
        return errors.map(err => `${linePrefix}${err.propertyName ?? err.instancePath.replace(/^\//, "")} ${err.message}`).join("");
    }
}
