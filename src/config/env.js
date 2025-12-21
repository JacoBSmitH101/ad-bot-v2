import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
    DISCORD_TOKEN: z.string().min(1),
    DISCORD_CLIENT_ID: z.string().min(1),
    GUILD_ID: z.string().min(1),

    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

    SUPABASE_DB_SCHEMA: z.string().optional(),
    RESULTS_REVIEW_CHANNEL: z.string().optional(),
    ADMIN_USER_ID: z.string().optional(),
    INTERNAL_API_KEY: z.string().min(1),
    INTERNAL_API_BASE_URL: z.string().min(1),
    // optional for later
    ADMIN_ROLE_ID: z.string().optional(),
    ADMIN_USER_IDS: z.string().optional(), // comma-separated
    TZ: z.string().optional(),
});

export const env = EnvSchema.parse(process.env);

export const adminUserIds = new Set(
    (env.ADMIN_USER_IDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
);
//testing CICD azure devops pipelines
