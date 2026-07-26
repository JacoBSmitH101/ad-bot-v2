import sharp from "sharp";

const WIDTH = 1280;
const CARD_X = 32;
const CARD_WIDTH = WIDTH - CARD_X * 2;
const CARD_Y = 224;
const ROW_HEIGHT = 92;
const FOOTER_HEIGHT = 72;

export async function combineFixtureImages(images) {
    if (!Array.isArray(images) || images.length === 0) {
        throw new Error("At least one fixture image is required.");
    }
    if (images.length === 1) return images[0];

    const gap = 16;
    const metadata = await Promise.all(
        images.map((image) => sharp(image).metadata())
    );
    const width = Math.max(...metadata.map((item) => item.width ?? WIDTH));
    const height =
        metadata.reduce((sum, item) => sum + (item.height ?? 0), 0) +
        gap * (images.length - 1);
    let top = 0;
    const composites = images.map((input, index) => {
        const entry = { input, top, left: 0 };
        top += (metadata[index].height ?? 0) + gap;
        return entry;
    });

    return sharp({
        create: {
            width,
            height,
            channels: 4,
            background: "#070c15",
        },
    })
        .composite(composites)
        .png({ compressionLevel: 9 })
        .toBuffer();
}

function escapeXml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

function truncate(value, max = 26) {
    const chars = Array.from(String(value ?? ""));
    return chars.length > max
        ? `${chars.slice(0, max - 1).join("")}…`
        : chars.join("");
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

function normalizeResult(match) {
    const raw = match?.match_results;
    const result = Array.isArray(raw) ? raw[0] : raw;
    if (!result) return null;

    const legsA = Number(result.legs_a);
    const legsB = Number(result.legs_b);
    if (!Number.isFinite(legsA) || !Number.isFinite(legsB)) return null;
    return { legsA, legsB };
}

function statusTheme(status) {
    switch (status) {
        case "confirmed":
            return {
                label: "CONFIRMED",
                colour: "#34d399",
                text: "#a7f3d0",
                fill: "rgba(52,211,153,0.09)",
                stroke: "rgba(52,211,153,0.24)",
            };
        case "reported":
            return {
                label: "REPORTED",
                colour: "#fbbf24",
                text: "#fde68a",
                fill: "rgba(251,191,36,0.09)",
                stroke: "rgba(251,191,36,0.24)",
            };
        case "disputed":
            return {
                label: "DISPUTED",
                colour: "#fb7185",
                text: "#fecdd3",
                fill: "rgba(251,113,133,0.09)",
                stroke: "rgba(251,113,133,0.24)",
            };
        case "void":
            return {
                label: "VOID",
                colour: "#64748b",
                text: "#cbd5e1",
                fill: "rgba(100,116,139,0.09)",
                stroke: "rgba(100,116,139,0.24)",
            };
        default:
            return {
                label: "TO PLAY",
                colour: "#22d3ee",
                text: "#a5f3fc",
                fill: "rgba(34,211,238,0.08)",
                stroke: "rgba(34,211,238,0.22)",
            };
    }
}

/**
 * Render a division's weekly fixtures as a Discord-ready PNG.
 *
 * @param {{
 *   seasonName: string,
 *   divisionName: string,
 *   week: number,
 *   matches: Array<object>,
 *   overdueMatches?: Array<object>,
 *   nameById?: Map<string, string>
 * }} params
 * @returns {Promise<Buffer>}
 */
export async function renderFixturesImage({
    seasonName,
    divisionName,
    week,
    matches,
    overdueMatches = [],
    nameById = new Map(),
}) {
    const rows = Array.isArray(matches) ? matches : [];
    const overdueRows = Array.isArray(overdueMatches) ? overdueMatches : [];
    const currentRowCount = Math.max(rows.length, 1);
    const overdueHeaderHeight = overdueRows.length > 0 ? 58 : 0;
    const overdueStartY =
        CARD_Y + currentRowCount * ROW_HEIGHT + overdueHeaderHeight;
    const height =
        overdueStartY + overdueRows.length * ROW_HEIGHT + FOOTER_HEIGHT;
    const completed = rows.filter(
        (match) => match.status === "confirmed"
    ).length;

    const renderRows = (items, startY, { overdue = false } = {}) =>
        items
        .map((match, index) => {
            const y = startY + index * ROW_HEIGHT;
            const baseline = y + 54;
            const theme = overdue
                ? {
                      label: `OVERDUE · W${match.week}`,
                      colour: "#fb7185",
                      text: "#fecdd3",
                      fill: "rgba(251,113,133,0.075)",
                      stroke: "rgba(251,113,133,0.22)",
                  }
                : statusTheme(match.status);
            const result = normalizeResult(match);
            const playerA = truncate(
                nameById.get(match.player_a_id) ?? match.player_a_id
            );
            const playerB = truncate(
                nameById.get(match.player_b_id) ?? match.player_b_id
            );
            const centreText = result
                ? `${result.legsA}  —  ${result.legsB}`
                : "VS";

            return `
                <rect x="${CARD_X}" y="${y + 5}" width="${CARD_WIDTH}" height="${
                    ROW_HEIGHT - 10
                }" rx="18" fill="${theme.fill}" stroke="${theme.stroke}" />
                <rect x="${CARD_X}" y="${y + 18}" width="5" height="${
                    ROW_HEIGHT - 36
                }" rx="2.5" fill="${theme.colour}" />
                ${text({
                    x: 76,
                    y: baseline,
                    value: overdue
                        ? `W${match.week}`
                        : String(index + 1).padStart(2, "0"),
                    size: 17,
                    weight: 700,
                    fill: overdue ? "#fda4af" : "#64748b",
                    anchor: "middle",
                    letterSpacing: 1.2,
                })}
                ${text({
                    x: 536,
                    y: baseline,
                    value: playerA,
                    size: 25,
                    weight: 650,
                    fill: "#f1f5f9",
                    anchor: "end",
                    family: "display",
                })}
                ${text({
                    x: 640,
                    y: baseline,
                    value: centreText,
                    size: result ? 25 : 17,
                    weight: 750,
                    fill: result ? "#ffffff" : "#64748b",
                    anchor: "middle",
                    family: "display",
                    letterSpacing: result ? 0 : 1.5,
                })}
                ${text({
                    x: 744,
                    y: baseline,
                    value: playerB,
                    size: 25,
                    weight: 650,
                    fill: "#f1f5f9",
                    family: "display",
                })}
                <rect x="1050" y="${y + 25}" width="156" height="42" rx="21" fill="${theme.fill}" stroke="${theme.stroke}" />
                ${text({
                    x: 1128,
                    y: y + 52,
                    value: theme.label,
                    size: 12,
                    weight: 750,
                    fill: theme.text,
                    anchor: "middle",
                    letterSpacing: 1.3,
                })}
            `;
        })
        .join("");

    const rowSvg = renderRows(rows, CARD_Y);
    const overdueSvg = renderRows(overdueRows, overdueStartY, {
        overdue: true,
    });
    const emptySvg =
        rows.length === 0
            ? text({
                  x: WIDTH / 2,
                  y: CARD_Y + 57,
                  value: "No fixtures scheduled for this division and week",
                  size: 21,
                  fill: "#64748b",
                  anchor: "middle",
              })
            : "";
    const overdueHeaderSvg =
        overdueRows.length > 0
            ? `
                ${text({
                    x: 42,
                    y:
                        CARD_Y +
                        currentRowCount * ROW_HEIGHT +
                        overdueHeaderHeight -
                        18,
                    value: "OVERDUE FROM PREVIOUS WEEKS",
                    size: 14,
                    weight: 750,
                    fill: "#fb7185",
                    letterSpacing: 1.8,
                })}
            `
            : "";

    const generatedAt = new Intl.DateTimeFormat("en-GB", {
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
            <rect x="32" y="30" width="790" height="158" rx="24" fill="url(#titleGlow)" />

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
                value: `${divisionName} · Week ${week}`,
                size: 42,
                weight: 700,
                fill: "#ffffff",
                family: "display",
            })}
            ${text({
                x: 56,
                y: 160,
                value: "Weekly league fixtures and confirmed results",
                size: 17,
                fill: "#94a3b8",
            })}

            <rect x="936" y="72" width="126" height="64" rx="16" fill="rgba(255,255,255,0.045)" stroke="rgba(255,255,255,0.07)" />
            <rect x="1078" y="72" width="146" height="64" rx="16" fill="rgba(255,255,255,0.045)" stroke="rgba(255,255,255,0.07)" />
            ${text({ x: 999, y: 96, value: "MATCHES", size: 11, weight: 700, fill: "#64748b", anchor: "middle", letterSpacing: 1.3 })}
            ${text({ x: 999, y: 124, value: rows.length, size: 25, weight: 700, fill: "#e2e8f0", anchor: "middle", family: "display" })}
            ${text({ x: 1151, y: 96, value: "COMPLETE", size: 11, weight: 700, fill: "#64748b", anchor: "middle", letterSpacing: 1.3 })}
            ${text({ x: 1151, y: 124, value: `${completed}/${rows.length}`, size: 25, weight: 700, fill: "#a7f3d0", anchor: "middle", family: "display" })}

            ${rowSvg}
            ${emptySvg}
            ${overdueHeaderSvg}
            ${overdueSvg}

            ${text({
                x: 32,
                y: height - 25,
                value: "Cyan: to play · Amber: reported · Green: confirmed · Red: overdue",
                size: 14,
                fill: "#64748b",
            })}
            ${text({
                x: WIDTH - 32,
                y: height - 25,
                value: `Preview generated ${generatedAt}`,
                size: 14,
                fill: "#475569",
                anchor: "end",
            })}
        </svg>
    `;

    return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
