import { describeRoute, type ResponsesWithResolver } from "hono-openapi";
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

export function choice(...values: string[]) {
    return { ...string, enum: values };
}

export function object(properties: Record<string, Schema>, required = Object.keys(properties)): Schema {
    return { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
}

export function array(items: Schema): Schema {
    return { type: "array", items };
}

export function nullable(schema: Schema): Schema {
    return { anyOf: [schema, { type: "null" }] };
}

export function query(
    name: string,
    schema: NonNullable<OpenAPIV3.ParameterObject["schema"]>,
    required = false,
    description?: string,
): OpenAPIV3.ParameterObject {
    return { in: "query", name, schema, required, description };
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

export function rest(tag: string, summary: string, schema?: Schema, details: RouteDetails = {}) {
    const status = details.status ?? 200;
    const responses: ResponsesWithResolver = schema
        ? { [status]: jsonResponse(status === 201 ? "Data berhasil dibuat." : "Permintaan berhasil.", schema) }
        : {};
    if (status === 204) responses[204] = { description: "Permintaan berhasil tanpa body respons." };

    const errorStatuses = new Set(details.errors);
    if (!details.public) errorStatuses.add(401);
    if (details.body) {
        errorStatuses.add(400);
        errorStatuses.add(413);
    }
    for (const code of errorStatuses) {
        responses[code] = jsonResponse(errors[code], object({ error: string }));
    }

    return describeRoute({
        tags: [tag],
        summary,
        description: details.description,
        security: details.public ? [] : sessionSecurity,
        parameters: details.parameters,
        requestBody: details.body && {
            required: !details.optionalBody,
            content: { "application/json": { schema: details.body } },
        },
        responses: { ...responses, ...details.responses },
    });
}
