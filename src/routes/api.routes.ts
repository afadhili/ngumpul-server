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
import { getProfile, searchUsers, updateProfile } from "../controllers/profile.controller";
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
    deleteDirectMessage,
    editDirectMessage,
    listDirectMessages,
    markDirectMessageReceipt,
    sendDirectMessage,
} from "../controllers/direct-message.controller";

const apiRoutes = new Hono();
apiRoutes.get("/me", getCurrentUser);
apiRoutes.get("/profile", getProfile);
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
apiRoutes.delete("/friends/:userId", removeFriend);
apiRoutes.get("/direct-messages/:peerId", listDirectMessages);
apiRoutes.post("/direct-messages/:peerId", sendDirectMessage);
apiRoutes.patch("/direct-messages/:messageId", editDirectMessage);
apiRoutes.delete("/direct-messages/:messageId", deleteDirectMessage);
apiRoutes.post("/direct-messages/:messageId/receipts", markDirectMessageReceipt);
apiRoutes.get("/attachments", listConversationAttachments);
apiRoutes.post("/attachments/uploads", createAttachmentUpload);
apiRoutes.post("/attachments/:attachmentId/complete", completeAttachmentUpload);
apiRoutes.get("/attachments/:attachmentId/download-url", getAttachmentDownloadUrl);
apiRoutes.get("/attachments/:attachmentId/preview", getAttachmentPreview);
apiRoutes.delete("/attachments/:attachmentId", deleteAttachment);

export { apiRoutes };
