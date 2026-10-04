import sharp from 'sharp';

const WIDTH = 1280;
const xml = (value) => String(value ?? '').replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const shorten = (value, max) => {
    const chars = Array.from(String(value ?? ''));
    return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join('');
};
const label = (x, y, value, size = 22, fill = '#e2e8f0', weight = 500, extra = '') =>
    `<text x="${x}" y="${y}" font-family="'Segoe UI','DejaVu Sans',Arial,sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" ${extra}>${xml(value)}</text>`;
const name = (player, max = 27) => shorten(player?.name || player?.discordUserId, max);
const trophy = (x, y) => `<g transform="translate(${x} ${y})" fill="none" stroke="#fbbf24" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4h28v14c0 12-28 12-28 0z M12 8H4v8c0 8 8 10 12 10 M40 8h8v8c0 8-8 10-12 10 M26 28v12 M16 44h20 M20 40h12"/></g>`;

/** Pure renderer; all rankings and movement rules are supplied by the model. */
export async function renderSeasonSummaryImage(summary) {
    const cardRows = Math.max(1, Math.ceil(summary.champions.length / 3));
    const promotionY = 212 + cardRows * 222 + 42;
    const promotionRows = Math.max(1, Math.ceil(summary.promotions.length / 2));
    const moveY = promotionY + 44 + promotionRows * 170 + 30;
    const moveRows = Math.max(1, Math.ceil(summary.moves.length / 2));
    const height = moveY + 58 + moveRows * 94 + 108;
    const cards = summary.champions.map((entry, index) => {
        const x = 40 + index % 3 * 406;
        const y = 212 + Math.floor(index / 3) * 222;
        return `<rect x="${x}" y="${y}" width="388" height="202" rx="20" fill="url(#gold)" stroke="#fbbf24" stroke-opacity=".3"/>
            ${trophy(x + 24, y + 22)}
            ${label(x + 90, y + 41, shorten(entry.division, 24), 17, '#fde68a', 700)}
            ${label(x + 90, y + 67, summary.provisional ? 'DIVISION LEADER' : 'DIVISION CHAMPION', 11, '#bda66e', 700, 'letter-spacing="1.5"')}
            ${label(x + 24, y + 123, entry.player ? name(entry.player, 23) : 'Awaiting results', 27, '#fff7dc', 700)}
            ${label(x + 24, y + 165, entry.player ? `${entry.player.points ?? 0} points   ·   ${entry.player.wins ?? 0} wins` : 'No confirmed matches yet', 17, '#b9b5a7')}`;
    }).join('');
    const promotions = summary.promotions.map((group, index) => {
        const x = 40 + index % 2 * 610;
        const y = promotionY + 44 + Math.floor(index / 2) * 170;
        return `<rect x="${x}" y="${y}" width="592" height="150" rx="18" fill="#102622" stroke="#34d399" stroke-opacity=".18"/>
            <rect x="${x}" y="${y + 22}" width="4" height="106" rx="2" fill="#34d399"/>
            ${label(x + 24, y + 34, shorten(`${group.from} → ${group.to}`, 45), 15, '#6ee7b7', 700)}
            ${group.players.map((player, i) => label(x + 24, y + 77 + i * 39, name(player, 37), 25, '#ecfdf5', 650)).join('')}`;
    }).join('') || label(40, promotionY + 98, 'No promotion places to show.', 20, '#94a3b8');
    const moves = summary.moves.map((group, index) => {
        const x = 40 + index % 2 * 610;
        const y = moveY + 58 + Math.floor(index / 2) * 94;
        return `${label(x, y, shorten(`${group.from} → ${group.to}`, 48), 14, '#d49a9f', 600)}
            ${group.players.map((player, i) => label(x, y + 27 + i * 26, name(player, 49), 18, '#aebbc9')).join('')}`;
    }).join('') || label(40, moveY + 65, 'No relegations to show.', 18, '#94a3b8');
    const footer = summary.provisional
        ? `Provisional · Based on confirmed results${summary.outstanding ? ` · ${summary.outstanding} fixtures outstanding` : ''}`
        : 'Based on final standings · Next-season divisions remain subject to signups';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">
        <defs><linearGradient id="page" x2="1" y2="1"><stop stop-color="#070c15"/><stop offset="1" stop-color="#0b1220"/></linearGradient>
        <linearGradient id="gold" x2="1" y2="1"><stop stop-color="#292619"/><stop offset="1" stop-color="#141b25"/></linearGradient></defs>
        <rect width="${WIDTH}" height="${height}" fill="url(#page)"/>
        <rect width="${WIDTH}" height="5" fill="#22d3ee"/>
        <circle cx="1180" cy="30" r="230" fill="#22d3ee" opacity=".035"/>
        <circle cx="1030" cy="20" r="170" fill="#8b5cf6" opacity=".045"/>
        ${label(40, 53, shorten(summary.seasonName, 65).toUpperCase(), 16, '#67e8f9', 700, 'letter-spacing="2.5"')}
        ${label(40, 114, summary.provisional ? 'Season honours · Preview' : 'What a season.', 48, '#ffffff', 700)}
        ${label(40, 155, summary.provisional ? 'Current leaders and division places, based on confirmed results.' : 'Celebrating our champions and everyone taking the next step.', 21, '#a5b4c7')}
        ${cards}
        ${label(40, promotionY + 12, summary.provisional ? 'IN THE PROMOTION PLACES' : 'MOVING UP', 19, '#6ee7b7', 700, 'letter-spacing="2"')}
        ${promotions}
        <path d="M40 ${moveY - 16}h1200" stroke="#263445"/><rect x="40" y="${moveY - 17}" width="110" height="3" rx="1.5" fill="#fb7185" opacity=".8"/>
        ${label(40, moveY + 12, summary.provisional ? 'Relegation places · Provisional' : 'Relegation', 19, '#fda4af', 600)}
        ${moves}
        ${label(40, height - 61, 'Thank you to every player. See you at the oche.', 20, '#cbd5e1', 600)}
        ${label(40, height - 26, footer, 14, '#8493a7')}
    </svg>`;
    return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
