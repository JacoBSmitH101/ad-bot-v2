import sharp from 'sharp';
import { cleanGraphicName } from '../utils/cleanGraphicName.js';

const xml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const short = (value, max) => Array.from(String(value)).length > max ? Array.from(String(value)).slice(0, max - 1).join('') + '…' : String(value);
const text = (x, y, value, size = 20, color = '#e2e8f0', weight = 500, extra = '') => `<text x="${x}" y="${y}" font-family="'Segoe UI','DejaVu Sans',Arial,sans-serif" font-size="${size}" fill="${color}" font-weight="${weight}" ${extra}>${xml(value)}</text>`;
export function deliveryReason(code) {
    const reasons = { '50278': 'No shared server', '50007': 'DM could not be sent', '50001': 'Missing access', '10008': 'Message deleted' };
    return reasons[String(code)] ?? 'Delivery error';
}
export function adminShortDate(day) {
    return /^\d{4}-\d{2}-\d{2}$/.test(day ?? '')
        ? new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(day + 'T00:00:00Z')) : '—';
}
function wrap(value, max = 60) {
    const lines = [''];
    for (const word of value.split(' ')) {
        if ((lines.at(-1) + word).length > max) lines.push('');
        lines[lines.length - 1] += (lines.at(-1) ? ' ' : '') + word;
    }
    return lines;
}
const themes = {
    available: { label: 'CAN PLAY', color: '#6ee7b7' }, unavailable: { label: 'CAN’T PLAY', color: '#fda4af' },
    waiting: { label: 'NOT ANSWERED', color: '#a5b4c7' }, changed: { label: 'PAIRING CHANGED', color: '#fbbf24' },
};
export function buildAvailabilityAdminModel({ season, week, states, messages, matches, divisions, players }) {
    const names = new Map(players.map(p => [p.discord_user_id, p.display_name]));
    const fixtures = new Map(matches.map(match => [String(match.id), match]));
    const divisionMap = new Map(divisions.map(division => [String(division.id), division]));
    const deliveryMap = new Map(messages.map(message => [`${message.match_id}:${message.user_id}`, message]));
    const groups = new Map();
    for (const state of states) {
        const match = fixtures.get(String(state.match_id));
        const division = divisionMap.get(String(match?.division_id)) ?? { id: 'unknown', name: 'League fixtures', sort_order: 999 };
        const changed = !match || match.player_a_id !== state.player_a_id || match.player_b_id !== state.player_b_id;
        const group = groups.get(String(division.id)) ?? { division, fixtures: [] };
        const sides = ['a', 'b'].map(side => {
            const id = side === 'a' ? match?.player_a_id ?? state.player_a_id : match?.player_b_id ?? state.player_b_id;
            const delivery = deliveryMap.get(`${state.match_id}:${id}`);
            const status = changed ? 'changed' : state[side + '_response'] ?? 'waiting';
            return { id, name: cleanGraphicName(names.get(id)) || id, status,
                days: !changed && status === 'available' ? state[side + '_days'] ?? [] : [], delivery };
        });
        group.fixtures.push({ id: state.match_id, sides, due: state.effective_due_on,
            extension: changed ? 'changed' : state.extension_status, status: match?.status ?? 'changed', changed });
        groups.set(String(division.id), group);
    }
    return { season, week, groups: [...groups.values()].sort((a, b) => a.division.sort_order - b.division.sort_order || a.division.name.localeCompare(b.division.name)) };
}

/** Admin-only snapshot. Six fixtures per page, with complete selected-day lists. */
export async function renderAvailabilityAdminImages(model) {
    const images = [];
    for (const group of model.groups) for (let offset = 0; offset < group.fixtures.length; offset += 6) {
        const fixtures = group.fixtures.slice(offset, offset + 6);
        let y = 206;
        const cards = [];
        for (const fixture of fixtures) {
            const dayLines = fixture.sides.map(side => wrap('Days: ' + (side.days.length ? side.days.map(adminShortDate).join(' · ') : side.status === 'available' ? 'Not chosen yet' : '—')));
            const lines = Math.max(...dayLines.map(days => days.length));
            const height = 182 + lines * 22;
            const extension = { none: 'No extra time requested', pending: 'Extra week: waiting for agreement', review: 'Extra week: admin review needed', approved: 'Extra week approved', declined: 'Original date kept', changed: 'Re-release this week to update the pairing' }[fixture.extension] ?? fixture.extension;
            cards.push(`<rect x="40" y="${y}" width="1200" height="${height}" rx="16" fill="#101b2a" stroke="#26384b"/>
                ${text(62, y + 29, `MATCH ${offset + fixtures.indexOf(fixture) + 1}`, 13, '#67e8f9', 700)}
                ${text(1218, y + 29, fixture.status.toUpperCase(), 12, '#a5b4c7', 600, 'text-anchor="end"')}
                <path d="M640 ${y + 47}v${height - 103}" stroke="#26384b"/>`);
            fixture.sides.forEach((side, index) => {
                const x = index ? 666 : 62;
                const theme = themes[side.status] ?? themes.waiting;
                const delivery = side.delivery;
                const failed = delivery?.status === 'failed';
                cards.push(`${text(x, y + 66, short(side.name, 36), 24, '#f8fafc', 650)}
                    <circle cx="${x + 5}" cy="${y + 88}" r="4" fill="${theme.color}"/>
                    ${text(x + 18, y + 94, theme.label, 15, theme.color, 650)}
                    ${dayLines[index].map((line, n) => text(x, y + 121 + n * 22, line, 16, '#b8c7d8')).join('')}
                    ${text(x, y + 125 + lines * 22, failed ? `DM failed: ${deliveryReason(delivery.last_error)} (${delivery.last_error})` : delivery?.status === 'sent' ? 'DM delivered' : 'DM pending', 14, failed ? '#fda4af' : '#8493a7')}`);
            });
            cards.push(`<path d="M62 ${y + height - 38}h1156" stroke="#26384b"/>
                ${text(62, y + height - 15, 'Play by ' + adminShortDate(fixture.due), 16, '#e2e8f0', 600)}
                ${text(1218, y + height - 15, extension, 15, fixture.extension === 'approved' ? '#6ee7b7' : ['review', 'pending', 'changed'].includes(fixture.extension) ? '#fbbf24' : '#8493a7', 500, 'text-anchor="end"')}`);
            y += height + 18;
        }
        const responses = group.fixtures.flatMap(fixture => fixture.sides);
        const answered = responses.filter(side => ['available', 'unavailable'].includes(side.status)).length;
        const failed = responses.filter(side => side.delivery?.status === 'failed').length;
        const page = Math.floor(offset / 6) + 1, totalPages = Math.ceil(group.fixtures.length / 6);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="${y + 6}">
            <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#070c15"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs>
            <rect width="1280" height="${y + 6}" fill="url(#bg)"/><rect width="1280" height="5" fill="#22d3ee"/>
            <circle cx="1160" cy="0" r="230" fill="#22d3ee" opacity=".035"/>
            ${text(40, 47, short(model.season.name, 65).toUpperCase() + ' · ADMIN VIEW', 16, '#67e8f9', 700)}
            ${text(40, 106, `Week ${model.week} availability`, 46, '#ffffff', 700)}
            ${text(40, 147, `${group.division.name} · ${group.fixtures.length} fixtures · ${answered}/${responses.length} answered${failed ? ` · ${failed} failed DM${failed === 1 ? '' : 's'}` : ''}`, 20, failed ? '#fda4af' : '#a5b4c7')}
            ${totalPages > 1 ? text(1240, 181, `Page ${page}/${totalPages}`, 14, '#8493a7', 500, 'text-anchor="end"') : ''}
            ${cards.join('')}
        </svg>`;
        images.push({ division: group.division, page, png: await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer() });
    }
    return images;
}
