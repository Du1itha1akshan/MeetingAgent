import { graphFetch } from "./auth";
import { getAssistantAccessToken } from "./assistantAuth";

export interface MeetingChatInfo {
  chatId: string; // "19:meeting_...@thread.v2"
  organizerId: string | null; // needed to join the meeting's call (graph/calls.ts)
}

/**
 * A meeting's chat id (chatInfo.threadId) and organizer, looked up by join URL
 * under the calendar owner (the assistant), the same way resolveOnlineMeetingId
 * does. Uses the normal app-only token, like the rest of the pipeline.
 */
export async function getMeetingChatInfo(userId: string, joinUrl: string): Promise<MeetingChatInfo | null> {
  const params = new URLSearchParams({
    $filter: `JoinWebUrl eq '${joinUrl}'`,
    $select: "id,chatInfo,participants",
  });
  const data = await graphFetch<{
    value: {
      chatInfo?: { threadId?: string };
      participants?: { organizer?: { identity?: { user?: { id?: string } } } };
    }[];
  }>(`/users/${encodeURIComponent(userId)}/onlineMeetings?${params.toString()}`);

  const meeting = data.value[0];
  const chatId = meeting?.chatInfo?.threadId;
  if (!chatId) return null;
  return { chatId, organizerId: meeting.participants?.organizer?.identity?.user?.id ?? null };
}

/**
 * Posts an HTML message to a chat as the JRC Meeting Assistant, using the
 * assistant's *delegated* token (graph/assistantAuth.ts), not the app-only one.
 * Deliberately a plain post: no createdDateTime / from, which would make Graph
 * treat it as a migration import. Returns the new message's id and the sender's
 * user id (the assistant), which tells the assistant's own messages apart later.
 */
export async function postChatMessage(
  chatId: string,
  htmlContent: string
): Promise<{ id: string; fromUserId: string | null }> {
  const token = await getAssistantAccessToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0/chats/${chatId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ body: { contentType: "html", content: htmlContent } }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Graph POST /chats/{id}/messages failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const message = (await res.json()) as { id: string; from?: { user?: { id?: string } } };
  return { id: message.id, fromUserId: message.from?.user?.id ?? null };
}

export interface ChatMessageSummary {
  id: string;
  createdDateTime: string;
  messageType: string; // "message" for people's messages; system events have other types
  fromUserId: string | null;
  fromName: string | null;
  content: string; // HTML or text, as Graph returns it
}

/**
 * The most recent messages in a chat (newest first, up to 50), read with the
 * app-only token: the app's Chat.ReadWrite.All application permission already
 * covers reading chat messages, the same access graph/recordings.ts uses.
 */
export async function listRecentChatMessages(chatId: string): Promise<ChatMessageSummary[]> {
  const params = new URLSearchParams({ $top: "50", $orderby: "createdDateTime desc" });
  const data = await graphFetch<{
    value: {
      id: string;
      createdDateTime: string;
      messageType: string;
      from?: { user?: { id?: string; displayName?: string } } | null;
      body?: { content?: string };
    }[];
  }>(`/chats/${chatId}/messages?${params.toString()}`);

  return data.value.map((m) => ({
    id: m.id,
    createdDateTime: m.createdDateTime,
    messageType: m.messageType,
    fromUserId: m.from?.user?.id ?? null,
    fromName: m.from?.user?.displayName ?? null,
    content: m.body?.content ?? "",
  }));
}
