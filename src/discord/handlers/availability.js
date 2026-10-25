import { MessageFlags } from 'discord.js';
import { AVAILABILITY_PREFIX, liveAvailabilityForm, liveAvailabilityMessage } from './availabilityViews.js';

export async function handleAvailability(interaction) {
    if (!(interaction.isButton() || interaction.isModalSubmit()) || !interaction.customId?.startsWith(AVAILABILITY_PREFIX)) return false;
    const [, matchId, action, version] = interaction.customId.split(':');
    const service = interaction.client.services.availability;
    try {
        if (interaction.isButton() && ['available', 'days', 'unavailable'].includes(action)) {
            const context = await service.context(matchId, interaction.user.id);
            if (context.season.status !== 'active' || context.match.status !== 'scheduled') throw new Error('Availability is closed for this match.');
            await interaction.showModal(liveAvailabilityForm(context, interaction.user.id, action !== 'unavailable'));
            return true;
        }
        if (action === 'ask' && interaction.isButton()) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const context = await service.context(matchId, interaction.user.id);
            await interaction.editReply(liveAvailabilityMessage(context, interaction.user.id, { confirmation: true }));
            return true;
        }
        await interaction.deferUpdate();
        let mutation = action, payload = { requestVersion: Number(version) };
        if (interaction.isModalSubmit()) {
            if (!['submit-yes', 'submit-no'].includes(action)) throw new Error('Unknown availability form.');
            mutation = action === 'submit-yes' ? 'available' : 'unavailable';
            const fields = [...interaction.fields.fields.values()];
            payload = { note: interaction.fields.getTextInputValue('note'), days: fields.filter(field => field.type === 22 && /^days-\d+$/.test(field.customId)).flatMap(field => field.values ?? []) };
        } else if (!['request', 'agree', 'decline', 'help'].includes(action)) throw new Error('Unknown availability option.');
        const context = await service.act({ client: interaction.client, matchId, userId: interaction.user.id, action: mutation, payload });
        await interaction.editReply(liveAvailabilityMessage(context, interaction.user.id));
    } catch (error) {
        console.error('Availability interaction failed:', error.message);
        const message = { content: error.message || 'Availability could not update. Try /availability in the server.', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
        if (interaction.deferred || interaction.replied) await interaction.followUp(message).catch(() => {});
        else await interaction.reply(message).catch(() => {});
    }
    return true;
}
