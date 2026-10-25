import { createHash, randomUUID } from 'node:crypto';
import { DomainError } from '../utils/DomainError.js';
import { liveAvailabilityMessage, availabilitySide, displayDate } from '../discord/handlers/availabilityViews.js';

export class AvailabilityService {
    constructor({ availability, seasons, matches, players, enabled = false, reviewChannelId = null }) {
        Object.assign(this, { availability, seasons, matches, players, enabled, reviewChannelId });
        this.queues = new Map(); this.working = false;
    }
    requireEnabled() { if (!this.enabled) throw new DomainError('AVAILABILITY_DISABLED', 'Availability is not enabled yet. Ask an admin.'); }
    async context(matchId, userId = null, admin = false, guildId = null) {
        this.requireEnabled();
        const state = await this.availability.get(matchId);
        if (!state) throw new DomainError('NO_AVAILABILITY', 'This match has not been released for availability.');
        if (guildId && state.guild_id !== guildId) throw new DomainError('WRONG_SERVER', 'This match belongs to another server.');
        if (!admin && userId && !availabilitySide(state, userId)) throw new DomainError('NOT_PARTICIPANT', 'This is not your match.');
        const [match, season, people] = await Promise.all([this.matches.getById(matchId), this.seasons.getById(state.season_id),
            this.players.listByDiscordIds({ discordUserIds: [state.player_a_id, state.player_b_id] })]);
        if (!match || !season || String(season.guild_id) !== state.guild_id || String(match.season_id) !== state.season_id ||
            match.player_a_id !== state.player_a_id || match.player_b_id !== state.player_b_id) {
            throw new DomainError('FIXTURE_CHANGED', 'This fixture has changed. Ask an admin to release availability again.');
        }
        return { state, match, season, names: new Map(people.map(person => [person.discord_user_id, person.display_name]).filter(([, name]) => name)) };
    }
    async releaseWeek({ client, guildId, week }) {
        if (!this.enabled) return { skipped: true, message: '' };
        const season = await this.seasons.getCurrentForGuild(guildId);
        if (!season || season.status !== 'active') return { skipped: true, message: 'Availability DMs will start once the season is active and fixtures are published.' };
        const states = await this.availability.release(guildId, season.id, week);
        let failures = 0;
        for (const state of states) {
            try { failures += (await this.syncMatch(client, state.match_id)).failures; }
            catch (error) { failures++; console.error('Availability delivery failed:', state.match_id, error.message); }
        }
        return { released: states.length, failures, message: `Availability: ${states.length} match(es) released.` +
            (failures ? ` ${failures} delivery problem(s); check /availability-admin. Players can use /availability instead.` : '') };
    }
    async act({ client, matchId, userId, action, payload = {}, admin = false, guildId = null }) {
        const before = await this.context(matchId, userId, admin, guildId);
        if (admin && !guildId) throw new DomainError('ADMIN_SERVER', 'Use the admin command in the server.');
        const updated = await this.availability.act(matchId, userId, action, payload, admin);
        if (updated.effective_due_on !== before.state.effective_due_on) {
            try { await client.services.fixturesPublisher?.refresh({ client, guildId: updated.guild_id }); }
            catch (error) { console.error('Extra time saved; fixture display refresh failed:', error.message); }
        }
        // Replies are already committed even if Discord cannot refresh a DM.
        try { await this.syncMatch(client, matchId); } catch (error) { console.error('Saved availability; DM refresh pending:', error.message); }
        return this.context(matchId, userId, admin, guildId);
    }
    syncMatch(client, matchId, force = false, options = {}) {
        const prior = this.queues.get(String(matchId)) ?? Promise.resolve();
        const task = prior.catch(() => {}).then(() => this._sync(client, matchId, force, options));
        this.queues.set(String(matchId), task);
        void task.finally(() => { if (this.queues.get(String(matchId)) === task) this.queues.delete(String(matchId)); }).catch(() => {});
        return task;
    }
    async _sync(client, matchId, force, { recipients = null, failedOnly = false } = {}) {
        const context = await this.context(matchId);
        if (context.season.status !== 'active' || context.match.status !== 'scheduled') return { failures: 0 };
        let failures = 0, attempted = 0;
        const deliveries = failedOnly ? await this.availability.messages([String(matchId)]) : [];
        for (const userId of [context.state.player_a_id, context.state.player_b_id]) {
            if (String(userId).startsWith('FAKE_') || (recipients && !recipients.includes(userId))) continue;
            if (failedOnly) {
                if (deliveries.some(delivery => delivery.user_id === userId && delivery.status === 'sent')) continue;
                await this.availability.expedite(matchId, userId);
            }
            const token = randomUUID();
            const delivery = await this.availability.claim(matchId, userId, token, failedOnly ? false : force);
            if (!delivery) continue;
            // Another worker may have recovered this delivery after our status
            // read. Preserve its saved version and leave its Discord card alone.
            if (failedOnly && delivery.status === 'sent') {
                await this.availability.finish(matchId, userId, token, delivery.sent_version,
                    { id: delivery.message_id, channelId: delivery.channel_id });
                continue;
            }
            attempted++;
            let message = null;
            try {
                if (delivery.message_id && delivery.channel_id) {
                    try {
                        const channel = await client.channels.fetch(delivery.channel_id);
                        message = await channel.messages.fetch(delivery.message_id);
                    } catch (error) { if (![10003, 10008].includes(Number(error.code))) throw error; }
                }
                const payload = liveAvailabilityMessage(context, userId);
                if (message) message = await message.edit(payload);
                else {
                    const user = await client.users.fetch(userId);
                    const nonce = createHash('sha256').update(`${matchId}:${userId}:${delivery.message_id ?? 'first'}`).digest('hex').slice(0, 24);
                    message = await user.send({ ...payload, nonce, enforceNonce: true });
                }
                await this.availability.finish(matchId, userId, token, context.state.version, message);
            } catch (error) {
                failures++;
                await this.availability.finish(matchId, userId, token, context.state.version, message, String(error.code ?? 'DELIVERY_FAILED'));
                console.warn('Availability DM needs retry:', matchId, userId, error.code ?? error.message);
            }
        }
        if (!failedOnly) {
            await this.notifyReview(client, context.state);
            await this.remindPlayers(client, context.state);
        }
        return { failures, attempted };
    }
    async remindPlayers(client, state) {
        for (const userId of [state.player_a_id, state.player_b_id]) {
            if (String(userId).startsWith('FAKE_')) continue;
            const token = randomUUID();
            const delivery = await this.availability.reminder(state.match_id, userId, token);
            if (!delivery) continue;
            try {
                const user = await client.users.fetch(userId);
                await user.send({ content: 'Reminder: can you play your Week ' + state.week + ' league match? Please answer in your match card, or use /availability in the server. Play by ' + displayDate(state.effective_due_on) + '.',
                    reply: { messageReference: delivery.message_id, failIfNotExists: false },
                    nonce: createHash('sha256').update('reminder:' + state.match_id + ':' + userId).digest('hex').slice(0, 24), enforceNonce: true, allowedMentions: { parse: [] } });
                await this.availability.reminder(state.match_id, userId, token, true);
            } catch (error) { console.warn('Availability reminder will retry:', state.match_id, userId, error.code ?? error.message); }
        }
    }
    async notifyReview(client, state) {
        if (state.extension_status !== 'review' || state.review_notice_version >= state.request_version) return;
        if (!this.reviewChannelId) { await this.availability.reviewedNotice(state.match_id, state.request_version); return; }
        try {
            const channel = await client.channels.fetch(this.reviewChannelId);
            if (!channel?.isTextBased() || String(channel.guildId ?? channel.guild?.id) !== state.guild_id) return;
            await channel.send({ content: `**Extra time needs review — Week ${state.week}**\n<@${state.player_a_id}> vs <@${state.player_b_id}>\nCurrent date: ${displayDate(state.effective_due_on)}\nRequested date: ${displayDate(state.extension_proposed_on)}\nMatch: \`${state.match_id}\`\nUse /availability-admin to approve or keep the current date.`,
                nonce: createHash('sha256').update(`review:${state.match_id}:${state.request_version}`).digest('hex').slice(0, 24), enforceNonce: true, allowedMentions: { parse: [] } });
            await this.availability.reviewedNotice(state.match_id, state.request_version);
        } catch (error) { console.error('Availability admin notice failed:', error.message); }
    }
    async retryPending(client) {
        if (!this.enabled || this.working) return;
        this.working = true;
        try {
            for (const item of await this.availability.work()) {
                try { await this.syncMatch(client, item.match_id); } catch (error) { console.error('Availability retry failed:', item.match_id, error.message); }
            }
        } finally { this.working = false; }
    }
}

/** Called only by explicit fixture-release commands, never result refreshes. */
export async function triggerAvailability(client, guildId, week) {
    if (!client.services.availability?.enabled) return '';
    try { return (await client.services.availability.releaseWeek({ client, guildId, week })).message; }
    catch (error) {
        console.error('Fixtures updated but availability release failed:', error.message);
        return 'Fixtures were updated, but availability could not be released: ' + error.message + ' Retry the same fixture command after fixing it; no deadline will be reset.';
    }
}
