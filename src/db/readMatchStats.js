// Keep existing consumer shapes while avoiding the large games/scores payload.
// A fresh query factory preserves each caller's filters and single/batch mode.
export async function readMatchStats(query) {
    const result = await query(
        "match_id,match_summary:stats->matchStats,nested_summary:stats->stats->matchStats"
    );
    if (result.error) return query("match_id, stats");
    if (result.data == null) return result;
    const rows = Array.isArray(result.data) ? result.data : [result.data];
    const isSummary = (row) =>
        (Array.isArray(row.match_summary) || Array.isArray(row.nested_summary)) &&
        (row.match_summary == null || Array.isArray(row.match_summary)) &&
        (row.nested_summary == null || Array.isArray(row.nested_summary));
    // Legacy string/array documents and unusual values retain the original path.
    if (!rows.every(isSummary)) return query("match_id, stats");
    const data = rows.map((row) => ({
        match_id: row.match_id,
        stats: {
            matchStats: row.match_summary,
            stats: { matchStats: row.nested_summary },
        },
    }));
    return { ...result, data: Array.isArray(result.data) ? data : data[0] };
}
