// src/services/InternalApiClient.js
import { DomainError } from "../utils/DomainError.js";

export class InternalApiClient {
    constructor({ baseUrl, internalKey, timeoutMs = 8000 }) {
        this.baseUrl = baseUrl?.replace(/\/+$/, "");
        this.internalKey = internalKey;
        this.timeoutMs = timeoutMs;
        if (!this.baseUrl) throw new Error("INTERNAL_API_BASE_URL missing");
        if (!this.internalKey) throw new Error("INTERNAL_API_KEY missing");
    }

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

    // Health (no internal key required, but we can still send it)
    async health() {
        const res = await fetch(`${this.baseUrl}/health`).then((r) => r.json());
        return res;
    }

    // Autodarts status/admin
    async getAutodartsStatus() {
        //add some console logs here as this isnt working
        // console.log("Fetching Autodarts status from Internal API");
        // console.log(`Base URL: ${this.baseUrl}`);
        // console.log("FULL URL:", `${this.baseUrl}/autodarts/status`);
        return this.#request("GET", "/autodarts/status");
    }

    async refreshAutodarts() {
        return this.#request("POST", "/autodarts/refresh");
    }

    async setRefreshToken(refreshToken) {
        return this.#request("POST", "/autodarts/token", {
            jsonBody: { refreshToken },
        });
    }

    async getJobs() {
        return this.#request("GET", "/jobs");
    }

    async retryJobs() {
        return this.#request("POST", "/jobs/retry");
    }

    // Match stats
    async getMatchStats(matchId) {
        return this.#request("GET", `/matches/${matchId}/stats`);
    }
}
