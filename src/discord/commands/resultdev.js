// src/discord/commands/resultdev.js
import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

export const data = new SlashCommandBuilder()
    .setName("resultdev")
    .setDescription("[DEV] Submit a result against a fake player id")
    .addStringOption((opt) =>
        opt
            .setName("opponent_id")
            .setDescription("Opponent discord_user_id (e.g. FAKE_001)")
            .setRequired(true)
    )
    .addIntegerOption((opt) =>
        opt.setName("you").setDescription("Your legs won").setRequired(true)
    )
    .addIntegerOption((opt) =>
        opt
            .setName("them")
            .setDescription("Opponent legs won")
            .setRequired(true)
    )
    .addStringOption((opt) =>
        opt.setName("url").setDescription("Proof URL").setRequired(true)
    );
function validateAutodartsMatchUrl(url) {
    const regex =
        /^https:\/\/play\.autodarts\.io\/history\/matches\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    return regex.test(url);
}

export async function execute(interaction) {
    const opponentId = interaction.options
        .getString("opponent_id", true)
        .trim();
    const you = interaction.options.getInteger("you", true);
    const them = interaction.options.getInteger("them", true);
    const url = interaction.options.getString("url", true);

    // hard dev guard
    if (process.env.NODE_ENV === "production") {
        await interaction.reply({
            content: "❌ Not available in production.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    if (!validateAutodartsMatchUrl(url)) {
        interaction.reply({
            content: "❌ Match URL must be a valid Autodarts match link.",
            flags: MessageFlags.Ephemeral,
        });
        throw new DomainError(
            "INVALID_PROOF_URL",
            "Match URL must be a valid Autodarts match link."
        );
    }
    try {
        const { season, match, result } =
            await interaction.client.services.results.submit({
                guildId: interaction.guildId,
                discordUserId: interaction.user.id,
                displayName:
                    interaction.member?.displayName ??
                    interaction.user.username,
                opponentDiscordUserId: opponentId,
                legsYou: you,
                legsThem: them,
                proofUrl: url,
            });

        const embed = new EmbedBuilder()
            .setTitle("🧪 [DEV] Result Submitted")
            .setDescription(`Awaiting confirmation`)
            .setColor(0xf59e0b)
            .addFields(
                {
                    name: "Players",
                    value: `<@${match.player_a_id}> vs \`${match.player_b_id}\``,
                    inline: false,
                },
                {
                    name: "Score",
                    value: `**${result.legs_a} - ${result.legs_b}**`,
                    inline: true,
                },
                {
                    name: "Proof",
                    value: result.proof_url
                        ? `[Open link](${result.proof_url})`
                        : "None",
                    inline: true,
                },
                { name: "Match ID", value: `\`${match.id}\``, inline: false }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed], flags: 0 });
        const msg = await interaction.fetchReply();
        await interaction.client.repos.matches.setResultMessage({
            matchId: match.id,
            channelId: interaction.channelId,
            messageId: msg.id,
        });
        await interaction.client.services.resultsNotifier.sendVerification({
            client: interaction.client,
            guildId: interaction.guildId,
            match,
            result,
        });
    } catch (err) {
        if (err instanceof DomainError) {
            await interaction.reply({
                content: `❌ ${err.message}`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        console.error(err);
        await interaction.reply({
            content: "❌ Something went wrong.",
            flags: MessageFlags.Ephemeral,
        });
    }
}
