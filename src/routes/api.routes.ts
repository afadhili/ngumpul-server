import { Hono } from "hono";
import {
    completeAttachmentUpload,
    createAttachmentUpload,
    deleteAttachment,
    getAttachmentDownloadUrl,
    getAttachmentPreview,
    listConversationAttachments,
} from "../controllers/attachment.controller";
import {
    acceptFriendRequest,
    cancelFriendRequest,
    declineFriendRequest,
    listFriendRequests,
    listFriends,
    removeFriend,
    sendFriendRequest,
} from "../controllers/friend.controller";
import { checkUsernameAvailability, getProfile, searchUsers, updateProfile } from "../controllers/profile.controller";
import { getCurrentUser } from "../controllers/user.controller";
import {
    blockUser,
    getPrivacySettings,
    listBlockedUsers,
    reportUser,
    unblockUser,
    updatePrivacySettings,
} from "../controllers/account.controller";
import {
    addDirectMessageReaction,
    removeDirectMessageReaction,
} from "../controllers/reaction.controller";
import {
    deleteDirectMessage,
    editDirectMessage,
    listDirectMessages,
    markDirectMessageReceipt,
    sendDirectMessage,
} from "../controllers/direct-message.controller";
import { exportBackup, restoreBackup } from "../controllers/backup.controller";
import { listConversations, getConversationPreferenceHandler, updateConversationPreference } from "../controllers/conversation.controller";
import { deleteDraft, listDrafts, saveDraft } from "../controllers/draft.controller";
import { forwardMessage } from "../controllers/forward.controller";
import { claimFriendQr, createFriendQr, previewFriendQr } from "../controllers/friend-qr.controller";
import {
    clearReadNotifications,
    deleteNotification,
    getUnreadNotificationCount,
    listNotifications,
    markAllNotificationsRead,
    markNotificationRead,
} from "../controllers/notification.controller";
import { listDirectPins, pinDirectMessage, unpinDirectMessage } from "../controllers/pin.controller";
import { closePoll, getPoll, retractPollVote, voteOnPoll } from "../controllers/poll.controller";
import { getUserPresence, listFriendPresence, updateMyPresence } from "../controllers/presence.controller";
import { getChannelReadState, updateChannelReadState } from "../controllers/read-state.controller";
import {
    cancelScheduledMessage,
    createScheduledMessage,
    listScheduledMessages,
    updateScheduledMessage,
} from "../controllers/scheduled-message.controller";
import { searchChannelMessages, searchDirectMessages } from "../controllers/search.controller";
import { listTranslationLanguages, translateMessage } from "../controllers/translation.controller";
import { getMyPreferences, updateMyPreferences } from "../controllers/user-preference.controller";

const apiRoutes = new Hono();
apiRoutes.get("/me", getCurrentUser);
apiRoutes.get("/profile", getProfile);
apiRoutes.get("/profile/username-availability", checkUsernameAvailability);
apiRoutes.put("/profile", updateProfile);
apiRoutes.get("/users/search", searchUsers);
apiRoutes.get("/blocks", listBlockedUsers);
apiRoutes.post("/users/:userId/block", blockUser);
apiRoutes.delete("/users/:userId/block", unblockUser);
apiRoutes.post("/users/:userId/reports", reportUser);
apiRoutes.get("/privacy", getPrivacySettings);
apiRoutes.put("/privacy", updatePrivacySettings);
apiRoutes.get("/friends", listFriends);
apiRoutes.get("/friends/requests", listFriendRequests);
apiRoutes.post("/friends/requests", sendFriendRequest);
apiRoutes.post("/friends/requests/:requestId/accept", acceptFriendRequest);
apiRoutes.post("/friends/requests/:requestId/decline", declineFriendRequest);
apiRoutes.post("/friends/requests/:requestId/cancel", cancelFriendRequest);
apiRoutes.get("/friends/qr", createFriendQr);
apiRoutes.get("/friends/qr/:code", previewFriendQr);
apiRoutes.post("/friends/qr/claim", claimFriendQr);
apiRoutes.delete("/friends/:userId", removeFriend);
apiRoutes.get("/direct-messages/:peerId", listDirectMessages);
apiRoutes.post("/direct-messages/:peerId", sendDirectMessage);
apiRoutes.patch("/direct-messages/:messageId", editDirectMessage);
apiRoutes.delete("/direct-messages/:messageId", deleteDirectMessage);
apiRoutes.post("/direct-messages/:messageId/receipts", markDirectMessageReceipt);
apiRoutes.post("/direct-messages/:messageId/reactions", addDirectMessageReaction);
apiRoutes.delete("/direct-messages/:messageId/reactions/:emoji", removeDirectMessageReaction);
apiRoutes.get("/direct-messages/:peerId/pins", listDirectPins);
apiRoutes.post("/direct-messages/:messageId/pin", pinDirectMessage);
apiRoutes.delete("/direct-messages/:messageId/pin", unpinDirectMessage);
apiRoutes.get("/messages/search", searchDirectMessages);
apiRoutes.get("/messages/search/channels", searchChannelMessages);
apiRoutes.post("/messages/:messageId/forward", forwardMessage);
apiRoutes.get("/polls/:pollId", getPoll);
apiRoutes.post("/polls/:pollId/votes", voteOnPoll);
apiRoutes.delete("/polls/:pollId/votes", retractPollVote);
apiRoutes.post("/polls/:pollId/close", closePoll);
apiRoutes.get("/channels/:channelId/read-state", getChannelReadState);
apiRoutes.put("/channels/:channelId/read-state", updateChannelReadState);
apiRoutes.get("/conversations", listConversations);
apiRoutes.get("/conversations/:scope/:targetId", getConversationPreferenceHandler);
apiRoutes.patch("/conversations/:scope/:targetId", updateConversationPreference);
apiRoutes.get("/drafts", listDrafts);
apiRoutes.put("/drafts/:scope/:targetId", saveDraft);
apiRoutes.delete("/drafts/:scope/:targetId", deleteDraft);
apiRoutes.get("/scheduled-messages", listScheduledMessages);
apiRoutes.post("/scheduled-messages", createScheduledMessage);
apiRoutes.patch("/scheduled-messages/:scheduledMessageId", updateScheduledMessage);
apiRoutes.delete("/scheduled-messages/:scheduledMessageId", cancelScheduledMessage);
apiRoutes.get("/notifications", listNotifications);
apiRoutes.get("/notifications/unread-count", getUnreadNotificationCount);
apiRoutes.post("/notifications/read-all", markAllNotificationsRead);
apiRoutes.delete("/notifications/read", clearReadNotifications);
apiRoutes.post("/notifications/:notificationId/read", markNotificationRead);
apiRoutes.delete("/notifications/:notificationId", deleteNotification);
apiRoutes.get("/presence", listFriendPresence);
apiRoutes.get("/presence/:userId", getUserPresence);
apiRoutes.put("/presence", updateMyPresence);
apiRoutes.get("/preferences", getMyPreferences);
apiRoutes.put("/preferences", updateMyPreferences);
apiRoutes.get("/backup", exportBackup);
apiRoutes.post("/backup/restore", restoreBackup);
apiRoutes.get("/translations/languages", listTranslationLanguages);
apiRoutes.post("/translations", translateMessage);
apiRoutes.get("/attachments", listConversationAttachments);
apiRoutes.post("/attachments/uploads", createAttachmentUpload);
apiRoutes.post("/attachments/:attachmentId/complete", completeAttachmentUpload);
apiRoutes.get("/attachments/:attachmentId/download-url", getAttachmentDownloadUrl);
apiRoutes.get("/attachments/:attachmentId/preview", getAttachmentPreview);
apiRoutes.delete("/attachments/:attachmentId", deleteAttachment);

export { apiRoutes };
