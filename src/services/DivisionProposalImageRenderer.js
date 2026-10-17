import sharp from 'sharp';
import { cleanGraphicName } from '../utils/cleanGraphicName.js';

const xml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const short = (value, length) => Array.from(String(value)).length > length ? Array.from(String(value)).slice(0, length - 1).join('') + '…' : String(value);
const label = (x, y, value, size = 20, color = '#e2e8f0', weight = 500, extra = '') => `<text x="${x}" y="${y}" font-family="'Segoe UI','DejaVu Sans',Arial,sans-serif" font-size="${size}" fill="${color}" font-weight="${weight}" ${extra}>${xml(value)}</text>`;

export function proposalMarker(player) {
    const p = player.proposal;
    if (p.moved) return { text: `PROPOSED MOVE · Div ${p.expectedIndex + 1} → Div ${p.divisionIndex + 1}`, color: '#fbbf24' };
    if (p.reason === 'promoted') return { text: `PROMOTED · ${p.previousDivision} → Div ${p.divisionIndex + 1}`, color: '#6ee7b7' };
    if (p.reason === 'relegated') return { text: `RELEGATED · ${p.previousDivision} → Div ${p.divisionIndex + 1}`, color: '#d49a9f' };
    if (p.reason === 'returning') return { text: 'STAYING IN DIVISION', color: '#8493a7' };
    return { text: p.reason === 'new' ? 'NEW PLAYER' : 'RETURNING · PLACED BY AVERAGE', color: '#67e8f9' };
}

/** Cards paginate at 20 players and four cards per image; no roster is clipped. */
export async function renderDivisionProposalImages(proposal) {
    const cards = proposal.groups.flatMap((players, index) => {
        const parts = Math.max(1, Math.ceil(players.length / 20));
        return Array.from({ length: parts }, (_, part) => ({
            index, players: players.slice(part * 20, (part + 1) * 20),
            title: `${proposal.divisions[index].name}${parts > 1 ? ` · ${part + 1}/${parts}` : ''}`,
            all: players,
        }));
    });
    const pages = [];
    for (let offset = 0; offset < cards.length; offset += 4) {
        const page = cards.slice(offset, offset + 4);
        let top = 214;
        const drawn = [];
        for (let r = 0; r < page.length; r += 2) {
            const pair = page.slice(r, r + 2);
            const height = 132 + Math.max(1, ...pair.map(card => card.players.length)) * 54;
            pair.forEach((card, column) => {
                const x = 40 + column * 610, y = top;
                const averages = card.all.map(p => Number(p.avg_3dart));
                const average = averages.length ? (averages.reduce((a, b) => a + b, 0) / averages.length).toFixed(1) : '—';
                const range = averages.length ? `${Math.min(...averages).toFixed(1)}–${Math.max(...averages).toFixed(1)}` : '—';
                drawn.push(`<rect x="${x}" y="${y}" width="592" height="${height}" rx="18" fill="#101b2a" stroke="#26384b"/>
                    <rect x="${x}" y="${y + 22}" width="4" height="48" rx="2" fill="#22d3ee"/>
                    ${label(x + 22, y + 38, short(card.title, 30), 26, '#f8fafc', 700)}
                    ${label(x + 22, y + 65, `${card.all.length} players · Target ${proposal.targetSizes[card.index]} · Group avg ${average}`, 16, '#a5b4c7')}
                    ${label(x + 22, y + 89, `Signup average range ${range}`, 15, '#8493a7')}
                    ${label(x + 568, y + 89, 'AVG', 12, '#8493a7', 600, 'text-anchor="end"')}
                    <path d="M${x + 22} ${y + 102}h548" stroke="#26384b"/>`);
                card.players.forEach((player, i) => {
                    const rowY = y + 131 + i * 54;
                    const marker = proposalMarker(player);
                    const name = cleanGraphicName(player.name ?? player.display_name) || player.discord_user_id;
                    drawn.push(`${i % 2 === 0 ? `<rect x="${x + 10}" y="${rowY - 24}" width="572" height="52" rx="7" fill="#152234"/>` : ''}
                        ${label(x + 22, rowY, short(name, 33), 21, '#edf3fa', 600)}
                        ${label(x + 568, rowY, Number(player.avg_3dart).toFixed(1), 21, '#e2e8f0', 650, 'text-anchor="end"')}
                        ${label(x + 22, rowY + 20, short(marker.text, 46), 11, marker.color, 600)}
                        ${player.proposal.review ? label(x + 568, rowY + 20, 'REVIEW FIT', 10, '#fbbf24', 650, 'text-anchor="end"') : ''}`);
                });
                if (!card.players.length) drawn.push(label(x + 22, y + 139, 'No players assigned', 18, '#8493a7'));
            });
            top += height + 24;
        }
        const height = top + 108;
        const summary = `${proposal.stats.promotions} promotions honoured · ${proposal.stats.kept} returning players staying · ${proposal.stats.moved} proposed moves`;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="${height}">
            <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#070c15"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs>
            <rect width="1280" height="${height}" fill="url(#bg)"/><rect width="1280" height="5" fill="#22d3ee"/>
            <circle cx="1160" cy="0" r="230" fill="#22d3ee" opacity=".035"/>
            <circle cx="1030" cy="20" r="170" fill="#8b5cf6" opacity=".045"/>
            ${label(40, 49, short(proposal.season.name, 65).toUpperCase(), 16, '#67e8f9', 700, 'letter-spacing="2"')}
            ${label(40, 108, 'Proposed divisions', 46, '#ffffff', 700)}
            ${label(40, 147, `${proposal.playerCount} signups · ${proposal.groups.length} divisions · Based on signup averages and previous standings`, 19, '#a5b4c7')}
            ${label(40, 179, summary, 17, '#6ee7b7')}
            ${drawn.join('')}
            ${label(40, top + 20, proposal.conflicts.length ? 'Needs admin review · Protected places conflict with the requested split' : 'Proposal only · Review before assigning players', 19, proposal.conflicts.length ? '#fbbf24' : '#cbd5e1', 600)}
            ${label(40, top + 49, 'Extra places go to lower divisions · Player notes explain proposed moves', 15, '#8493a7')}
            ${label(1240, top + 79, `Page ${pages.length + 1} / ${Math.ceil(cards.length / 4)}`, 14, '#8493a7', 500, 'text-anchor="end"')}
        </svg>`;
        pages.push(await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer());
    }
    return pages;
}
