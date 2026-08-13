// src/utils/autodarts.js
export function extractAutodartsMatchId(url) {
    if (!url) return null;

    // New submissions use .com, but historical results still contain .io links.
    const regex =
        /^https:\/\/play\.autodarts\.(?:com|io)\/history\/matches\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

    const m = String(url).trim().match(regex);
    return m ? m[1] : null;
}
