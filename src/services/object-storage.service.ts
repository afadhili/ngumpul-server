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

const bucket = process.env.S3_BUCKET;
const region = process.env.S3_REGION ?? "us-east-1";
const endpoint = process.env.S3_ENDPOINT;
const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT ?? endpoint;
const credentials = process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
    : undefined;

const internalClient = createClient(endpoint);
const publicClient = publicEndpoint === endpoint ? internalClient : createClient(publicEndpoint);

export async function ensureBucketExists() {
    const client = requireClient(internalClient);
    const bucketName = requireBucket();
    try {
        await client.send(new HeadBucketCommand({ Bucket: bucketName }));
        return;
    } catch (error) {
        if (process.env.S3_AUTO_CREATE_BUCKET !== "true" || !isMissingBucket(error)) throw error;
    }

    try {
        await client.send(new CreateBucketCommand({ Bucket: bucketName }));
    } catch (error) {
        if (!isBucketAlreadyOwned(error)) throw error;
    }
}

export async function createAttachmentUploadForm(key: string, mimeType: string, maxBytes: number) {
    const client = requireClient(publicClient);
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
    return requireClient(internalClient).send(new HeadObjectCommand({ Bucket: requireBucket(), Key: key }));
}

export async function finalizeUploadedObject(uploadKey: string, storageKey: string, mimeType: string, fileName: string) {
    const safeName = encodeURIComponent(fileName).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    const disposition = /^(image|audio|video)\//.test(mimeType) ? "inline" : "attachment";
    await requireClient(internalClient).send(new CopyObjectCommand({
        Bucket: requireBucket(),
        Key: storageKey,
        CopySource: `${requireBucket()}/${encodeURIComponent(uploadKey).replace(/%2F/g, "/")}`,
        MetadataDirective: "REPLACE",
        ContentType: mimeType,
        ContentDisposition: `${disposition}; filename*=UTF-8''${safeName}`,
        Metadata: { originalfilename: fileName },
    }));
    await deleteObject(uploadKey);
}

export async function createAttachmentDownloadUrl(key: string, mimeType: string, fileName: string) {
    const safeName = encodeURIComponent(fileName).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    const disposition = /^(image|audio|video)\//.test(mimeType) ? "inline" : "attachment";
    const command = new GetObjectCommand({
        Bucket: requireBucket(),
        Key: key,
        ResponseContentType: mimeType,
        ResponseContentDisposition: `${disposition}; filename*=UTF-8''${safeName}`,
    });
    return getSignedUrl(requireClient(publicClient), command, { expiresIn: 300 });
}

export async function deleteObject(key: string) {
    await requireClient(internalClient).send(new DeleteObjectCommand({ Bucket: requireBucket(), Key: key }));
}

function createClient(clientEndpoint: string | undefined) {
    return new S3Client({
        region,
        ...(clientEndpoint ? { endpoint: clientEndpoint, forcePathStyle: true } : {}),
        ...(credentials ? { credentials } : {}),
    });
}

function requireBucket() {
    if (!bucket) throw new Error("S3_BUCKET is required");
    return bucket;
}

function requireClient(client: S3Client) {
    requireBucket();
    return client;
}

function isMissingBucket(error: unknown) {
    if (typeof error !== "object" || error === null) return false;
    const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    return value.name === "NotFound" || value.name === "NoSuchBucket" || value.$metadata?.httpStatusCode === 404;
}

function isBucketAlreadyOwned(error: unknown) {
    return typeof error === "object" && error !== null && "name" in error
        && (error.name === "BucketAlreadyOwnedByYou" || error.name === "BucketAlreadyExists");
}
