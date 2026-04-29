import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import { DomainError } from "../../utils/DomainError.js";

export const data = new SlashCommandBuilder()
    .setName("substitute")
    .setDescription("Substitute one player for another (admin)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addUserOption((o) =>
        o
            .setName("out")
            .setDescription("Player leaving / being replaced")
            .setRequired(true)
    )
    .addUserOption((o) =>
        o
            .setName("in")
            .setDescription("Player joining / substituting in")
            .setRequired(true)
    )
    .addStringOption((o) =>
        o
            .setName("division")
            .setDescription("Division name (e.g. Div 1). If omitted, will auto-detect from the outgoing player.")
            .setRequired(false)
    )
    .addStringOption((o) =>
        o
            .setName("mode")
            .setDescription("How to apply the substitution")
            .addChoices(
                { name: "full_replace (no confirmed matches)", value: "full_replace" },
                { name: "future_only (keep confirmed; swap future matches)", value: "future_only" }
            )
            .setRequired(false)
    )
    .addIntegerOption((o) =>
        o
            .setName("effective_week")
            .setDescription("Required for future_only: week number when the substitute takes over")
            .setRequired(false)
    )
    .addStringOption((o) =>
        o
            .setName("note")
            .setDescription("Optional note for the audit log")
            .setRequired(false)
    );

export async function execute(interaction) {
    const outUser = interaction.options.getUser("out", true);
    const inUser = interaction.options.getUser("in", true);
    const divisionName = interaction.options.getString("division");
    const mode = interaction.options.getString("mode") ?? "full_replace";
    const effectiveWeek = interaction.options.getInteger("effective_week");
    const note = interaction.options.getString("note");

    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const res = await interaction.client.services.substitutions.substitute({
            guildId: interaction.guildId,
            divisionName: divisionName ?? null,
            outDiscordUserId: outUser.id,
            inDiscordUserId: inUser.id,
            mode: mode === "future_only" ? "future_only" : "full_replace",
            effectiveWeek: effectiveWeek ?? null,
            createdBy: interaction.user.id,
            note: note ?? null,
        });

        // Best-effort refresh of published standings so the UI reflects changes immediately.
        await interaction.client.services.standingsPublisher
            ?.refresh({ client: interaction.client, guildId: interaction.guildId })
            .catch(() => {});

        const extra =
            res.substitution.mode === "future_only"
                ? `\nEffective week: **${res.substitution.effective_week}**`
                : "";

        await interaction.editReply({
            content:
                `✅ Substitution recorded.\n` +
                `Division: **${res.division?.name ?? divisionName ?? "?"}**\n` +
                `Out: <@${outUser.id}>\n` +
                `In: <@${inUser.id}>\n` +
                `Mode: **${res.substitution.mode}**${extra}\n` +
                `Updated matches: **${res.updatedMatches}**`,
        });
    } catch (err) {
        if (err instanceof DomainError) {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: `❌ ${err.message}` });
            } else {
                await interaction.reply({
                    content: `❌ ${err.message}`,
                    flags: MessageFlags.Ephemeral,
                });
            }
            return;
        }
        console.error(err);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: "❌ Something went wrong." });
        } else {
            await interaction.reply({
                content: "❌ Something went wrong.",
                flags: MessageFlags.Ephemeral,
            });
        }
    }
}

