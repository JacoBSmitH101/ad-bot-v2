export async function execute(interaction) {
    const opponentId = interaction.options
        .getString("opponent_id", true)
        .trim();
    const you = interaction.options.getInteger("you", true);
    const them = interaction.options.getInteger("them", true);
    const url = interaction.options.getString("url", true);

    if (process.env.NODE_ENV === "production") {
        await interaction.reply({
            content: "❌ Not available in production.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (!validateAutodartsMatchUrl(url)) {
        await interaction.reply({
            content: "❌ Match URL must be a valid Autodarts match link.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferReply({ flags: 0 }); // public reply (not ephemeral)

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

        await interaction.editReply({ embeds: [embed] });

        const msg = await interaction.fetchReply();

        if (!match?.id) throw new DomainError("BAD_MATCH", "Match ID missing.");
        if (!msg?.id) throw new DomainError("BAD_MSG", "Message ID missing.");

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
            await interaction.editReply({
                content: `❌ ${err.message}`,
                embeds: [],
            });
            return;
        }
        console.error(err);
        await interaction.editReply({
            content: "❌ Something went wrong.",
            embeds: [],
        });
    }
}
