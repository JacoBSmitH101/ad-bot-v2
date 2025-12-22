// src/discord/commands/result.js
import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

export const data = new SlashCommandBuilder()
    .setName("result")
    .setDescription("Submit a match result for admin verification")
    .addUserOption((opt) =>
        opt
            .setName("opponent")
            .setDescription("Your opponent")
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
    const opponent = interaction.options.getUser("opponent", true);
    const you = interaction.options.getInteger("you", true);
    const them = interaction.options.getInteger("them", true);
    const url = interaction.options.getString("url", true);

    if (!validateAutodartsMatchUrl(url)) {
        await interaction.reply({
            content: "❌ Match URL must be a valid Autodarts match link.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    try {
        const { season, match, result } =
            await interaction.client.services.results.submit({
                guildId: interaction.guildId,
                discordUserId: interaction.user.id,
                displayName:
                    interaction.member?.displayName ??
                    interaction.user.username,
                opponentDiscordUserId: opponent.id,
                legsYou: you,
                legsThem: them,
                proofUrl: url,
            });

        const embed = new EmbedBuilder()
            .setTitle("📨 Result Submitted")
            .setDescription(`Awaiting confirmation`)
            .setColor(0xf59e0b)
            .addFields(
                {
                    name: "Players",
                    value: `<@${match.player_a_id}> vs <@${match.player_b_id}>`,
                    inline: false,
                },
                {
                    name: "Score",
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
                { name: "Match ID", value: `\`${match.id}\``, inline: false },
                {
                    name: "Season ID",
                    value: `\`${match.season_id}\``,
                    inline: false,
                }
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
