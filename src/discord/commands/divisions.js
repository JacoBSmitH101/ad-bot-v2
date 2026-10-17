import { renderDivisionProposalImages } from '../../services/DivisionProposalImageRenderer.js';
import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder, AttachmentBuilder, MessageFlags,
} from "discord.js";

/**
 * Discord slash command: /divisions
 * Admin-only command group for managing divisions.
 * Subcommands: create, assign-auto
 * @module commands/divisions
 */

export const data = new SlashCommandBuilder()
    .setName("divisions")
    .setDescription("Division admin commands")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((s) =>
        s
            .setName("create")
            .setDescription("Create divisions (signups must be closed)")
            .addIntegerOption((o) =>
                o
                    .setName("count")
                    .setDescription("Number of divisions")
                    .setRequired(true)
            )
    )
    .addSubcommand((s) =>
        s
            .setName("assign-auto")
            .setDescription(
                "Save proposed division assignments, honouring earned places"
            )
    )
    .addSubcommand((s) =>
        s
            .setName("assign-manual")
            .setDescription("Manually assign specific players to a division")
            .addStringOption((o) =>
                o
                    .setName("division")
                    .setDescription('Division name (e.g. "Div 1" or "1")')
                    .setRequired(true)
            )
            .addStringOption((o) =>
                o
                    .setName("players")
                    .setDescription(
                        "Paste @mentions or user IDs separated by spaces/commas/newlines"
                    )
                    .setRequired(true)
            )
    )
    .addSubcommand((s) =>
        s
            .setName("preview-auto")
            .setDescription(
                "Generate a proposed division-split graphic (signups can be open)"
            )
            .addIntegerOption((o) =>
                o
                    .setName("count")
                    .setDescription("Number of divisions to preview")
                    .setRequired(true)
            )
            .addBooleanOption(o => o.setName("publish").setDescription("Post the proposal here; defaults to a private preview"))
    );

/**
 * Execute the /divisions command.
 * Routes to appropriate subcommand handler: create divisions or auto-assign players.
 * @param {Object} interaction - Discord ChatInputCommandInteraction object.
 * @returns {Promise<void>}
 */
export async function execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "create") {
        const count = interaction.options.getInteger("count", true);
        const { season, divisions } =
            await interaction.client.services.divisions.createDivisions({
                guildId: interaction.guildId,
                count,
            });

        const embed = new EmbedBuilder()
            .setTitle("✅ Divisions Created")
            .setDescription(divisions.map((d) => `• **${d.name}**`).join("\n"))
            .setFooter({ text: season.name })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }

    if (sub === "assign-auto") {
        const { season, divisions, counts } =
            await interaction.client.services.divisions.assignAuto({
                guildId: interaction.guildId,
            });

        const embed = new EmbedBuilder()
            .setTitle("🎯 Players Assigned")
            .setDescription(
                divisions
                    .map((d, i) => `• **${d.name}** — **${counts[i]}** players`)
                    .join("\n")
            )
            .setFooter({ text: season.name })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }

    if (sub === "assign-manual") {
        const divisionName = interaction.options.getString("division", true);
        const playersRaw = interaction.options.getString("players", true);

        const ids = parseDiscordUserIds(playersRaw);

        const { season, division, count } =
            await interaction.client.services.divisions.assignManual({
                guildId: interaction.guildId,
                divisionName,
                discordUserIds: ids,
            });

        const preview = ids
            .slice(0, 25)
            .map((id) => `<@${id}>`)
            .join(", ");
        const suffix = ids.length > 25 ? ` …(+${ids.length - 25} more)` : "";

        const embed = new EmbedBuilder()
            .setTitle("✍️ Manual Assignment Saved")
            .setDescription(
                `**${division.name}**\n\nAssigned **${count}** player(s):\n${preview}${suffix}`
            )
            .setFooter({ text: season.name })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }

    if (sub === "preview-auto") {
        const count = interaction.options.getInteger('count', true);
        const publish = interaction.options.getBoolean('publish') ?? false;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const proposal = await interaction.client.services.divisions.previewAuto({ guildId: interaction.guildId, count });
        const variants = [{ ...proposal, key: 'balanced', title: 'Option 1 · Balanced split' },
            ...(proposal.alternatives ?? []).map(plan => ({ ...plan, season: proposal.season,
                divisions: proposal.divisions, playerCount: proposal.playerCount,
                key: 'history', title: 'Option 2 · Last season honoured' }))];
        const ids = proposal.groups.flat().map(player => player.discord_user_id);
        const savedNames = await interaction.client.repos.players.listByDiscordIds({ discordUserIds: ids });
        const names = new Map(savedNames.map(player => [player.discord_user_id, player.display_name]));
        for (const player of variants.flatMap(plan => plan.groups.flat())) {
            const member = interaction.guild?.members?.cache?.get(player.discord_user_id);
            const user = interaction.client.users?.cache?.get(player.discord_user_id);
            player.name = member?.displayName || names.get(player.discord_user_id) || user?.globalName || user?.username || player.discord_user_id;
        }
        const files = [], summaries = [], details = [proposal.season.name + ' — division options'];
        let needsReview = false;
        for (const plan of variants) {
            const pngs = await renderDivisionProposalImages(plan);
            files.push(...pngs.map((png, i) => new AttachmentBuilder(png, { name: 'division-proposal-' + plan.key + '-' + (i + 1) + '.png' })));
            const stats = plan.stats;
            const summary = '**' + plan.title + ': ' + plan.counts.join(' / ') + '**\n' +
                stats.promotions + ' promotions honoured · ' + stats.kept + ' returning players staying · ' + stats.moved + ' proposed moves.';
            summaries.push(summary);
            const review = [...plan.conflicts, ...plan.warnings];
            needsReview ||= review.length > 0;
            details.push('', summary.replaceAll('**', ''),
                ...plan.groups.flatMap((group, i) => [plan.divisions[i].name + ' — ' + group.length + ' players (target ' + plan.targetSizes[i] + ')',
                    ...group.map(player => player.name + ' | ' + Number(player.avg_3dart).toFixed(1) + ' avg | ' + player.proposal.detail + (player.proposal.review ? ' REVIEW: large average mismatch.' : '')), '']),
                'Review notes', ...review);
        }
        details.push('', 'No divisions or assignments have been saved. Automatic assignment continues to use Option 1.');
        files.push(new AttachmentBuilder(Buffer.from(details.join('\n')), { name: 'division-proposal-notes.txt' }));
        const content = summaries.join('\n\n') + (needsReview ? '\n\nPlayer-by-player explanations and review notes are attached.' : '');
        for (let i = 0; i < files.length; i += 10) {
            const message = { content: i === 0 ? content : 'Division proposal continued.', files: files.slice(i, i + 10), allowedMentions: { parse: [] } };
            if (publish) await interaction.channel.send(message);
            else if (i === 0) await interaction.editReply(message);
            else await interaction.followUp({ ...message, flags: MessageFlags.Ephemeral });
        }
        if (publish) await interaction.editReply('Division proposal posted in this channel. No assignments have been saved.');
    }
}

function parseDiscordUserIds(input) {
    const text = String(input ?? "");
    const ids = [];

    // Matches <@123>, <@!123>, or raw numeric IDs
    const mentionRe = /<@!?(\d+)>/g;
    let m;
    while ((m = mentionRe.exec(text))) ids.push(m[1]);

    // Also accept bare IDs in the text
    const bareRe = /\b(\d{15,25})\b/g;
    while ((m = bareRe.exec(text))) ids.push(m[1]);

    return Array.from(new Set(ids));
}
