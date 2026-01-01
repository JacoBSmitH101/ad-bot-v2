import { DomainError } from "../utils/DomainError.js";

/**
 * Client for making requests to the internal API.
 * Handles authentication, timeouts, and error handling.
 */
export class InternalApiClient {
    /**
     * @param {{ baseUrl: string, internalKey: string, timeoutMs: number }} params
     * @param {string} params.baseUrl Base URL of the internal API.
     * @param {string} params.internalKey Internal API key for authentication.
     * @param {number} [params.timeoutMs=8000] Request timeout in milliseconds.
     */
    constructor({ baseUrl, internalKey, timeoutMs = 8000 }) {
        this.baseUrl = baseUrl?.replace(/\/+$/, "");
        this.internalKey = internalKey;
        this.timeoutMs = timeoutMs;
        if (!this.baseUrl) throw new Error("INTERNAL_API_BASE_URL missing");
        if (!this.internalKey) throw new Error("INTERNAL_API_KEY missing");
    }

    /**
     * Make an authenticated request to the internal API.
     * @private
     * @param {string} method HTTP method.
     * @param {string} path API path.
     * @param {{ jsonBody: (Object|null) }} [options]
     * @returns {Promise<Object>}
     * @throws {DomainError} If request fails or times out.
     */
    async #request(method, path, { jsonBody = null } = {}) {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const res = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers: {
                    "X-Internal-Key": this.internalKey,
                    ...(jsonBody ? { "Content-Type": "application/json" } : {}),
                },
                body: jsonBody ? JSON.stringify(jsonBody) : null,
                signal: controller.signal,
            });

            const text = await res.text();
            let payload = null;
            try {
                payload = text ? JSON.parse(text) : null;
            } catch {
                payload = { raw: text };
            }

            if (!res.ok) {
                // never include internalKey in errors
                const msg =
                    payload?.error ||
                    payload?.message ||
                    `Internal API error ${res.status}`;
                throw new DomainError("INTERNAL_API_ERROR", msg);
            }

            return payload;
        } catch (e) {
            if (e.name === "AbortError") {
                throw new DomainError(
                    "INTERNAL_API_TIMEOUT",
                    "Internal API timed out."
                );
            }
            throw e;
        } finally {
            clearTimeout(t);
        }
    }

    /**
     * Check API health status.
     * @returns {Promise<Object>}
     */
    async health() {
        const res = await fetch(`${this.baseUrl}/health`).then((r) => r.json());
        return res;
    }

    /**
     * Get Autodarts connection status.
     * @returns {Promise<Object>}
     */
    async getAutodartsStatus() {
        //add some console logs here as this isnt working
        // console.log("Fetching Autodarts status from Internal API");
        // console.log(`Base URL: ${this.baseUrl}`);
        // console.log("FULL URL:", `${this.baseUrl}/autodarts/status`);
        return this.#request("GET", "/autodarts/status");
    }

    /**
     * Refresh Autodarts connection.
     * @returns {Promise<Object>}
     */
    async refreshAutodarts() {
        return this.#request("POST", "/autodarts/refresh");
    }

    /**
     * Set Autodarts refresh token.
     * @param {string} refreshToken
     * @returns {Promise<Object>}
     */
    async setRefreshToken(refreshToken) {
        return this.#request("POST", "/autodarts/token", {
            jsonBody: { refreshToken },
        });
    }

    /**
     * Get job queue status.
     * @returns {Promise<Object>}
     */
    async getJobs() {
        return this.#request("GET", "/jobs");
    }

    /**
     * Retry failed jobs.
     * @returns {Promise<Object>}
     */
    async retryJobs() {
        return this.#request("POST", "/jobs/retry");
    }

    /**
     * Get match statistics from Autodarts.
     * @param {string} matchId Autodarts match ID.
     * @returns {Promise<Object>}
     */
    async getMatchStats(matchId) {
        return this.#request("GET", `/matches/${matchId}/stats`);
    }
}
