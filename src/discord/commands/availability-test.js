import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { createAvailabilityDemo, availabilityDemoMessage, discardAvailabilityDemo } from '../handlers/availabilityDemo.js';

export const data = new SlashCommandBuilder()
    .setName('availability-test')
    .setDescription('[ADMIN] DM yourself an interactive availability demo with sample data')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addStringOption(option => option.setName('screen').setDescription('Which sample to show first')
        .addChoices({ name: 'Weekly availability', value: 'availability' },
            { name: 'Extension request', value: 'extension' }, { name: 'Admin review', value: 'admin' }));

export async function execute(interaction) {
    const cfg = interaction.client.services.config;
    const permitted = interaction.guildId && (
        (cfg.adminUserId && interaction.user.id === cfg.adminUserId) ||
        (cfg.adminRoleId && interaction.member?.roles?.cache?.has(cfg.adminRoleId)) ||
        interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
    if (!permitted) {
        await interaction.reply({ content: 'Only league/server admins can run this test in the server.', flags: MessageFlags.Ephemeral });
        return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let state;
    let sent = false;
    try {
        state = createAvailabilityDemo(interaction.user.id, interaction.options.getString('screen') ?? 'availability');
        const message = await interaction.user.send(availabilityDemoMessage(state));
        state.messageId = message.id;
        sent = true;
        await interaction.editReply('Sent a sample to your DMs. Try the buttons and “Simulate opponent reply”. All actions are demo-only; the session lasts one hour or until the bot restarts.');
    } catch (error) {
        if (!sent && state) discardAvailabilityDemo(state.id);
        console.error('Could not send availability demo:', error);
        await interaction.editReply(sent ? 'The demo was sent to your DMs, but the acknowledgement failed.' :
            Number(error.code) === 50007 ? 'I couldn’t DM you. Allow direct messages from this server, then run /availability-test again.' :
                'The demo could not be sent. No league data was changed. Check the bot logs.');
    }
}
