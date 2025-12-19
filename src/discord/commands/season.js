import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

export const data = new SlashCommandBuilder()
    .setName("season")
    .setDescription("Season admin commands")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((s) =>
        s
            .setName("create")
            .setDescription("Create a new season (draft)")
            .addStringOption((o) =>
                o
                    .setName("name")
                    .setDescription("Season name")
                    .setRequired(true)
            )
    )
    .addSubcommand((s) =>
        s
            .setName("signups-open")
            .setDescription("Open signups for the current season")
            .addStringOption((o) =>
                o
                    .setName("close_at")
                    .setDescription(
                        "Optional close time (ISO e.g. 2025-12-27T18:00:00Z)"
                    )
                    .setRequired(false)
            )
    )
    .addSubcommand((s) =>
        s
            .setName("signups-close")
            .setDescription("Close signups for the current season")
    );

export async function execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "create") {
        const name = interaction.options.getString("name", true);

        const season = await interaction.client.services.seasons.createSeason({
            guildId: interaction.guildId,
            name,
        });

        return interaction.reply(
            `✅ Created season **${season.name}** (status: \`${season.status}\`, id: \`${season.id}\`)`
        );
    }

    if (sub === "signups-open") {
        const closeAtStr = interaction.options.getString("close_at", false);

        let closeAt = null;
        if (closeAtStr) {
            const d = new Date(closeAtStr);
            if (Number.isNaN(d.getTime())) {
                return interaction.reply({
                    content:
                        "❌ Invalid close_at. Use ISO like `2025-12-27T18:00:00Z`",
                    ephemeral: true,
                });
            }
            closeAt = d.toISOString();
        }

        const season = await interaction.client.services.seasons.openSignups({
            guildId: interaction.guildId,
            closeAt, // ISO string or null
        });

        return interaction.reply(
            `📬 Signups are now **OPEN** for **${season.name}**` +
                (season.signups_close_at
                    ? `\n⏳ Auto-close: <t:${Math.floor(
                          new Date(season.signups_close_at).getTime() / 1000
                      )}:F>`
                    : "")
        );
    }

    if (sub === "signups-close") {
        const season = await interaction.client.services.seasons.closeSignups({
            guildId: interaction.guildId,
        });

        return interaction.reply(
            `🔒 Signups are now **CLOSED** for **${season.name}**`
        );
    }
}
