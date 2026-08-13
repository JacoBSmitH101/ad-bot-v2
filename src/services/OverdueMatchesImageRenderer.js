import sharp from "sharp";

const WIDTH = 1280;
const CONTENT_X = 32;
const CONTENT_WIDTH = WIDTH - CONTENT_X * 2;
const GROUP_HEADER_HEIGHT = 50;
const ROW_HEIGHT = 70;
const FOOTER_HEIGHT = 64;
const LIST_Y = 304;

function escapeXml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

function truncate(value, max = 25) {
    const chars = Array.from(String(value ?? ""));
    return chars.length > max
        ? `${chars.slice(0, max - 1).join("")}…`
        : chars.join("");
}

function text({
    x,
    y,
    value,
    size = 18,
    weight = 500,
    fill = "#e2e8f0",
    anchor = "start",
    family = "body",
    letterSpacing = 0,
    middle = false,
}) {
    const fontFamily =
        family === "display"
            ? "'Segoe UI Semibold','DejaVu Sans',Arial,sans-serif"
            : "'Segoe UI','DejaVu Sans',Arial,sans-serif";
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" ${
        middle ? 'dominant-baseline="middle"' : ""
    } font-family="${fontFamily}" font-size="${size}" font-weight="${weight}" letter-spacing="${letterSpacing}" fill="${fill}">${escapeXml(
        value
    )}</text>`;
}

function weekTheme(isOldest) {
    return isOldest
        ? {
              colour: "#d94f5c",
              bright: "#fda4af",
              pale: "#fecdd3",
          }
        : {
              colour: "#f59e0b",
              bright: "#fbbf24",
              pale: "#fde68a",
          };
}

function overdueLabel(cutoffWeek, week) {
    const count = Math.max(1, Number(cutoffWeek) - Number(week));
    return `${count} ${count === 1 ? "WEEK" : "WEEKS"} OVERDUE`;
}

function rowStatus(match, isOldest) {
    if (match.status === "disputed") return "REQUIRES REVIEW";
    return isOldest ? "ARRANGE NOW" : "OUTSTANDING";
}

/**
 * Render a one-off public reminder containing all overdue matches.
 *
 * @param {{
 *   seasonName: string,
 *   cutoffWeek: number,
 *   currentWeek?: number,
 *   weeks: Array<{week: number, matches: Array<object>}>,
 *   nameById?: Map<string, string>
 * }} params
 * @returns {Promise<Buffer>}
 */
export async function renderOverdueMatchesImage({
    seasonName,
    cutoffWeek,
    currentWeek = cutoffWeek,
    weeks,
    nameById = new Map(),
}) {
    const groups = Array.isArray(weeks) ? weeks : [];
    const matchCount = groups.reduce(
        (sum, group) => sum + (group.matches?.length ?? 0),
        0
    );
    const oldestWeek =
        groups.length > 0
            ? Math.min(...groups.map((group) => Number(group.week)))
            : null;
    const listHeight = groups.reduce(
        (sum, group) =>
            sum +
            GROUP_HEADER_HEIGHT +
            (group.matches?.length ?? 0) * ROW_HEIGHT,
        0
    );
    const height = LIST_Y + listHeight + FOOTER_HEIGHT;

    let y = LIST_Y;
    const groupSvg = groups
        .map((group) => {
            const isOldest = Number(group.week) === oldestWeek;
            const theme = weekTheme(isOldest);
            const matches = group.matches ?? [];
            const headerY = y;
            const headerBaseline = headerY + 31;
            const rowsY = headerY + GROUP_HEADER_HEIGHT;

            const rowsSvg = matches
                .map((match, index) => {
                    const rowY = rowsY + index * ROW_HEIGHT;
                    const baseline = rowY + 34;
                    const playerA = truncate(
                        nameById.get(match.playerAId) ?? match.playerAId
                    );
                    const playerB = truncate(
                        nameById.get(match.playerBId) ?? match.playerBId
                    );
                    const status = rowStatus(match, isOldest);
                    const divisionName = truncate(
                        String(match.divisionName ?? "Division"),
                        16
                    ).toUpperCase();

                    return `
                        <rect x="${CONTENT_X}" y="${rowY + 3}" width="${CONTENT_WIDTH}" height="${
                            ROW_HEIGHT - 6
                        }" rx="6" fill="${
                            isOldest ? theme.colour : "#ffffff"
                        }" fill-opacity="${
                            isOldest ? 0.04 : index % 2 === 0 ? 0.018 : 0.012
                        }" stroke="${
                            isOldest ? theme.colour : "#ffffff"
                        }" stroke-opacity="${isOldest ? 0.16 : 0.055}"/>
                        <rect x="${CONTENT_X}" y="${rowY + 15}" width="6" height="${
                            ROW_HEIGHT - 30
                        }" fill="${theme.colour}" opacity="${
                            index === 0 ? 1 : 0.72
                        }"/>
                        <rect x="58" y="${rowY + 19}" width="128" height="32" rx="4" fill="${
                            isOldest ? theme.colour : "#ffffff"
                        }" fill-opacity="${
                            isOldest ? 0.075 : 0.025
                        }" stroke="${
                            isOldest ? theme.colour : "#ffffff"
                        }" stroke-opacity="${isOldest ? 0.2 : 0.07}"/>
                        ${text({
                            x: 122,
                            y: baseline,
                            value: divisionName,
                            size: 11,
                            weight: 750,
                            fill: isOldest ? theme.pale : "#94a3b8",
                            anchor: "middle",
                            letterSpacing: 1.05,
                            middle: true,
                        })}
                        ${text({
                            x: 220,
                            y: baseline,
                            value: playerA,
                            size: 22,
                            weight: 650,
                            fill: "#f1f5f9",
                            family: "display",
                            middle: true,
                        })}
                        ${text({
                            x: 640,
                            y: baseline,
                            value: "VS",
                            size: 13,
                            weight: 750,
                            fill: "#64748b",
                            anchor: "middle",
                            letterSpacing: 1.4,
                            middle: true,
                        })}
                        ${text({
                            x: 700,
                            y: baseline,
                            value: playerB,
                            size: 22,
                            weight: 650,
                            fill: "#f1f5f9",
                            family: "display",
                            middle: true,
                        })}
                        <rect x="1058" y="${rowY + 19}" width="158" height="32" rx="4" fill="${theme.colour}" fill-opacity="${
                            isOldest ? 0.065 : 0.04
                        }"/>
                        ${text({
                            x: 1137,
                            y: baseline,
                            value: status,
                            size: 11,
                            weight: 750,
                            fill: theme.bright,
                            anchor: "middle",
                            letterSpacing: 1,
                            middle: true,
                        })}
                    `;
                })
                .join("");

            y += GROUP_HEADER_HEIGHT + matches.length * ROW_HEIGHT;
            return `
                ${text({
                    x: 42,
                    y: headerBaseline,
                    value: `WEEK ${group.week}`,
                    size: 15,
                    weight: 750,
                    fill: theme.bright,
                    letterSpacing: 1.6,
                })}
                <line x1="118" y1="${headerBaseline - 5}" x2="1002" y2="${
                    headerBaseline - 5
                }" stroke="${theme.colour}" stroke-opacity="${
                    isOldest ? 0.18 : 0.12
                }"/>
                <rect x="1034" y="${headerY + 10}" width="182" height="32" rx="4" fill="${theme.colour}" fill-opacity="${
                    isOldest ? 0.075 : 0.05
                }" stroke="${theme.colour}" stroke-opacity="${
                    isOldest ? 0.23 : 0.16
                }"/>
                ${text({
                    x: 1125,
                    y: headerY + 27,
                    value: overdueLabel(currentWeek, group.week),
                    size: 11,
                    weight: 750,
                    fill: theme.pale,
                    anchor: "middle",
                    letterSpacing: 1,
                    middle: true,
                })}
                ${rowsSvg}
            `;
        })
        .join("");

    const generatedAt = new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/London",
    }).format(new Date());

    const svg = `
        <svg width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="page" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stop-color="#03060b"/>
                    <stop offset="0.58" stop-color="#070c14"/>
                    <stop offset="1" stop-color="#050912"/>
                </linearGradient>
            </defs>
            <rect width="${WIDTH}" height="${height}" fill="url(#page)"/>
            <rect width="${WIDTH}" height="10" fill="#d94f5c"/>

            <path d="M32 30 H862 L820 182 H32 Z" fill="#07090e" stroke="#fb7185" stroke-opacity="0.12"/>
            <path d="M892 30 H1248 V182 H850 Z" fill="#080b11" stroke="#ffffff" stroke-opacity="0.035"/>
            <rect x="32" y="30" width="6" height="152" fill="#d94f5c"/>
            ${text({
                x: 56,
                y: 68,
                value: seasonName.toUpperCase(),
                size: 14,
                weight: 700,
                fill: "#fda4af",
                letterSpacing: 2.8,
            })}
            ${text({
                x: 56,
                y: 122,
                value: "Overdue matches",
                size: 42,
                weight: 700,
                fill: "#ffffff",
                family: "display",
            })}
            ${text({
                x: 56,
                y: 158,
                    value: `These fixtures should already have been played · current week ${currentWeek}`,
                size: 17,
                fill: "#94a3b8",
            })}

            <rect x="936" y="72" width="126" height="64" rx="4" fill="#ffffff" fill-opacity="0.035" stroke="#ffffff" stroke-opacity="0.08"/>
            <rect x="1078" y="72" width="146" height="64" rx="4" fill="#ffffff" fill-opacity="0.035" stroke="#ffffff" stroke-opacity="0.08"/>
            ${text({ x: 999, y: 96, value: "MATCHES", size: 11, weight: 700, fill: "#64748b", anchor: "middle", letterSpacing: 1.3 })}
            ${text({ x: 999, y: 124, value: matchCount, size: 25, weight: 700, fill: "#fda4af", anchor: "middle", family: "display" })}
            ${text({ x: 1151, y: 96, value: "OLDEST", size: 11, weight: 700, fill: "#64748b", anchor: "middle", letterSpacing: 1.3 })}
            ${text({ x: 1151, y: 124, value: oldestWeek == null ? "—" : `WEEK ${oldestWeek}`, size: 25, weight: 700, fill: "#e2e8f0", anchor: "middle", family: "display" })}

            <rect x="32" y="208" width="1216" height="78" rx="3" fill="#d94f5c" fill-opacity="0.045" stroke="#d94f5c" stroke-opacity="0.28"/>
            <rect x="32" y="218" width="6" height="58" fill="#d94f5c"/>
            <rect x="56" y="227" width="40" height="40" rx="3" fill="#d94f5c" fill-opacity="0.10" stroke="#d94f5c" stroke-opacity="0.4"/>
            <circle cx="76" cy="247" r="10" fill="none" stroke="#fda4af" stroke-width="2"/>
            <path d="M76 241v7l5 3" fill="none" stroke="#fda4af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            ${text({ x: 112, y: 237, value: "ACTION REQUIRED", size: 12, weight: 750, fill: "#fda4af", letterSpacing: 1.8 })}
            ${text({ x: 112, y: 263, value: "Contact your opponent now and agree a time to play.", size: 19, weight: 600, fill: "#e2e8f0", family: "display" })}
            <rect x="1046" y="228" width="168" height="38" rx="4" fill="#ffffff" fill-opacity="0.025" stroke="#ffffff" stroke-opacity="0.07"/>
            ${text({ x: 1130, y: 252, value: "OLDEST FIRST", size: 11, weight: 750, fill: "#cbd5e1", anchor: "middle", letterSpacing: 1, middle: true })}

            ${groupSvg}

            ${text({
                x: 32,
                y: height - 24,
                value: "Sorted by oldest week · update the result once played",
                size: 14,
                fill: "#64748b",
            })}
            ${text({
                x: WIDTH - 32,
                y: height - 24,
                value: `Generated ${generatedAt}`,
                size: 14,
                fill: "#475569",
                anchor: "end",
            })}
        </svg>
    `;

    return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
