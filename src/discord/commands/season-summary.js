import { AttachmentBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { DomainError } from '../../utils/DomainError.js';
import { buildSeasonSummary } from '../../utils/buildSeasonSummary.js';
import { renderSeasonSummaryImage } from '../../services/SeasonSummaryImageRenderer.js';

export const data = new SlashCommandBuilder()
    .setName('season-summary')
    .setDescription('[ADMIN] Generate a season honours and division-movement graphic')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addStringOption(option => option.setName('season-id')
        .setDescription('Season ID (defaults to the latest active or completed season)'))
    .addBooleanOption(option => option.setName('publish')
        .setDescription('Post in this channel; defaults to a private preview'));

export async function execute(interaction) {
    const cfg = interaction.client.services.config;
    const permitted = (cfg.adminUserId && interaction.user.id === cfg.adminUserId)
        || (cfg.adminRoleId && interaction.member?.roles?.cache?.has(cfg.adminRoleId))
        || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    if (!permitted) {
        await interaction.reply({ content: "You don't have permission to use this command.", flags: MessageFlags.Ephemeral });
        return;
    }
    const publish = interaction.options.getBoolean('publish') ?? false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const seasons = interaction.client.repos.seasons;
        const id = interaction.options.getString('season-id')?.trim();
        const season = id ? await seasons.getById(id)
            : await seasons.getLatestStandingsSeasonForGuild(interaction.guildId);
        if (!season || String(season.guild_id) !== String(interaction.guildId)) {
            throw new DomainError('NO_SEASON', 'No matching active or completed season was found in this server.');
        }
        const result = await interaction.client.services.standings.getStandingsForSeason({ season });
        const summary = buildSeasonSummary(result);
        const png = await renderSeasonSummaryImage(summary);
        const file = new AttachmentBuilder(png, {
            name: 'season-summary.png',
            description: `${season.name}: division winners, promotions and division moves${summary.provisional ? ' (provisional)' : ''}`,
        });
        const message = {
            content: summary.provisional ? 'Provisional season summary — based on confirmed results so far.' : 'Congratulations to our division champions and promoted players. Thank you to everyone who took part!',
            files: [file],
            allowedMentions: { parse: [] },
        };
        if (publish) {
            if (!interaction.channel?.isTextBased()) throw new DomainError('BAD_CHANNEL', 'Use this command in a text channel.');
            await interaction.channel.send(message);
            await interaction.editReply('Season graphic posted in this channel.');
        } else {
            await interaction.editReply(message);
        }
    } catch (error) {
        console.error('Failed to generate season summary:', error);
        await interaction.editReply(error instanceof DomainError ? error.message : 'The season graphic could not be generated. Please check the bot logs.');
    }
}
