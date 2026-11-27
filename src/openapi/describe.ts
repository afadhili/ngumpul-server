import type { Context, Env, Handler, MiddlewareHandler } from "hono";
import type { HandlerResponse } from "hono/types";
import { describeRoute, type ResponsesWithResolver } from "hono-openapi";
import type { FromSchema, JSONSchema } from "json-schema-to-ts";
import type { OpenAPIV3, OpenAPIV3_1 } from "openapi-types";

export type Schema = OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject;

export const sessionSecurity: OpenAPIV3.SecurityRequirementObject[] = [{ bearerAuth: [] }, { sessionCookie: [] }];

export const string = { type: "string" } as const;
export const boolean = { type: "boolean" } as const;
export const dateTime = { type: "string", format: "date-time" } as const;
export const uri = { type: "string", format: "uri" } as const;

export function text(minLength: number, maxLength: number) {
    return { ...string, minLength, maxLength };
}

export function integer(minimum?: number, maximum?: number) {
    return { type: "integer" as const, minimum, maximum };
}

export function choice<const Values extends string[]>(...values: Values) {
    return { ...string, enum: values };
}

export function object<Properties extends Record<string, Schema>>(properties: Properties): {
    type: "object";
    properties: Properties;
    required: (keyof Properties & string)[];
};
export function object<Properties extends Record<string, Schema>, const Required extends string[]>(
    properties: Properties,
    required: Required,
): { type: "object"; properties: Properties } & (Required extends [] ? {} : { required: Required });
export function object(properties: Record<string, Schema>, required = Object.keys(properties)): Schema {
    return { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
}

export function array<const Items extends Schema>(items: Items) {
    return { type: "array" as const, items };
}

export function anyOf<const Variants extends Schema[]>(...variants: Variants) {
    return { anyOf: variants };
}

export function nullable<const Value extends Schema>(schema: Value) {
    return anyOf(schema, { type: "null" });
}

export function query<Name extends string, const Value extends Schema, Required extends boolean = false>(
    name: Name,
    schema: Value,
    required: Required = false as Required,
    description?: string,
) {
    return { in: "query" as const, name, schema, required, description };
}

export function jsonResponse(description: string, schema: Schema): ResponsesWithResolver[string] {
    return { description, content: { "application/json": { schema } } };
}

export function redirectResponse(description: string) {
    return { description, headers: { Location: { schema: uri } } };
}

const errors = {
    400: "Input tidak valid.",
    401: "Sesi tidak valid atau diperlukan.",
    403: "Akses ditolak.",
    404: "Data tidak ditemukan atau akses dibatasi.",
    409: "Permintaan bertentangan dengan kondisi data saat ini.",
    410: "Kode atau izin sudah kedaluwarsa.",
    413: "Ukuran request atau file melebihi batas.",
    415: "Jenis konten tidak didukung.",
    500: "Terjadi kesalahan pada server.",
    502: "Layanan pendukung gagal merespons.",
    503: "Layanan pendukung tidak tersedia.",
} as const;

type RouteDetails = {
    description?: string;
    public?: boolean;
    body?: Schema;
    optionalBody?: boolean;
    parameters?: OpenAPIV3.ParameterObject[];
    status?: 200 | 201 | 204;
    errors?: (keyof typeof errors)[];
    responses?: ResponsesWithResolver;
};

type QueryParameter = ReturnType<typeof query<string, Schema, boolean>>;
type QueryParameters<Details> = Details extends { parameters: (infer Parameter)[] }
    ? Extract<Parameter, QueryParameter>
    : never;

type QueryValue<Value> = Value extends { enum: (infer Choice extends string)[] } ? Choice
    : Value extends { type: "boolean" } ? "true" | "false"
    : string;

type RequiredQuery<Parameter> = Extract<Parameter, { required: true }>;
type QueryFields<Parameter extends QueryParameter> = {
    [Field in RequiredQuery<Parameter> as Field["name"]]: QueryValue<Field["schema"]>;
} & {
    [Field in Exclude<Parameter, RequiredQuery<Parameter>> as Field["name"]]?: QueryValue<Field["schema"]>;
};

type RequestQuery<Parameter extends QueryParameter> = [Parameter] extends [never] ? {}
    : [RequiredQuery<Parameter>] extends [never] ? { query?: QueryFields<Parameter> }
    : { query: QueryFields<Parameter> };

type RequestBody<Details> = Details extends { body: infer Body extends JSONSchema }
    ? Details extends { optionalBody: true }
        ? { json?: FromSchema<Body, { keepDefaultedPropertiesOptional: true }> }
        : { json: FromSchema<Body, { keepDefaultedPropertiesOptional: true }> }
    : {};

type RequestInput<Details> = { in: RequestQuery<QueryParameters<Details>> & RequestBody<Details> };

export function rest<Result extends HandlerResponse<unknown>, const Details extends RouteDetails = {}>(
    handler: (c: Context) => Result,
    tag: string,
    summary: string,
    schema?: Schema,
    details?: Details,
): [MiddlewareHandler, Handler<Env, string, RequestInput<Details>, Result>] {
    const options: RouteDetails = details ?? {};
    const status = options.status ?? 200;
    const responses: ResponsesWithResolver = schema
        ? { [status]: jsonResponse(status === 201 ? "Data berhasil dibuat." : "Permintaan berhasil.", schema) }
        : {};
    if (status === 204) responses[204] = { description: "Permintaan berhasil tanpa body respons." };

    const errorStatuses = new Set(options.errors);
    if (!options.public) errorStatuses.add(401);
    if (options.body) {
        errorStatuses.add(400);
        errorStatuses.add(413);
    }
    for (const code of errorStatuses) {
        responses[code] = jsonResponse(errors[code], object({ error: string }));
    }

    // The request schema types RPC input. Controllers validate raw requests after their access checks.
    const documentation = describeRoute({
        tags: [tag],
        summary,
        description: options.description,
        security: options.public ? [] : sessionSecurity,
        parameters: options.parameters,
        requestBody: options.body && {
            required: !options.optionalBody,
            content: { "application/json": { schema: options.body } },
        },
        responses: { ...responses, ...options.responses },
    });
    return [documentation, handler];
}
