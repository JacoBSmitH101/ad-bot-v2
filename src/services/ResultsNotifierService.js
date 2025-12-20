// src/services/ResultsNotifierService.js
import {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from "discord.js";

export class ResultsNotifierService {
    constructor({ config }) {
        this.config = config;
    }

    async sendVerification({ client, guildId, match, result }) {
        const embed = new EmbedBuilder()
            .setTitle("🔍 Result awaiting verification")
            .setDescription(
                `**<@${match.player_a_id}> vs <@${match.player_b_id}>**`
            )
            .addFields(
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
                { name: "Match ID", value: `\`${match.id}\``, inline: false },
                {
                    name: "Season ID",
                    value: `\`${match.season_id}\``,
                    inline: false,
                }
            )
            .setFooter({ text: "Confirm or reject below" })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`result_confirm:${match.id}`)
                .setLabel("Confirm")
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`result_reject:${match.id}`)
                .setLabel("Reject")
                .setStyle(ButtonStyle.Danger)
        );

        // Preferred: mod channel
        if (this.config.resultsReviewChannelId) {
            const channel = await client.channels.fetch(
                this.config.resultsReviewChannelId
            );
            if (channel) {
                await channel.send({ embeds: [embed], components: [row] });
                return;
            }
        }

        // Fallback: DM admin user
        if (this.config.adminUserId) {
            const admin = await client.users.fetch(this.config.adminUserId);
            if (admin) {
                await admin.send({ embeds: [embed], components: [row] });
                return;
            }
        }

        // If neither is configured, just fail loudly in logs (don’t break the user command)
        console.warn(
            "No results review channel or admin user configured; cannot send verification embed."
        );
    }
}
