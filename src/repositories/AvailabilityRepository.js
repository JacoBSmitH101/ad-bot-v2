import { DomainError } from '../utils/DomainError.js';

export class AvailabilityRepository {
    constructor({ supabase, schema }) { this.db = supabase.schema(schema); }
    check(result) {
        if (result.error) {
            if (['PGRST202', '42P01'].includes(result.error.code)) throw new DomainError('AVAILABILITY_SCHEMA', 'Availability needs its database migration. Ask an admin to run the supplied SQL.');
            throw new DomainError('AVAILABILITY', result.error.message);
        }
        return result.data;
    }
    async rpc(name, args = {}) { return this.check(await this.db.rpc('league_availability_' + name, args)); }
    async release(guildId, seasonId, week) { return await this.rpc('release', { p_guild: guildId, p_season: String(seasonId), p_week: week }) ?? []; }
    async get(matchId) { return this.check(await this.db.from('league_availability').select('*').eq('match_id', String(matchId)).maybeSingle()); }
    async list(guildId, seasonId, week, userId = null) {
        let query = this.db.from('league_availability').select('*').eq('guild_id', guildId).eq('season_id', String(seasonId)).eq('week', week);
        if (userId) query = query.or(`player_a_id.eq.${userId},player_b_id.eq.${userId}`);
        return this.check(await query.order('match_id')) ?? [];
    }
    async act(matchId, actorId, action, payload = {}, admin = false) {
        const data = await this.rpc('act', { p_match: String(matchId), p_actor: actorId, p_action: action, p_payload: payload, p_admin: admin });
        return Array.isArray(data) ? data[0] : data;
    }
    async claim(matchId, userId, token, force) {
        return (await this.rpc('claim', { p_match: String(matchId), p_user: userId, p_token: token, p_force: force }))?.[0] ?? null;
    }
    async finish(matchId, userId, token, version, message, error = null) {
        await this.rpc('finish', { p_match: String(matchId), p_user: userId, p_token: token, p_version: version,
            p_channel: message?.channelId ?? null, p_message: message?.id ?? null, p_error: error });
    }
    async messages(ids) {
        if (!ids.length) return [];
        return this.check(await this.db.from('league_availability_messages').select('*').in('match_id', ids)) ?? [];
    }
    async activeExtensions(ids) {
        if (!ids.length) return [];
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        return this.check(await this.db.from('league_availability').select('match_id,player_a_id,player_b_id,effective_due_on')
            .in('match_id', ids.map(String)).eq('extension_status', 'approved').gte('effective_due_on', today)) ?? [];
    }
    async history(matchId) { return this.check(await this.db.from('league_availability_events').select('actor_id,action,detail,created_at').eq('match_id', String(matchId)).order('id', { ascending: false }).limit(20)) ?? []; }
    async reviewedNotice(matchId, version) { this.check(await this.db.from('league_availability').update({ review_notice_version: version }).eq('match_id', String(matchId)).eq('request_version', version)); }
    async reminder(matchId, userId, token, done = false) { return (await this.rpc('remind', { p_match: String(matchId), p_user: userId, p_token: token, p_done: done }))?.[0] ?? null; }
    async work() { return await this.rpc('work') ?? []; }
}
