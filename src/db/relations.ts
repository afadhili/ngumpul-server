import { defineRelations } from "drizzle-orm";
import * as attachmentSchema from "./schema/attachment";
import * as authSchema from "./schema/auth";
import * as communitySchema from "./schema/community";
import * as directMessageSchema from "./schema/direct-message";

const schema = { ...attachmentSchema, ...authSchema, ...communitySchema, ...directMessageSchema };

export const relations = defineRelations(schema, r => ({
    user: {
        sessions: r.many.session(),
        accounts: r.many.account(),
        profile: r.one.profile(),
    },
    account: {
        user: r.one.user({
            from: r.account.userId,
            to: r.user.id,
        }),
    },
    session: {
        user: r.one.user({
            from: r.session.userId,
            to: r.user.id,
        }),
    },
    profile: {
        user: r.one.user({
            from: r.profile.userId,
            to: r.user.id,
        }),
    },
}));
