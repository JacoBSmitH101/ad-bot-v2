import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { createAvailabilityDemo, availabilityDemoMessage, discardAvailabilityDemo } from '../handlers/availabilityDemo.js';

export const data = new SlashCommandBuilder()
    .setName('availability-test')
    .setDescription('Try the match availability buttons in your DMs')
    .setDMPermission(false)
    .addStringOption(option => option.setName('screen').setDescription('Which example would you like to try?')
        .addChoices({ name: 'Weekly availability', value: 'availability' },
            { name: 'Extra-time request from your opponent', value: 'extension' }));

export async function execute(interaction) {
    if (!interaction.guildId) {
        await interaction.reply({ content: 'Run /availability-test in the server to receive your sample DM.', flags: MessageFlags.Ephemeral });
        return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let state;
    let sent = false;
    try {
        const requested = interaction.options.getString('screen');
        state = createAvailabilityDemo(interaction.user.id, requested === 'extension' ? 'extension' : 'availability', { playerPreview: true });
        const message = await interaction.user.send(availabilityDemoMessage(state));
        state.messageId = message.id;
        sent = true;
        await interaction.editReply('Sent a sample match to your DMs. Try the buttons as you would during the season. Player2’s example reply appears after you answer.');
    } catch (error) {
        if (!sent && state) discardAvailabilityDemo(state.id);
        console.error('Could not send availability demo:', error);
        await interaction.editReply(sent ? 'The demo was sent to your DMs, but the acknowledgement failed.' :
            Number(error.code) === 50007 ? 'I couldn’t DM you. Allow direct messages from this server, then run /availability-test again.' :
                'The demo could not be sent. No league data was changed. Check the bot logs.');
    }
}
