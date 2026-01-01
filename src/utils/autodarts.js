// src/utils/autodarts.js
export function extractAutodartsMatchId(url) {
    if (!url) return null;

    const regex =
        /^https:\/\/play\.autodarts\.io\/history\/matches\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

    const m = String(url).trim().match(regex);
    return m ? m[1] : null;
}
