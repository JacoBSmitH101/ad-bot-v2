import {
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
} from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

/**
 * Discord slash command: /admin-result
 * Admin-only command to submit a match result on behalf of two players.
 * @module commands/admin_result
 */

export const data = new SlashCommandBuilder()
    .setName("admin-result")
    .setDescription("[ADMIN] Submit a match result on behalf of two players")
    .addUserOption((opt) =>
        opt
            .setName("player_a")
            .setDescription("Player A")
            .setRequired(true)
    )
    .addUserOption((opt) =>
        opt
            .setName("player_b")
            .setDescription("Player B")
            .setRequired(true)
    )
    .addIntegerOption((opt) =>
        opt
            .setName("legs_a")
            .setDescription("Legs won by Player A")
            .setRequired(true)
    )
    .addIntegerOption((opt) =>
        opt
            .setName("legs_b")
            .setDescription("Legs won by Player B")
            .setRequired(true)
    )
    .addStringOption((opt) =>
        opt
            .setName("url")
            .setDescription(
                "Autodarts match link (optional; omit for forfeits with no match)"
            )
            .setRequired(false)
    )
    .addBooleanOption((opt) =>
        opt
            .setName("auto_confirm")
            .setDescription("Automatically confirm the result (default: false)")
            .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

/**
 * Validate that URL is a valid Autodarts match link.
 * @private
 * @param {string} url
 * @returns {boolean}
 */
function validateAutodartsMatchUrl(url) {
    const regex =
        /^https:\/\/play\.autodarts\.io\/history\/matches\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    return regex.test(url);
}

/**
 * Execute the /admin-result command.
 * Validates admin permissions, optionally validates Autodarts URL, submits result on behalf of players, and optionally sends verification notification.
 * @param {Object} interaction - Discord ChatInputCommandInteraction object.
 * @returns {Promise<void>}
 * @throws {DomainError} If URL invalid (when provided), season not active, no match found, or other validation errors.
 */
export async function execute(interaction) {
    // Check if user is admin
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

    const playerA = interaction.options.getUser("player_a", true);
    const playerB = interaction.options.getUser("player_b", true);
    const legsA = interaction.options.getInteger("legs_a", true);
    const legsB = interaction.options.getInteger("legs_b", true);
    const url = interaction.options.getString("url");
    const autoConfirm = interaction.options.getBoolean("auto_confirm", false) ?? false;

    if (url && !validateAutodartsMatchUrl(url)) {
        await interaction.reply({
            content: "❌ Match URL must be a valid Autodarts match link.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const { season, match, result } =
            await interaction.client.services.results.adminSubmitResult({
                guildId: interaction.guildId,
                adminDiscordUserId: interaction.user.id,
                adminDisplayName:
                    interaction.member?.displayName ??
                    interaction.user.username,
                playerAId: playerA.id,
                playerBId: playerB.id,
                legsA,
                legsB,
                proofUrl: url ?? null,
                autoConfirm,
            });

        const embed = new EmbedBuilder()
            .setTitle(
                autoConfirm
                    ? "✅ Result Submitted & Confirmed (Admin)"
                    : "📨 Result Submitted (Admin)"
            )
            .setDescription(
                autoConfirm
                    ? `Result confirmed for **${season.name}**`
                    : `Awaiting confirmation for **${season.name}**`
            )
            .setColor(autoConfirm ? 0x57f287 : 0xf59e0b)
            .addFields(
                {
                    name: "Players",
                    value: `<@${match.player_a_id}> vs <@${match.player_b_id}>`,
                    inline: false,
                },
                {
                    name: "Score (A–B)",
                    value: `**${result.legs_a} - ${result.legs_b}**`,
                    inline: true,
                },
                {
                    name: "Match link",
                    value: result.proof_url
                        ? `[Open link](${result.proof_url})`
                        : "None",
                    inline: true,
                },
                {
                    name: "Submitted by",
                    value: `<@${interaction.user.id}>`,
                    inline: false,
                },
                { name: "Match ID", value: `\`${match.id}\``, inline: false },
                {
                    name: "Season ID",
                    value: `\`${match.season_id}\``,
                    inline: false,
                }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        // Store message reference if not auto-confirmed (so it can be updated later)
        if (!autoConfirm) {
            const msg = await interaction.fetchReply();
            await interaction.client.repos.matches.setResultMessage({
                matchId: match.id,
                channelId: interaction.channelId,
                messageId: msg.id,
            });

            // Send verification notification to admins
            await interaction.client.services.resultsNotifier.sendVerification({
                client: interaction.client,
                guildId: interaction.guildId,
                match,
                result,
            });
        } else {
            // If auto-confirmed, refresh fixtures and standings
            await interaction.client.services.fixturesPublisher?.refresh?.({
                client: interaction.client,
                guildId: interaction.guildId,
            });
            await interaction.client.services.standingsPublisher?.refresh?.({
                client: interaction.client,
                guildId: interaction.guildId,
            });
            await interaction.client.services.statsLeadersPublisher?.refresh?.({
                client: interaction.client,
                guildId: interaction.guildId,
            });
        }
    } catch (err) {
        if (err instanceof DomainError) {
            await interaction.editReply(`❌ ${err.message}`);
            return;
        }
        console.error(err);
        await interaction.editReply("❌ Something went wrong.");
    }
}
