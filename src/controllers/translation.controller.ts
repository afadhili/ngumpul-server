import type { Context } from "hono";
import { getSessionUserId } from "../lib/request-auth";

const MAX_TEXT = 4000;
const MAX_LANGUAGES = 40;

export async function listTranslationLanguages(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    if (!process.env.TRANSLATE_API_URL) {
        return c.json({ error: "Translation service is not configured" }, 503);
    }
    return c.json({
        languages: [
            { code: "id", name: "Indonesian" },
            { code: "en", name: "English" },
            { code: "ms", name: "Malay" },
            { code: "zh", name: "Chinese" },
            { code: "ja", name: "Japanese" },
            { code: "ko", name: "Korean" },
            { code: "ar", name: "Arabic" },
            { code: "es", name: "Spanish" },
            { code: "fr", name: "French" },
            { code: "de", name: "German" },
        ].slice(0, MAX_LANGUAGES),
    }, 200);
}

export async function translateMessage(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const endpoint = process.env.TRANSLATE_API_URL;
    if (!endpoint) return c.json({ error: "Translation service is not configured" }, 503);

    let body: unknown;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return c.json({ error: "Request body must be an object" }, 400);
    }
    const record = body as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (text.length === 0 || text.length > MAX_TEXT) {
        return c.json({ error: `text must contain between 1 and ${MAX_TEXT} characters` }, 400);
    }
    const targetLanguage = typeof record.targetLanguage === "string" ? record.targetLanguage.trim().toLowerCase() : "";
    if (!/^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(targetLanguage)) {
        return c.json({ error: "targetLanguage must be a language code such as en or pt-BR" }, 400);
    }
    const sourceLanguage = typeof record.sourceLanguage === "string" && /^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(record.sourceLanguage)
        ? record.sourceLanguage
        : "auto";

    let response: Response;
    try {
        response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ q: text, source: sourceLanguage, target: targetLanguage, format: "text" }),
            signal: AbortSignal.timeout(10_000),
        });
    } catch (error) {
        console.error("Translation request failed:", error);
        return c.json({ error: "Translation service is unavailable" }, 502);
    }
    if (!response.ok) {
        console.error("Translation service returned", response.status);
        return c.json({ error: "Translation service is unavailable" }, 502);
    }
    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        return c.json({ error: "Translation service returned an invalid response" }, 502);
    }
    const translated = typeof payload === "object" && payload !== null
        ? (payload as Record<string, unknown>).translatedText
        : null;
    if (typeof translated !== "string") {
        return c.json({ error: "Translation service returned an invalid response" }, 502);
    }
    return c.json({
        translation: {
            text: translated,
            sourceLanguage,
            targetLanguage,
        },
    }, 200);
}
