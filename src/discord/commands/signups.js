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
    )
    .addSubcommand((s) =>
        s
            .setName("assign-role")
            .setDescription(
                "Assign a role to all players signed up (signups must be closed)"
            )
            .addStringOption((o) =>
                o
                    .setName("role_id")
                    .setDescription("Role ID to assign (or role mention)")
                    .setRequired(true)
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

    if (sub === "assign-role") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const roleInput = interaction.options.getString("role_id", true);
        const roleIdMatch = roleInput.match(/\d{5,}/);
        const roleId = roleIdMatch?.[0] ?? null;

        if (!roleId) {
            await interaction.editReply(
                "❌ Invalid role ID. Provide a role ID or role mention."
            );
            return;
        }

        const season = await interaction.client.repos.seasons.getCurrentForGuild(
            interaction.guildId
        );
        if (!season) {
            await interaction.editReply("❌ No season found.");
            return;
        }

        if (season.status !== "signups_closed") {
            await interaction.editReply(
                `❌ Signups must be closed to run this command (current: ${season.status}).`
            );
            return;
        }

        const role = await interaction.guild.roles
            .fetch(roleId)
            .catch(() => null);
        if (!role) {
            await interaction.editReply("❌ Role not found in this server.");
            return;
        }

        if (!role.editable) {
            await interaction.editReply(
                "❌ I don't have permission to assign that role (role is higher than my highest role or managed)."
            );
            return;
        }

        const signups = await interaction.client.repos.signups.listBySeason(
            season.id
        );

        if (signups.length === 0) {
            await interaction.editReply("⚠️ No signups found for this season.");
            return;
        }

        let assigned = 0;
        let alreadyHad = 0;
        let missingMembers = 0;
        let failed = 0;

        for (const signup of signups) {
            try {
                const member = await interaction.guild.members.fetch(
                    signup.discord_user_id
                );
                if (!member) {
                    missingMembers += 1;
                    continue;
                }

                if (member.roles.cache.has(role.id)) {
                    alreadyHad += 1;
                    continue;
                }

                await member.roles.add(
                    role.id,
                    `Season signup role assignment for ${season.name}`
                );
                assigned += 1;
            } catch (err) {
                console.warn(
                    `Failed to assign role to ${signup.discord_user_id}:`,
                    err?.message ?? err
                );
                failed += 1;
            }
        }

        await interaction.editReply(
            `✅ Assigned <@&${role.id}> for **${season.name}**.\n` +
                `• Assigned: **${assigned}**\n` +
                `• Already had role: **${alreadyHad}**\n` +
                `• Not in server: **${missingMembers}**\n` +
                `• Failed: **${failed}**`
        );
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
