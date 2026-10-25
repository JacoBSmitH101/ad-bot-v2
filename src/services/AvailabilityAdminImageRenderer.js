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
    available: { label: 'CAN PLAY', color: '#6ee7b7', fill: '#0c4937', icon: 'yes' },
    unavailable: { label: 'CAN’T PLAY', color: '#fda4af', fill: '#501f2a', icon: 'no' },
    waiting: { label: 'NO REPLY', color: '#fde68a', fill: '#4c3b12', icon: 'wait' },
    changed: { label: 'PAIRING CHANGED', color: '#fde68a', fill: '#4c3b12', icon: 'wait' },
};
export function availabilityOutcome(match) {
    const raw = Array.isArray(match?.match_results) ? match.match_results[0] : match?.match_results;
    const valid = raw && raw.legs_a != null && raw.legs_b != null &&
        [raw.legs_a, raw.legs_b].every(value => value !== '' && Number.isInteger(Number(value)) && Number(value) >= 0);
    const score = valid ? [Number(raw.legs_a), Number(raw.legs_b)] : null;
    const status = match?.status ?? 'changed';
    if (status === 'void') return { closed: true, confirmed: false, label: 'VOID · NO POINTS', detail: 'Match voided', color: '#94a3b8', fill: '#273344', score: null };
    if (status === 'confirmed') return { closed: true, confirmed: true, label: 'COMPLETE · CONFIRMED', detail: 'Result confirmed', color: '#7dd3fc', fill: '#143b53', score };
    if (status === 'reported') return { closed: true, confirmed: false, label: 'RESULT · PENDING CHECK', detail: 'Result submitted — awaiting confirmation', color: '#fde68a', fill: '#4c3b12', score };
    if (status === 'disputed') return { closed: true, confirmed: false, label: 'RESULT DISPUTED', detail: 'Disputed result — admin review needed', color: '#fda4af', fill: '#501f2a', score };
    if (score && score[0] + score[1] > 0) return { closed: true, confirmed: false, label: 'RESULT · NEEDS CHECK', detail: 'Result recorded — check match status', color: '#fde68a', fill: '#4c3b12', score };
    return { closed: false, confirmed: false, label: status === 'changed' ? 'PAIRING CHANGED' : 'TO PLAY', color: '#a5b4c7', fill: '#273344', score: null };
}
function statusIcon(x, y, theme) {
    const stroke = `stroke="${theme.color}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
    if (theme.icon === 'yes') return `<path d="M${x} ${y + 12}l8 8 17-20" ${stroke}/>`;
    if (theme.icon === 'no') return `<path d="M${x + 2} ${y + 1}l21 21m0-21-21 21" ${stroke}/>`;
    return `<circle cx="${x + 12}" cy="${y + 12}" r="12" ${stroke}/><path d="M${x + 12} ${y + 5}v8l6 3" ${stroke}/>`;
}
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
            outcome: availabilityOutcome(match), extension: changed ? 'changed' : state.extension_status, status: match?.status ?? 'changed', changed });
        groups.set(String(division.id), group);
    }
    return { season, week, groups: [...groups.values()].sort((a, b) => a.division.sort_order - b.division.sort_order || a.division.name.localeCompare(b.division.name)) };
}

/** Admin-only snapshot. Large status panels and compact completed-result cards. */
export async function renderAvailabilityAdminImages(model) {
    const images = [];
    for (const group of model.groups) for (let offset = 0; offset < group.fixtures.length; offset += 6) {
        const fixtures = group.fixtures.slice(offset, offset + 6);
        let y = 206;
        const cards = [];
        for (const fixture of fixtures) {
            const outcome = fixture.outcome;
            const dayLines = fixture.sides.map(side => wrap('Days: ' + (side.days.length ? side.days.map(adminShortDate).join(' · ') : side.status === 'available' ? 'Not chosen yet' : '—')));
            const lines = Math.max(...dayLines.map(days => days.length));
            const height = outcome.closed ? 212 : 270 + (lines - 1) * 22;
            const extension = { none: '', pending: 'EXTRA WEEK REQUESTED', review: 'EXTRA WEEK: ADMIN REVIEW', approved: 'EXTRA WEEK APPROVED', declined: 'Original date kept', changed: 'Re-release this week to update the pairing' }[fixture.extension] ?? fixture.extension;
            cards.push(`<rect x="40" y="${y}" width="1200" height="${height}" rx="16" fill="${outcome.closed ? '#101e2c' : '#101b2a'}" stroke="${outcome.closed ? outcome.color : '#26384b'}" stroke-opacity=".65"/>
                <rect x="52" y="${y + 10}" width="1176" height="50" rx="10" fill="#0b1421"/>
                ${text(66, y + 40, 'MATCH ' + (offset + fixtures.indexOf(fixture) + 1), 14, '#67e8f9', 700)}
                ${text(640, y + 48, outcome.score ? outcome.score.join(' — ') : outcome.closed ? '—' : 'VS', outcome.score ? 43 : 24, outcome.closed ? outcome.color : '#64748b', 750, 'text-anchor="middle"')}
                <rect x="884" y="${y + 16}" width="332" height="38" rx="9" fill="${outcome.fill}"/>
                ${text(1050, y + 42, outcome.label, 18, outcome.color, 750, 'text-anchor="middle"')}`);
            fixture.sides.forEach((side, index) => {
                const x = index ? 666 : 62;
                const theme = themes[side.status] ?? themes.waiting;
                let panel = theme;
                if (outcome.closed) {
                    const legs = outcome.score?.[index];
                    const opponentLegs = outcome.score?.[index ? 0 : 1];
                    const winner = outcome.confirmed && legs != null && legs > opponentLegs;
                    panel = { label: legs != null ? (winner ? 'WINNER · ' : '') + legs + (legs === 1 ? ' LEG' : ' LEGS') : fixture.status === 'void' ? 'VOID' : 'RESULT RECORDED',
                        color: winner ? '#6ee7b7' : outcome.color, fill: winner ? '#0c4937' : outcome.fill, icon: winner ? 'yes' : null };
                }
                cards.push(`${text(x, y + 97, short(side.name, 36), 25, '#f8fafc', 650)}
                    <rect x="${x}" y="${y + 112}" width="552" height="48" rx="10" fill="${panel.fill}"/>
                    ${panel.icon ? statusIcon(x + 18, y + 124, panel) : ''}
                    ${text(x + (panel.icon ? 62 : 20), y + 145, panel.label, 25, panel.color, 750)}`);
                if (!outcome.closed) {
                    const failed = side.delivery?.status === 'failed';
                    cards.push(`${dayLines[index].map((line, n) => text(x, y + 187 + n * 22, line, 17, '#b8c7d8')).join('')}
                        ${failed ? text(x, y + 194 + lines * 22, 'DM FAILED · ' + deliveryReason(side.delivery.last_error), 15, '#fda4af', 650) : ''}`);
                }
            });
            cards.push(`<path d="M62 ${y + height - 38}h1156" stroke="#26384b"/>
                ${text(62, y + height - 15, outcome.closed ? outcome.detail : 'Play by ' + adminShortDate(fixture.due), 17, outcome.closed ? outcome.color : '#e2e8f0', 600)}
                ${!outcome.closed && extension ? text(1218, y + height - 15, extension, 15, fixture.extension === 'approved' ? '#6ee7b7' : ['review', 'pending', 'changed'].includes(fixture.extension) ? '#fbbf24' : '#8493a7', 650, 'text-anchor="end"') : ''}`);
            y += height + 18;
        }
        const open = group.fixtures.filter(fixture => !fixture.outcome.closed);
        const responses = open.flatMap(fixture => fixture.sides);
        const answered = responses.filter(side => ['available', 'unavailable'].includes(side.status)).length;
        const complete = group.fixtures.filter(fixture => fixture.outcome.confirmed).length;
        const pending = group.fixtures.filter(fixture => fixture.outcome.closed && !fixture.outcome.confirmed && fixture.status !== 'void').length;
        const failed = responses.filter(side => side.delivery?.status === 'failed').length;
        const page = Math.floor(offset / 6) + 1, totalPages = Math.ceil(group.fixtures.length / 6);
        const summary = [group.division.name, complete + ' complete', ...(pending ? [pending + ' result' + (pending === 1 ? '' : 's') + ' to check'] : []), ...(open.length ? [answered + '/' + responses.length + ' replies'] : []), ...(failed ? [failed + ' failed DM' + (failed === 1 ? '' : 's')] : [])].join(' · ');
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="${y + 6}">
            <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#070c15"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs>
            <rect width="1280" height="${y + 6}" fill="url(#bg)"/><rect width="1280" height="5" fill="#22d3ee"/>
            <circle cx="1160" cy="0" r="230" fill="#22d3ee" opacity=".035"/>
            ${text(40, 47, short(model.season.name, 65).toUpperCase() + ' · ADMIN VIEW', 16, '#67e8f9', 700)}
            ${text(40, 106, 'Week ' + model.week + ' availability', 46, '#ffffff', 700)}
            ${text(40, 147, summary, 20, '#a5b4c7')}
            ${totalPages > 1 ? text(1240, 181, 'Page ' + page + '/' + totalPages, 14, '#8493a7', 500, 'text-anchor="end"') : ''}
            ${cards.join('')}
        </svg>`;
        images.push({ division: group.division, page, png: await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer() });
    }
    return images;
}
