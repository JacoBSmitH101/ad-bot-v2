import sharp from "sharp";

const WIDTH = 1280;
const TABLE_X = 32;
const TABLE_WIDTH = WIDTH - TABLE_X * 2;
const TABLE_Y = 216;
const HEADER_HEIGHT = 48;
const ROW_HEIGHT = 64;
const FOOTER_HEIGHT = 66;

function escapeXml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

function truncate(value, max = 34) {
    const chars = Array.from(String(value ?? ""));
    return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : chars.join("");
}

function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function signed(value) {
    const parsed = number(value);
    return parsed > 0 ? `+${parsed}` : String(parsed);
}

function rowPalette(index, rowCount, { isTopDivision, isBottomDivision }) {
    if (index === 0) {
        return {
            stripe: "#fbbf24",
            rank: "#fde68a",
            fill: "rgba(251,191,36,0.075)",
            stroke: "rgba(251,191,36,0.22)",
        };
    }
    if (index === 1 && !isTopDivision) {
        return {
            stripe: "#34d399",
            rank: "#a7f3d0",
            fill: "rgba(52,211,153,0.055)",
            stroke: "rgba(52,211,153,0.16)",
        };
    }
    if (index >= rowCount - 2 && !isBottomDivision) {
        return {
            stripe: "#fb7185",
            rank: "#fecdd3",
            fill: "rgba(251,113,133,0.05)",
            stroke: "rgba(251,113,133,0.15)",
        };
    }
    return {
        stripe: "#334155",
        rank: "#94a3b8",
        fill: index % 2 === 0 ? "rgba(255,255,255,0.028)" : "rgba(255,255,255,0.015)",
        stroke: "rgba(255,255,255,0.055)",
    };
}

function movementBadge(delta, baseline) {
    const movement = Number(delta);
    if (!Number.isFinite(movement) || movement === 0) return "";

    const movedUp = movement < 0;
    const colour = movedUp ? "#34d399" : "#fb7185";
    const textColour = movedUp ? "#a7f3d0" : "#fecdd3";
    const label = `${movedUp ? "▲" : "▼"} ${Math.abs(movement)}`;

    return `
        <rect x="596" y="${baseline - 25}" width="72" height="34" rx="17" fill="${colour}" fill-opacity="0.10" stroke="${colour}" stroke-opacity="0.28" />
        ${text({
            x: 632,
            y: baseline - 2,
            value: label,
            size: 15,
            weight: 750,
            fill: textColour,
            anchor: "middle",
            family: "display",
        })}
    `;
}

function text({
    x,
    y,
    value,
    size = 22,
    weight = 500,
    fill = "#e2e8f0",
    anchor = "start",
    family = "body",
    letterSpacing = 0,
}) {
    const fontFamily =
        family === "display"
            ? "'Segoe UI Semibold','DejaVu Sans',Arial,sans-serif"
            : "'Segoe UI','DejaVu Sans',Arial,sans-serif";
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${fontFamily}" font-size="${size}" font-weight="${weight}" letter-spacing="${letterSpacing}" fill="${fill}">${escapeXml(value)}</text>`;
}

/**
 * Render a website-style standings table as a Discord-ready PNG.
 * This is a pure presentation helper: callers provide already-computed rows.
 *
 * @param {{
 *   seasonName: string,
 *   divisionName: string,
 *   standings: Array<object>,
 *   playerAverages?: Map<string, number>,
 *   rankMovements?: Map<string, number>,
 *   isTopDivision?: boolean,
 *   isBottomDivision?: boolean
 * }} params
 * @returns {Promise<Buffer>}
 */
export async function renderStandingsImage({
    seasonName,
    divisionName,
    standings,
    playerAverages = new Map(),
    rankMovements = new Map(),
    isTopDivision = false,
    isBottomDivision = false,
}) {
    const rows = Array.isArray(standings) ? standings : [];
    const height = TABLE_Y + HEADER_HEIGHT + rows.length * ROW_HEIGHT + FOOTER_HEIGHT;
    const scheduledMatches = Math.round(
        rows.reduce((sum, row) => sum + number(row.totalMatches), 0) / 2
    );
    const playedMatches = Math.round(
        rows.reduce((sum, row) => sum + number(row.played), 0) / 2
    );

    const headings = [
        ["#", 78, "middle"],
        ["PLAYER", 126, "start"],
        ["P", 700, "end"],
        ["W", 770, "end"],
        ["L", 840, "end"],
        ["LF", 915, "end"],
        ["LA", 990, "end"],
        ["LD", 1065, "end"],
        ["AVG", 1160, "end"],
        ["PTS", 1230, "end"],
    ];

    const rowSvg = rows
        .map((row, index) => {
            const y = TABLE_Y + HEADER_HEIGHT + index * ROW_HEIGHT;
            const baseline = y + 40;
            const palette = rowPalette(index, rows.length, {
                isTopDivision,
                isBottomDivision,
            });
            const average = playerAverages.get(row.discordUserId);
            const averageText = Number.isFinite(average) ? Number(average).toFixed(1) : "—";
            const playerName = truncate(row.name || row.discordUserId);
            const rankMovement =
                rankMovements.get(String(row.discordUserId)) ??
                rankMovements.get(row.discordUserId);

            return `
                <rect x="${TABLE_X}" y="${y + 3}" width="${TABLE_WIDTH}" height="${
                    ROW_HEIGHT - 6
                }" rx="12" fill="${palette.fill}" stroke="${palette.stroke}" />
                <rect x="${TABLE_X}" y="${y + 11}" width="4" height="${
                    ROW_HEIGHT - 22
                }" rx="2" fill="${palette.stripe}" />
                ${text({
                    x: 78,
                    y: baseline,
                    value: index + 1,
                    size: 21,
                    weight: 700,
                    fill: palette.rank,
                    anchor: "middle",
                    family: "display",
                })}
                ${text({
                    x: 126,
                    y: baseline,
                    value: playerName,
                    size: 22,
                    weight: 650,
                    fill: "#f1f5f9",
                })}
                ${movementBadge(rankMovement, baseline)}
                ${text({ x: 700, y: baseline, value: number(row.played), anchor: "end" })}
                ${text({ x: 770, y: baseline, value: number(row.wins), anchor: "end" })}
                ${text({ x: 840, y: baseline, value: number(row.losses), anchor: "end" })}
                ${text({ x: 915, y: baseline, value: number(row.legsFor), anchor: "end" })}
                ${text({ x: 990, y: baseline, value: number(row.legsAgainst), anchor: "end" })}
                ${text({
                    x: 1065,
                    y: baseline,
                    value: signed(row.legDiff),
                    anchor: "end",
                    fill: number(row.legDiff) > 0 ? "#67e8f9" : "#cbd5e1",
                })}
                ${text({
                    x: 1160,
                    y: baseline,
                    value: averageText,
                    anchor: "end",
                    fill: "#c4b5fd",
                })}
                ${text({
                    x: 1230,
                    y: baseline,
                    value: number(row.points),
                    size: 24,
                    weight: 750,
                    anchor: "end",
                    fill: "#a5f3fc",
                    family: "display",
                })}
            `;
        })
        .join("");

    const headingSvg = headings
        .map(([label, x, anchor]) =>
            text({
                x,
                y: TABLE_Y + 31,
                value: label,
                size: 13,
                weight: 700,
                fill: "#64748b",
                anchor,
                letterSpacing: 1.6,
            })
        )
        .join("");

    const updatedAt = new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/London",
    }).format(new Date());

    const svg = `
        <svg width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="page" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stop-color="#070c15" />
                    <stop offset="0.58" stop-color="#0b1220" />
                    <stop offset="1" stop-color="#0a1020" />
                </linearGradient>
                <linearGradient id="titleGlow" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stop-color="#22d3ee" stop-opacity="0.18" />
                    <stop offset="0.5" stop-color="#8b5cf6" stop-opacity="0.09" />
                    <stop offset="1" stop-color="#8b5cf6" stop-opacity="0" />
                </linearGradient>
            </defs>
            <rect width="${WIDTH}" height="${height}" fill="url(#page)" />
            <rect x="0" y="0" width="${WIDTH}" height="6" fill="#22d3ee" opacity="0.85" />
            <circle cx="1180" cy="30" r="190" fill="#22d3ee" opacity="0.035" />
            <circle cx="1030" cy="30" r="130" fill="#8b5cf6" opacity="0.04" />
            <rect x="32" y="30" width="760" height="152" rx="24" fill="url(#titleGlow)" />

            ${text({
                x: 56,
                y: 68,
                value: seasonName.toUpperCase(),
                size: 14,
                weight: 700,
                fill: "#67e8f9",
                letterSpacing: 2.8,
            })}
            ${text({
                x: 56,
                y: 122,
                value: divisionName,
                size: 42,
                weight: 700,
                fill: "#ffffff",
                family: "display",
            })}
            ${text({
                x: 56,
                y: 158,
                value: "Confirmed league standings · Points = legs won + 2 for a win",
                size: 17,
                fill: "#94a3b8",
            })}

            <rect x="936" y="72" width="126" height="64" rx="16" fill="rgba(255,255,255,0.045)" stroke="rgba(255,255,255,0.07)" />
            <rect x="1078" y="72" width="146" height="64" rx="16" fill="rgba(255,255,255,0.045)" stroke="rgba(255,255,255,0.07)" />
            ${text({ x: 999, y: 96, value: "PLAYERS", size: 11, weight: 700, fill: "#64748b", anchor: "middle", letterSpacing: 1.3 })}
            ${text({ x: 999, y: 124, value: rows.length, size: 25, weight: 700, fill: "#e2e8f0", anchor: "middle", family: "display" })}
            ${text({ x: 1151, y: 96, value: "MATCHES", size: 11, weight: 700, fill: "#64748b", anchor: "middle", letterSpacing: 1.3 })}
            ${text({ x: 1151, y: 124, value: `${playedMatches}/${scheduledMatches}`, size: 25, weight: 700, fill: "#c4b5fd", anchor: "middle", family: "display" })}

            <rect x="${TABLE_X}" y="${TABLE_Y}" width="${TABLE_WIDTH}" height="${HEADER_HEIGHT}" rx="12" fill="rgba(255,255,255,0.035)" stroke="rgba(255,255,255,0.06)" />
            ${headingSvg}
            ${rowSvg || text({ x: WIDTH / 2, y: TABLE_Y + 105, value: "No players in this division", size: 20, fill: "#64748b", anchor: "middle" })}

            ${text({
                x: 32,
                y: height - 24,
                value: "Gold: division leader · Green: promotion · Red: relegation",
                size: 14,
                fill: "#64748b",
            })}
            ${text({
                x: WIDTH - 32,
                y: height - 24,
                value: `Preview generated ${updatedAt}`,
                size: 14,
                fill: "#475569",
                anchor: "end",
            })}
        </svg>
    `;

    return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
