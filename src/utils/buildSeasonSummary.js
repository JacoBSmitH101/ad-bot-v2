/** Uses the existing standings order, including the league's tiebreakers. */
export function buildSeasonSummary({ season, divisions }) {
    const ordered = [...divisions].sort(
        (a, b) => Number(a.division.sort_order) - Number(b.division.sort_order)
    );
    let outstanding = 0;
    const champions = [];
    const promotions = [];
    const moves = [];

    for (const [index, entry] of ordered.entries()) {
        const rows = entry.standings;
        outstanding += rows.reduce((sum, row) => sum + Math.max(
            0, Number(row.totalMatches || 0) - Number(row.played || 0)
        ), 0);
        const hasResults = rows.some((row) => Number(row.played) > 0);
        champions.push({ division: entry.division.name, player: hasResults ? rows[0] : null });
        if (!hasResults) continue;

        const promoted = index > 0 ? rows.slice(0, 2) : [];
        if (promoted.length) promotions.push({
            from: entry.division.name,
            to: ordered[index - 1].division.name,
            players: promoted,
        });
        // Never list a champion or promoted player twice with opposing outcomes
        // in unusually small divisions.
        const relegated = index < ordered.length - 1
            ? rows.slice(-2).filter((row) => row !== rows[0] && !promoted.includes(row))
            : [];
        if (relegated.length) moves.push({
            from: entry.division.name,
            to: ordered[index + 1].division.name,
            players: relegated,
        });
    }
    outstanding = Math.ceil(outstanding / 2);
    return {
        seasonName: season.name,
        provisional: season.status !== 'closed' || outstanding > 0 || champions.some(entry => !entry.player),
        outstanding,
        champions,
        promotions,
        moves,
    };
}
