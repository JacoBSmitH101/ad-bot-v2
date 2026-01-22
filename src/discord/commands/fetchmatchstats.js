import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { DomainError } from "../../utils/DomainError.js";
import { extractAutodartsMatchId } from "../../utils/autodarts.js";
import { supabase } from "../../db/supabase.js";

/**
 * Discord slash command: /fetchmatchstats
 * [ADMIN] Check if a match is completed, and fetch/refresh its stats from Autodarts if not already cached.
 * @module commands/fetchmatchstats
 */

export const data = new SlashCommandBuilder()
    .setName("fetchmatchstats")
    .setDescription(
        "[ADMIN] Check match completion and fetch stats by match ID if not already cached"
    )
    .addIntegerOption((opt) =>
        opt
            .setName("match_id")
            .setDescription("Internal match ID (from fixtures or database)")
            .setRequired(true)
    );

/**
 * Execute the /fetchmatchstats command.
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

    const matchId = interaction.options.getInteger("match_id", true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const match = await interaction.client.repos.matches.getById(matchId);
        if (!match) {
            await interaction.editReply(`❌ Match **${matchId}** not found.`);
            return;
        }

        const result =
            await interaction.client.repos.matchResults.getByMatchId(matchId);
        if (!result || !result.proof_url) {
            await interaction.editReply(
                `❌ Match **${matchId}** is not completed: no result with proof URL. Report and confirm a result first.`
            );
            return;
        }

        const autodartsId = extractAutodartsMatchId(result.proof_url);
        if (!autodartsId) {
            await interaction.editReply(
                `❌ Match **${matchId}** has an invalid proof URL (not a valid Autodarts match link).`
            );
            return;
        }

        // Check if stats already exist in cache (ignore cache errors and assume not cached)
        const { data: cacheRow } = await supabase
            .from("autodarts_match_stats_cache")
            .select("match_id")
            .eq("match_id", autodartsId)
            .maybeSingle();

        if (cacheRow != null) {
            // Trigger a fetch anyway so the internal API can refresh; then report
            try {
                const stats =
                    await interaction.client.services.matchStats.getMatchStatsByMatchId(
                        matchId
                    );
                if (stats.queued) {
                    await interaction.editReply(
                        `✅ Stats **already in cache** for match **${matchId}** (Autodarts \`${autodartsId}\`). Re-fetch returned _queued_ (may still be processing).`
                    );
                } else {
                    await interaction.editReply(
                        `✅ Stats **already in cache** for match **${matchId}** (Autodarts \`${autodartsId}\`). Re-fetched successfully.`
                    );
                }
            } catch (e) {
                // Cache said we have it; API/refetch failed
                await interaction.editReply(
                    `✅ Stats **already in cache** for match **${matchId}** (Autodarts \`${autodartsId}\`). Re-fetch failed: ${e?.message ?? "unknown error"}.`
                );
            }
            return;
        }

        // Not in cache: fetch via internal API
        const stats =
            await interaction.client.services.matchStats.getMatchStatsByMatchId(
                matchId
            );

        if (stats.queued) {
            await interaction.editReply(
                `⏳ Stats **queued for fetching** for match **${matchId}** (Autodarts \`${autodartsId}\`). Autodarts may still be processing; try again in a few minutes.`
            );
            return;
        }

        await interaction.editReply(
            `✅ Stats **fetched and cached** for match **${matchId}** (Autodarts \`${autodartsId}\`).`
        );
    } catch (err) {
        if (err instanceof DomainError) {
            const msg =
                err.code === "STATS_SHAPE"
                    ? "Stats payload missing or malformed; Autodarts may not have finished processing."
                    : err.message;
            await interaction.editReply(`❌ ${msg}`);
            return;
        }
        console.error("fetchmatchstats error:", err);
        await interaction.editReply(
            `❌ Something went wrong: ${err?.message ?? "unknown error"}.`
        );
    }
}
