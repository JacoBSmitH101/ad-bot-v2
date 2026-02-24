import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { DomainError } from "../../utils/DomainError.js";
import { supabase } from "../../db/supabase.js";
import { extractAutodartsMatchId } from "../../utils/autodarts.js";

/**
 * Discord slash command: /missingstats
 * [ADMIN] List completed matches (confirmed with proof URL) that do not have a
 * corresponding row in the autodarts_match_stats_cache table.
 * @module commands/missingstats
 */

export const data = new SlashCommandBuilder()
    .setName("missingstats")
    .setDescription(
        "[ADMIN] List completed matches that are missing Autodarts stats cache entries"
    );

/**
 * Execute the /missingstats command.
 * Finds confirmed matches with proof URLs in this guild whose Autodarts IDs
 * are not present in autodarts_match_stats_cache.
 * @param {Object} interaction - Discord ChatInputCommandInteraction object.
 * @returns {Promise<void>}
 */
export async function execute(interaction) {
    const cfg = interaction.client.services.config;
    const isAdmin =
        (cfg.adminUserId && interaction.user.id === cfg.adminUserId) ||
        (cfg.adminRoleId &&
            interaction.member?.roles?.cache?.has(cfg.adminRoleId));

    if (!isAdmin) {
        await interaction.reply({
            content: "❌ You don't have permission to do that.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        // 1) Get all seasons for this guild so we only scan this guild's matches
        const { data: seasons, error: seasonsError } = await supabase
            .from("seasons")
            .select("id,name")
            .eq("guild_id", interaction.guildId);

        if (seasonsError) throw seasonsError;
        if (!seasons || seasons.length === 0) {
            await interaction.editReply(
                "❌ No seasons found for this guild. Nothing to check."
            );
            return;
        }

        const seasonIds = seasons.map((s) => s.id);

        // 2) Fetch confirmed matches across these seasons with their results joined
        const { data: matches, error: matchesError } = await supabase
            .from("matches")
            .select(
                `
                id,
                season_id,
                division_id,
                week,
                player_a_id,
                player_b_id,
                status,
                match_results (
                    legs_a,
                    legs_b,
                    proof_url
                )
            `
            )
            .in("season_id", seasonIds)
            .eq("status", "confirmed")
            .order("season_id", { ascending: true })
            .order("week", { ascending: true });

        if (matchesError) throw matchesError;

        // 3) Filter to matches that actually have a result with a valid Autodarts URL
        const completedWithProof = [];
        for (const match of matches ?? []) {
            const mrRaw = match.match_results;
            const mr = Array.isArray(mrRaw) ? mrRaw[0] : mrRaw;
            if (!mr || !mr.proof_url) continue;

            const autodartsId = extractAutodartsMatchId(mr.proof_url);
            if (!autodartsId) continue; // skip invalid URLs; other commands surface those

            completedWithProof.push({ match, result: mr, autodartsId });
        }

        if (completedWithProof.length === 0) {
            await interaction.editReply(
                "✅ No confirmed matches with proof URLs found for this guild."
            );
            return;
        }

        // 4) Check which Autodarts IDs are already present in the cache table
        const uniqueIds = [
            ...new Set(completedWithProof.map((x) => x.autodartsId)),
        ];

        const { data: cacheRows, error: cacheError } = await supabase
            .from("autodarts_match_stats_cache")
            .select("match_id")
            .in("match_id", uniqueIds);

        if (cacheError) throw cacheError;

        const cachedIds = new Set((cacheRows ?? []).map((r) => r.match_id));

        const missing = completedWithProof.filter(
            (x) => !cachedIds.has(x.autodartsId)
        );

        if (missing.length === 0) {
            await interaction.editReply(
                "✅ All confirmed matches with proof URLs in this guild have stats cache entries."
            );
            return;
        }

        // 5) Format a concise report (cap listing to avoid overly long messages)
        const maxToShow = 50;
        const lines = missing.slice(0, maxToShow).map(({ match, result }) => {
            const season = seasons.find((s) => s.id === match.season_id);
            const seasonName = season?.name ?? `Season ${match.season_id}`;
            return `• Match **${match.id}** — ${seasonName}, week ${match.week}, <@${match.player_a_id}> vs <@${match.player_b_id}> — proof: ${result.proof_url}`;
        });

        let footer = "";
        if (missing.length > maxToShow) {
            footer = `\n...and ${missing.length - maxToShow} more matches.`;
        }

        await interaction.editReply(
            `Found **${missing.length}** confirmed matches with proof URLs that are **missing stats cache entries**:\n` +
                lines.join("\n") +
                footer
        );
    } catch (err) {
        console.error("missingstats error:", err);
        if (err instanceof DomainError) {
            await interaction.editReply(`❌ ${err.message}`);
            return;
        }
        await interaction.editReply(
            `❌ Something went wrong while checking for missing stats: ${
                err?.message ?? "unknown error"
            }.`
        );
    }
}

