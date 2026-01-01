import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    MessageFlags,
} from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

/**
 * Discord slash command: /signups
 * Admin-only command group for managing signup displays.
 * Subcommands: list, publish
 * @module commands/signups
 */

export const data = new SlashCommandBuilder()
    .setName("signups")
    .setDescription("Admin signup tools")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((s) =>
        s.setName("list").setDescription("List signups for the current season")
    )
    .addSubcommand((s) =>
        s
            .setName("publish")
            .setDescription(
                "Publish/refresh the signup list message in this channel"
            )
    );

/**
 * Execute the /signups command.
 * Routes to appropriate subcommand: list signups or publish/refresh signup list in channel.
 * @param {Object} interaction - Discord ChatInputCommandInteraction object.
 * @returns {Promise<void>}
 * @throws {DomainError} If no season or publish fails.
 */
export async function execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === "publish") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const { season } =
                await interaction.client.services.signupsPublisher.publish({
                    client: interaction.client,
                    guildId: interaction.guildId,
                    channelId: interaction.channelId,
                });

            await interaction.editReply(
                `✅ Published signups for **${season.name}** in this channel.`
            );
        } catch (err) {
            if (err instanceof DomainError) {
                await interaction.editReply(`❌ ${err.message}`);
                return;
            }
            console.error(err);
            await interaction.editReply("❌ Something went wrong.");
        }
        return;
    }

    if (sub !== "list") return;

    const season = await interaction.client.repos.seasons.getCurrentForGuild(
        interaction.guildId
    );
    if (!season)
        return interaction.reply({
            content: "❌ No season found.",
            flags: MessageFlags.Ephemeral,
        });

    const signups = await interaction.client.repos.signups.listBySeason(
        season.id
    );

    const lines = signups.length
        ? signups
              .map(
                  (s, i) =>
                      `**${i + 1}.** <@${s.discord_user_id}> — **${
                          s.avg_3dart
                      }**`
              )
              .join("\n")
        : "_No signups yet._";

    const embed = new EmbedBuilder()
        .setTitle("📋 Signups")
        .setDescription(`**${season.name}**\n\n${lines}`)
        .setFooter({ text: `Total: ${signups.length}` })
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}
