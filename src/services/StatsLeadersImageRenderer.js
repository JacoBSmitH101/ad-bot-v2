import sharp from "sharp";

const WIDTH = 1280;
const HEIGHT = 960;
const CARD_WIDTH = 592;
const CARD_HEIGHT = 328;
const ROW_HEIGHT = 40;
const ROW_STEP = 42;

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

function rankTheme(index) {
    if (index === 0) {
        return {
            fill: "#fbbf24",
            text: "#fde68a",
            opacity: 0.15,
            strokeOpacity: 0.42,
        };
    }
    if (index === 1) {
        return {
            fill: "#cbd5e1",
            text: "#e2e8f0",
            opacity: 0.11,
            strokeOpacity: 0.27,
        };
    }
    if (index === 2) {
        return {
            fill: "#fb923c",
            text: "#fdba74",
            opacity: 0.1,
            strokeOpacity: 0.28,
        };
    }
    return {
        fill: "#64748b",
        text: "#64748b",
        opacity: 0,
        strokeOpacity: 0,
    };
}

function renderCard({
    x,
    y,
    title,
    note,
    icon,
    accent,
    valueColour,
    valueLabel,
    entries,
    formatValue,
}) {
    const rows = entries.slice(0, 5);
    const rowStart = y + 116;
    const rowSvg = rows
        .map((entry, index) => {
            const rowY = rowStart + index * ROW_STEP;
            const baseline = rowY + ROW_HEIGHT / 2 + 1;
            const rank = rankTheme(index);
            const winnerBackground =
                index === 0
                    ? `<rect x="${x + 14}" y="${rowY}" width="${
                          CARD_WIDTH - 28
                      }" height="${ROW_HEIGHT}" rx="11" fill="#fbbf24" fill-opacity="0.075" stroke="#fbbf24" stroke-opacity="0.18"/>
                       <rect x="${x + 14}" y="${rowY + 6}" width="4" height="${
                          ROW_HEIGHT - 12
                      }" rx="2" fill="#fbbf24"/>`
                    : `<rect x="${x + 14}" y="${rowY}" width="${
                          CARD_WIDTH - 28
                      }" height="${ROW_HEIGHT}" rx="11" fill="#ffffff" fill-opacity="${
                          index % 2 === 0 ? 0.014 : 0.025
                      }"/>`;

            return `
                ${winnerBackground}
                <circle cx="${x + 44}" cy="${baseline}" r="14" fill="${
                    rank.fill
                }" fill-opacity="${rank.opacity}" stroke="${rank.fill}" stroke-opacity="${
                    rank.strokeOpacity
                }"/>
                ${text({
                    x: x + 44,
                    y: baseline,
                    value: index + 1,
                    size: 15,
                    weight: 750,
                    fill: rank.text,
                    anchor: "middle",
                    middle: true,
                })}
                ${text({
                    x: x + 76,
                    y: baseline,
                    value: truncate(entry.name),
                    size: 19,
                    weight: 650,
                    fill: "#f1f5f9",
                    family: "display",
                    middle: true,
                })}
                ${text({
                    x: x + 468,
                    y: baseline,
                    value: entry.matchCount ?? "—",
                    size: 15,
                    weight: 600,
                    fill: "#64748b",
                    anchor: "end",
                    middle: true,
                })}
                ${text({
                    x: x + 562,
                    y: baseline,
                    value: formatValue(entry.value),
                    size: 21,
                    weight: 750,
                    fill: index === 0 ? valueColour : "#cbd5e1",
                    anchor: "end",
                    family: "display",
                    middle: true,
                })}
            `;
        })
        .join("");

    const emptySvg =
        rows.length === 0
            ? text({
                  x: x + CARD_WIDTH / 2,
                  y: y + 205,
                  value: "No data available yet",
                  size: 18,
                  fill: "#64748b",
                  anchor: "middle",
              })
            : "";

    return `
        <rect x="${x}" y="${y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="22" fill="url(#card)" stroke="#ffffff" stroke-opacity="0.075"/>
        <rect x="${x}" y="${y}" width="5" height="${CARD_HEIGHT}" rx="2.5" fill="${accent}"/>
        <circle cx="${x + 36}" cy="${y + 41}" r="18" fill="${accent}" fill-opacity="0.12" stroke="${accent}" stroke-opacity="0.35"/>
        ${text({
            x: x + 36,
            y: y + 42,
            value: icon,
            size: 16,
            weight: 750,
            fill: valueColour,
            anchor: "middle",
            family: "display",
            middle: true,
        })}
        ${text({
            x: x + 66,
            y: y + 39,
            value: title,
            size: 22,
            weight: 700,
            fill: "#f8fafc",
            family: "display",
        })}
        ${text({
            x: x + 66,
            y: y + 61,
            value: note,
            size: 13,
            fill: "#64748b",
        })}
        ${text({
            x: x + 24,
            y: y + 102,
            value: "RANK",
            size: 11,
            weight: 700,
            fill: "#64748b",
            letterSpacing: 1.4,
        })}
        ${text({
            x: x + 76,
            y: y + 102,
            value: "PLAYER",
            size: 11,
            weight: 700,
            fill: "#64748b",
            letterSpacing: 1.4,
        })}
        ${text({
            x: x + 468,
            y: y + 102,
            value: "M",
            size: 11,
            weight: 700,
            fill: "#64748b",
            anchor: "end",
            letterSpacing: 1.4,
        })}
        ${text({
            x: x + 562,
            y: y + 102,
            value: valueLabel,
            size: 11,
            weight: 700,
            fill: "#64748b",
            anchor: "end",
            letterSpacing: 1.4,
        })}
        ${rowSvg}
        ${emptySvg}
    `;
}

/**
 * Render the season's four stat leaderboards as a Discord-ready PNG.
 *
 * @param {{
 *   seasonName: string,
 *   qualifiedPlayers: number,
 *   matchesWithStats: number,
 *   average: Array<{name: string, value: number, matchCount: number}>,
 *   checkoutPercent: Array<{name: string, value: number, matchCount: number}>,
 *   highestCheckout: Array<{name: string, value: number, matchCount: number}>,
 *   first9Average: Array<{name: string, value: number, matchCount: number}>
 * }} params
 * @returns {Promise<Buffer>}
 */
export async function renderStatsLeadersImage({
    seasonName,
    qualifiedPlayers,
    matchesWithStats,
    average = [],
    checkoutPercent = [],
    highestCheckout = [],
    first9Average = [],
}) {
    const generatedAt = new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/London",
    }).format(new Date());

    const cards = [
        renderCard({
            x: 32,
            y: 210,
            title: "3-Dart Average",
            note: "Scoring consistency",
            icon: "A",
            accent: "#22d3ee",
            valueColour: "#67e8f9",
            valueLabel: "AVG",
            entries: average,
            formatValue: (value) => Number(value).toFixed(1),
        }),
        renderCard({
            x: 656,
            y: 210,
            title: "Checkout %",
            note: "Doubles efficiency",
            icon: "✓",
            accent: "#34d399",
            valueColour: "#6ee7b7",
            valueLabel: "CO%",
            entries: checkoutPercent,
            formatValue: (value) => `${Number(value).toFixed(1)}%`,
        }),
        renderCard({
            x: 32,
            y: 562,
            title: "Highest Checkout",
            note: "Best single finish",
            icon: "H",
            accent: "#a78bfa",
            valueColour: "#c4b5fd",
            valueLabel: "HIGH",
            entries: highestCheckout,
            formatValue: (value) => Math.round(Number(value)),
        }),
        renderCard({
            x: 656,
            y: 562,
            title: "First 9 Average",
            note: "Opening scoring power",
            icon: "9",
            accent: "#fb7185",
            valueColour: "#fda4af",
            valueLabel: "F9",
            entries: first9Average,
            formatValue: (value) => Number(value).toFixed(1),
        }),
    ].join("");

    const svg = `
        <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="page" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stop-color="#070c15"/>
                    <stop offset="0.58" stop-color="#0b1220"/>
                    <stop offset="1" stop-color="#0a1020"/>
                </linearGradient>
                <linearGradient id="titleGlow" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stop-color="#22d3ee" stop-opacity="0.18"/>
                    <stop offset="0.55" stop-color="#8b5cf6" stop-opacity="0.09"/>
                    <stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/>
                </linearGradient>
                <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stop-color="#111a2a"/>
                    <stop offset="1" stop-color="#0c1422"/>
                </linearGradient>
            </defs>
            <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#page)"/>
            <rect width="${WIDTH}" height="6" fill="#22d3ee" opacity="0.88"/>
            <circle cx="1180" cy="24" r="190" fill="#22d3ee" opacity="0.035"/>
            <circle cx="1032" cy="24" r="130" fill="#8b5cf6" opacity="0.04"/>
            <rect x="32" y="30" width="810" height="152" rx="24" fill="url(#titleGlow)"/>

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
                value: "Stat Leaders",
                size: 42,
                weight: 700,
                fill: "#ffffff",
                family: "display",
            })}
            ${text({
                x: 56,
                y: 158,
                value: "Top five performers across confirmed matches · running season averages",
                size: 17,
                fill: "#94a3b8",
            })}

            <rect x="936" y="72" width="126" height="64" rx="16" fill="#ffffff" fill-opacity="0.045" stroke="#ffffff" stroke-opacity="0.07"/>
            <rect x="1078" y="72" width="146" height="64" rx="16" fill="#ffffff" fill-opacity="0.045" stroke="#ffffff" stroke-opacity="0.07"/>
            ${text({ x: 999, y: 96, value: "QUALIFIED", size: 11, weight: 700, fill: "#64748b", anchor: "middle", letterSpacing: 1.3 })}
            ${text({ x: 999, y: 124, value: qualifiedPlayers, size: 25, weight: 700, fill: "#e2e8f0", anchor: "middle", family: "display" })}
            ${text({ x: 1151, y: 96, value: "MATCHES", size: 11, weight: 700, fill: "#64748b", anchor: "middle", letterSpacing: 1.3 })}
            ${text({ x: 1151, y: 124, value: matchesWithStats, size: 25, weight: 700, fill: "#c4b5fd", anchor: "middle", family: "display" })}

            ${cards}

            ${text({
                x: 32,
                y: 932,
                value: "M = matches with available stats",
                size: 14,
                fill: "#64748b",
            })}
            ${text({
                x: WIDTH - 32,
                y: 932,
                value: `Updated ${generatedAt}`,
                size: 14,
                fill: "#475569",
                anchor: "end",
            })}
        </svg>
    `;

    return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
