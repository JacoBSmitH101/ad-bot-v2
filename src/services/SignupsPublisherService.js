import { EmbedBuilder } from "discord.js";
import { DomainError } from "../utils/DomainError.js";

export class SignupsPublisherService {
    /**
     * @param {{ seasons: any, signups: any }} deps
     */
    constructor({ seasons, signups }) {
        this.seasons = seasons;
        this.signups = signups;
    }

    /**
     * Post (or repost) the signups list to a channel and remember the message ID
     */
    async publish({ client, guildId, channelId }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        if (season.status !== "signups_open") {
            throw new DomainError(
                "INVALID_STATE",
                `Signups publish only available while signups are open (current: ${season.status})`
            );
        }

        const channel = await client.channels
            .fetch(channelId)
            .catch(() => null);
        if (!channel || !channel.isTextBased()) {
            throw new DomainError(
                "BAD_CHANNEL",
                "That channel is not a text channel."
            );
        }

        // create placeholder message and store references for later refreshes
        const msg = await channel.send({ content: "📝 Publishing signups..." });

        await this.seasons.setSignupsChannel(season.id, channelId);
        await this.seasons.setSignupsMessageId(season.id, msg.id);

        await this.refresh({ client, guildId });

        return { season, channelId, messageId: msg.id };
    }

    /**
     * Refresh the published signups message if configured
     */
    async refresh({ client, guildId }) {
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season) throw new DomainError("NO_SEASON", "No season found.");

        if (!season.signups_channel_id || !season.signups_message_id) {
            return { updated: false, skipped: true };
        }

        const channel = await client.channels
            .fetch(season.signups_channel_id)
            .catch(() => null);
        if (!channel || !channel.isTextBased())
            return { updated: false, skipped: true };

        const msg = await channel.messages
            .fetch(season.signups_message_id)
            .catch(() => null);
        if (!msg) return { updated: false, skipped: true };

        const signups = await this.signups.listBySeason(season.id);

        const lines = signups.length
            ? signups.map(
                  (s, i) =>
                      `**${i + 1}.** <@${s.discord_user_id}> — **${
                          s.avg_3dart
                      }**avg`
              )
            : ["_No signups yet._"];

        const embed = new EmbedBuilder()
            .setTitle("📝 Current Signups")
            .setDescription(
                `**${season.name}**\n\n${lines.join("\n")}`.slice(0, 4000)
            )
            .setFooter({ text: `Total: ${signups.length}` })
            .setTimestamp();

        await msg.edit({ content: "", embeds: [embed] });

        return { updated: true, skipped: false, count: signups.length };
    }
}
