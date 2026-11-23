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
