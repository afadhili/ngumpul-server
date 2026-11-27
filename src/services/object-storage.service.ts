import {
    CreateBucketCommand,
    CopyObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand,
    HeadObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { dependencyEndpoint, logDependencyError } from "../lib/dependency-errors";

const bucket = process.env.S3_BUCKET;
const region = process.env.S3_REGION ?? "us-east-1";
const endpoint = process.env.S3_ENDPOINT;
const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT ?? endpoint;
const credentials = process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
    : undefined;

let clients: { internal: S3Client; public: S3Client; host?: string } | undefined;
let bucketReady: Promise<void> | undefined;

function getClients() {
    if (clients) return clients;
    const host = dependencyEndpoint(endpoint, ["http:", "https:"], "S3_ENDPOINT");
    dependencyEndpoint(publicEndpoint, ["http:", "https:"], "S3_PUBLIC_ENDPOINT");
    const internal = createClient(endpoint);
    clients = { internal, public: publicEndpoint === endpoint ? internal : createClient(publicEndpoint), host };
    return clients;
}

export function ensureBucketExists() {
    bucketReady ??= checkBucket().catch(error => {
        bucketReady = undefined;
        logDependencyError("object-storage", clients?.host, error);
        throw error;
    });
    return bucketReady;
}

async function checkBucket() {
    const client = getClients().internal;
    const bucketName = requireBucket();
    try {
        await client.send(new HeadBucketCommand({ Bucket: bucketName }));
        return;
    } catch (error) {
        if (process.env.S3_AUTO_CREATE_BUCKET !== "true" || !isMissingObject(error)) throw error;
    }

    try {
        await client.send(new CreateBucketCommand({ Bucket: bucketName }));
    } catch (error) {
        if (!isBucketAlreadyOwned(error)) throw error;
    }
}

export async function createAttachmentUploadForm(key: string, mimeType: string, maxBytes: number) {
    await ensureBucketExists();
    const client = getClients().public;
    return createPresignedPost(client, {
        Bucket: requireBucket(),
        Key: key,
        Expires: 300,
        Fields: { "Content-Type": mimeType },
        Conditions: [
            ["content-length-range", 1, maxBytes],
            ["eq", "$Content-Type", mimeType],
            ["eq", "$key", key],
        ],
    });
}

export async function inspectObject(key: string) {
    await ensureBucketExists();
    return getClients().internal.send(new HeadObjectCommand({ Bucket: requireBucket(), Key: key }));
}

export async function readObjectPrefix(key: string, maxBytes: number) {
    await ensureBucketExists();
    const result = await getClients().internal.send(new GetObjectCommand({
        Bucket: requireBucket(),
        Key: key,
        Range: `bytes=0-${Math.max(0, maxBytes - 1)}`,
    }));
    if (!result.Body) return null;
    const bytes = await result.Body.transformToByteArray();
    return bytes.subarray(0, maxBytes);
}

export async function copyUploadedObject(uploadKey: string, storageKey: string, mimeType: string, fileName: string) {
    await ensureBucketExists();
    const safeName = encodeURIComponent(fileName).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    const disposition = /^(image|audio|video)\//.test(mimeType) ? "inline" : "attachment";
    await getClients().internal.send(new CopyObjectCommand({
        Bucket: requireBucket(),
        Key: storageKey,
        CopySource: `${requireBucket()}/${encodeURIComponent(uploadKey).replace(/%2F/g, "/")}`,
        MetadataDirective: "REPLACE",
        ContentType: mimeType,
        ContentDisposition: `${disposition}; filename*=UTF-8''${safeName}`,
        Metadata: { originalfilename: encodeURIComponent(fileName) },
    }));
}

export async function createAttachmentDownloadUrl(key: string, mimeType: string, fileName: string) {
    await ensureBucketExists();
    const disposition = /^(image|audio|video)\//.test(mimeType) ? "inline" : "attachment";
    return createAttachmentUrl(key, mimeType, fileName, disposition);
}

export async function createAttachmentPreviewUrl(key: string, mimeType: string, fileName: string) {
    await ensureBucketExists();
    return createAttachmentUrl(key, mimeType, fileName, "inline");
}

async function createAttachmentUrl(key: string, mimeType: string, fileName: string, disposition: "inline" | "attachment") {
    const safeName = encodeURIComponent(fileName).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    const command = new GetObjectCommand({
        Bucket: requireBucket(),
        Key: key,
        ResponseContentType: mimeType,
        ResponseContentDisposition: `${disposition}; filename*=UTF-8''${safeName}`,
    });
    return getSignedUrl(getClients().public, command, { expiresIn: 300 });
}

export async function deleteObject(key: string) {
    await ensureBucketExists();
    await getClients().internal.send(new DeleteObjectCommand({ Bucket: requireBucket(), Key: key }));
}

function createClient(clientEndpoint: string | undefined) {
    return new S3Client({
        region,
        maxAttempts: 2,
        requestHandler: { connectionTimeout: 2_000, requestTimeout: 10_000, throwOnRequestTimeout: true },
        ...(clientEndpoint ? { endpoint: clientEndpoint, forcePathStyle: true } : {}),
        ...(credentials ? { credentials } : {}),
    });
}

function requireBucket() {
    if (!bucket) throw new Error("S3_BUCKET is required");
    return bucket;
}

export function isMissingObject(error: unknown) {
    if (typeof error !== "object" || error === null) return false;
    const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    return value.name === "NotFound" || value.name === "NoSuchBucket" || value.name === "NoSuchKey" || value.$metadata?.httpStatusCode === 404;
}

function isBucketAlreadyOwned(error: unknown) {
    return typeof error === "object" && error !== null && "name" in error
        && error.name === "BucketAlreadyOwnedByYou";
}

export function closeObjectStorage() {
    if (!clients) return;
    clients.internal.destroy();
    if (clients.public !== clients.internal) clients.public.destroy();
}
