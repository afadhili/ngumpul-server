import { sql } from "drizzle-orm";
import { profile, user } from "../db/schema/auth";

export const accountAvatar = sql<string | null>`coalesce(nullif(${profile.avatar}, ''), nullif(${user.image}, ''))`;
