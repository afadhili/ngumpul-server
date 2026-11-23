const MiB = 1024 * 1024;

export const attachmentPolicies = new Map([
    ["image/jpeg", { category: "image", maxBytes: 20 * MiB }],
    ["image/png", { category: "image", maxBytes: 20 * MiB }],
    ["image/webp", { category: "image", maxBytes: 20 * MiB }],
    ["image/gif", { category: "image", maxBytes: 20 * MiB }],
    ["video/mp4", { category: "video", maxBytes: 200 * MiB }],
    ["video/webm", { category: "video", maxBytes: 200 * MiB }],
    ["video/quicktime", { category: "video", maxBytes: 200 * MiB }],
    ["audio/mpeg", { category: "audio", maxBytes: 50 * MiB }],
    ["audio/mp4", { category: "audio", maxBytes: 50 * MiB }],
    ["audio/ogg", { category: "audio", maxBytes: 50 * MiB }],
    ["audio/webm", { category: "audio", maxBytes: 50 * MiB }],
    ["audio/wav", { category: "audio", maxBytes: 50 * MiB }],
    ["audio/x-m4a", { category: "audio", maxBytes: 50 * MiB }],
    ["application/pdf", { category: "document", maxBytes: 50 * MiB }],
    ["application/msword", { category: "document", maxBytes: 50 * MiB }],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", { category: "document", maxBytes: 50 * MiB }],
    ["application/vnd.ms-excel", { category: "document", maxBytes: 50 * MiB }],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", { category: "document", maxBytes: 50 * MiB }],
    ["application/vnd.ms-powerpoint", { category: "document", maxBytes: 50 * MiB }],
    ["application/vnd.openxmlformats-officedocument.presentationml.presentation", { category: "document", maxBytes: 50 * MiB }],
    ["text/plain", { category: "document", maxBytes: 10 * MiB }],
]);

export type AttachmentCategory = "image" | "video" | "audio" | "document";

const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/**
 * Verifies that an uploaded object's leading bytes are consistent with the MIME
 * type the client declared. Declared Content-Type alone is never trusted.
 */
export function matchesDeclaredMimeType(mimeType: string, bytes: Uint8Array) {
    if (bytes.length === 0) return false;
    switch (mimeType) {
        case "image/jpeg":
            return startsWith(bytes, [0xff, 0xd8, 0xff]);
        case "image/png":
            return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        case "image/webp":
            return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
        case "image/gif":
            return ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a";
        case "video/mp4":
        case "video/quicktime":
        case "audio/mp4":
        case "audio/x-m4a":
            return ascii(bytes, 4, 4) === "ftyp";
        case "video/webm":
        case "audio/webm":
            return startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
        case "audio/mpeg":
            return ascii(bytes, 0, 3) === "ID3"
                || (bytes[0] === 0xff && bytes[1] !== undefined && (bytes[1] & 0xe0) === 0xe0);
        case "audio/ogg":
            return ascii(bytes, 0, 4) === "OggS";
        case "audio/wav":
            return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE";
        case "application/pdf":
            return ascii(bytes, 0, 5) === "%PDF-";
        case "application/msword":
        case "application/vnd.ms-excel":
        case "application/vnd.ms-powerpoint":
            return startsWith(bytes, OLE_SIGNATURE);
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
            return ascii(bytes, 0, 2) === "PK";
        case "text/plain":
            return bytes.every(byte => byte >= 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d || byte >= 0x80);
        default:
            return false;
    }
}

function startsWith(bytes: Uint8Array, signature: number[]) {
    return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
    if (bytes.length < offset + length) return "";
    let value = "";
    for (let index = 0; index < length; index += 1) value += String.fromCharCode(bytes[offset + index]);
    return value;
}
