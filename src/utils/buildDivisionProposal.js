import { DomainError } from './DomainError.js';

export function divisionTargetSizes(total, count) {
    const base = Math.floor(total / count);
    const extra = total % count;
    return Array.from({ length: count }, (_, i) => base + (i >= count - extra ? 1 : 0));
}

// Minimum-cost assignment to individual places (Hungarian algorithm).
// Solves all boundaries together, so a strong newcomer can displace a borderline
// returner without scattering the rest of the returning players.
function allocate(costs) {
    const n = costs.length;
    const u = Array(n + 1).fill(0), v = Array(n + 1).fill(0);
    const p = Array(n + 1).fill(0), way = Array(n + 1).fill(0);
    for (let i = 1; i <= n; i++) {
        p[0] = i;
        let j0 = 0;
        const min = Array(n + 1).fill(Infinity), used = Array(n + 1).fill(false);
        do {
            used[j0] = true;
            const i0 = p[j0];
            let delta = Infinity, j1 = 0;
            for (let j = 1; j <= n; j++) if (!used[j]) {
                const current = costs[i0 - 1][j - 1] - u[i0] - v[j];
                if (current < min[j]) { min[j] = current; way[j] = j0; }
                if (min[j] < delta) { delta = min[j]; j1 = j; }
            }
            for (let j = 0; j <= n; j++) {
                if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
                else min[j] -= delta;
            }
            j0 = j1;
        } while (p[j0] !== 0);
        do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0 !== 0);
    }
    const result = Array(n);
    for (let j = 1; j <= n; j++) result[p[j] - 1] = j - 1;
    return result;
}

/** Read-only plan. Protected movement is based on the OLD division structure. */
export function buildDivisionProposal({ signups, count, previousDivisions = [], placementsByUser = new Map(), previousSignupIds = new Set(), strategy = 'balanced' }) {
    if (!Number.isInteger(count) || count < 1 || count > 10) throw new DomainError('INVALID_COUNT', 'Choose 1–10 divisions.');
    if (!['balanced', 'history'].includes(strategy)) throw new DomainError('INVALID_STRATEGY', 'Unknown division proposal strategy.');
    const seen = new Set();
    for (const player of signups) {
        if (seen.has(player.discord_user_id)) throw new DomainError('DUPLICATE_PLAYER', 'A player appears more than once in signups.');
        seen.add(player.discord_user_id);
        if (player.avg_3dart == null || !Number.isFinite(Number(player.avg_3dart))) throw new DomainError('INVALID_AVERAGE', 'A signup has no valid average. Update it before generating a proposal.');
    }
    const previous = [...previousDivisions].sort((a, b) => a.sort_order - b.sort_order);
    const targetSizes = divisionTargetSizes(signups.length, count);
    const sorted = [...signups].sort((a, b) => Number(b.avg_3dart) - Number(a.avg_3dart) || String(a.discord_user_id).localeCompare(String(b.discord_user_id)));
    let cursor = 0;
    const bands = targetSizes.map(size => {
        const players = sorted.slice(cursor, cursor += size);
        return { high: Number(players[0]?.avg_3dart ?? 0), low: Number(players.at(-1)?.avg_3dart ?? 0) };
    });
    const gap = (average, i) => Math.max(0, bands[i].low - average, average - bands[i].high);
    const conflicts = [], warnings = [];
    const players = sorted.map(signup => {
        const placements = [...(placementsByUser.get(signup.discord_user_id) ?? [])].sort((a, b) => a.divisionSortOrder - b.divisionSortOrder);
        const placement = placements[0];
        if (placements.length > 1) conflicts.push(`${signup.discord_user_id}: multiple previous divisions; check their history.`);
        const oldIndex = placement ? previous.findIndex(d => d.sort_order === placement.divisionSortOrder) : -1;
        let expectedIndex = oldIndex, reason = oldIndex < 0 ? (previousSignupIds.has(signup.discord_user_id) ? 'unplaced' : 'new') : 'returning';
        if (oldIndex >= 0 && placement.rank > 0) {
            if (placement.rank <= 2 && oldIndex > 0) { expectedIndex--; reason = 'promoted'; }
            else if (placement.rank > Math.max(placement.of - 2, 2) && oldIndex < previous.length - 1) { expectedIndex++; reason = 'relegated'; }
        }
        const locked = reason === 'promoted' || reason === 'relegated';
        if (locked && expectedIndex >= count) conflicts.push(`${signup.discord_user_id}: their earned place is in Div ${expectedIndex + 1}, which is not in this proposal.`);
        return { ...signup, proposal: { previousDivision: placement?.divisionName ?? null, expectedIndex, reason, locked } };
    });
    const groups = Array.from({ length: count }, () => []);
    if (strategy === 'history') {
        const oldCount = Math.min(previous.length, count);
        for (const player of players.filter(p => p.proposal.expectedIndex >= 0)) {
            const index = player.proposal.expectedIndex;
            if (index >= count && !player.proposal.locked) conflicts.push(player.discord_user_id + ': their previous division is not in this proposal.');
            groups[Math.min(count - 1, index)].push(player);
        }
        // Preserve historical sizes. Only actual vacancies are open to new players;
        // adding a lower division must not create extra spaces in existing ones.
        const allPlacements = [...placementsByUser.values()].flat();
        for (let i = 0; i < oldCount; i++) {
            const sizes = allPlacements.filter(p => p.divisionSortOrder === previous[i].sort_order).map(p => p.of || 0);
            targetSizes[i] = previous[i].playerCount ?? (Math.max(0, ...sizes) || targetSizes[i]);
            if (groups[i].length > targetSizes[i]) warnings.push('Div ' + (i + 1) + ' retains ' + groups[i].length + ' returning players despite its previous size of ' + targetSizes[i] + '.');
        }
        const newcomers = players.filter(p => p.proposal.expectedIndex < 0);
        let next = 0;
        for (let i = 0; i < oldCount; i++) while (groups[i].length < targetSizes[i] && next < newcomers.length) {
            const player = newcomers[next++];
            player.proposal.placementNote = 'Fills a vacancy in Div ' + (i + 1) + ', using signup average.';
            groups[i].push(player);
        }
        if (count > oldCount) {
            const sizes = divisionTargetSizes(newcomers.length - next, count - oldCount);
            for (let i = oldCount; i < count; i++) {
                targetSizes[i] = sizes[i - oldCount];
                for (let j = 0; j < targetSizes[i]; j++) {
                    const player = newcomers[next++];
                    player.proposal.placementNote = 'Placed in a new lower division after existing vacancies were filled.';
                    groups[i].push(player);
                }
            }
        } else if (next < newcomers.length) {
            conflicts.push((newcomers.length - next) + ' players need an additional lower division. Shown in the lowest division pending review.');
            groups[count - 1].push(...newcomers.slice(next));
        }
        for (let i = 0; i < count; i++) if (groups[i].length < 7) warnings.push('Div ' + (i + 1) + ' has only ' + groups[i].length + ' players in this history-first split.');
    } else {
    for (const player of players.filter(p => p.proposal.locked)) groups[Math.min(count - 1, player.proposal.expectedIndex)].push(player);
    const capacity = targetSizes.map((size, i) => Math.max(size, groups[i].length));
    for (let i = 0; i < count; i++) if (groups[i].length > targetSizes[i]) conflicts.push(`Div ${i + 1}: ${groups[i].length} protected places exceed its target of ${targetSizes[i]}.`);
    let excess = capacity.reduce((a, b) => a + b, 0) - signups.length;
    for (let i = count - 1; i >= 0 && excess > 0; i--) {
        const take = Math.min(excess, capacity[i] - groups[i].length);
        capacity[i] -= take; excess -= take;
    }
    const slots = capacity.flatMap((size, i) => Array(size - groups[i].length).fill(i));
    const remaining = players.filter(p => !p.proposal.locked);
    const costs = remaining.map(player => slots.map(i => {
        const expected = player.proposal.expectedIndex;
        const distance = expected < 0 ? 0 : Math.abs(expected - i);
        // A move costs the equivalent of a 10-point average mismatch squared.
        // Tiny average differences cannot outweigh keeping an established place.
        return gap(Number(player.avg_3dart), i) ** 2 + distance * 100 + (distance > 1 ? 1_000_000 : 0);
    }));
    allocate(costs).forEach((slot, index) => groups[slots[slot]].push(remaining[index]));
    }
    const stats = { promotions: 0, relegations: 0, kept: 0, moved: 0, newcomers: 0, review: 0 };
    groups.forEach((group, i) => {
        group.forEach(player => {
            const info = player.proposal;
            info.divisionIndex = i;
            info.moved = info.expectedIndex >= 0 && info.expectedIndex !== i;
            info.fitGap = gap(Number(player.avg_3dart), i);
            info.review = info.fitGap >= 10;
            if (info.locked && info.expectedIndex === i) stats[info.reason === 'promoted' ? 'promotions' : 'relegations']++;
            else if (info.moved) stats.moved++;
            else if (info.reason === 'returning') stats.kept++;
            if (info.reason === 'new' || info.reason === 'unplaced') stats.newcomers++;
            if (info.review) stats.review++;
            if (info.moved && Math.abs(info.expectedIndex - i) > 1) conflicts.push(`${player.discord_user_id}: needs a move of more than one division; review manually.`);
            info.detail = info.moved ? `Expected Div ${info.expectedIndex + 1}; proposed Div ${i + 1} to balance sizes and average fit.`
                : info.reason === 'promoted' ? `Promoted from ${info.previousDivision}; place protected.`
                : info.reason === 'relegated' ? `Relegated from ${info.previousDivision}; place protected.`
                : info.reason === 'returning' ? `Stays in ${info.previousDivision}.` : (info.placementNote ?? 'Placed using signup average.');
        });
        group.sort((a, b) => Number(b.avg_3dart) - Number(a.avg_3dart) || String(a.discord_user_id).localeCompare(String(b.discord_user_id)));
    });
    if (!previous.length) warnings.push('No previous division history available; placements use signup averages.');
    if (stats.review) warnings.push(`${stats.review} player(s) are at least 10 average points outside their average-based division band. Review the fit; protected places remain honoured.`);
    return { strategy, groups, targetSizes, counts: groups.map(g => g.length), conflicts, warnings, stats };
}
