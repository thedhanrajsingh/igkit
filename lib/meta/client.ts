import { getMetaGraphApiVersion, requireEnv } from "@/lib/env";

function instagramGraphBase() {
  return `https://graph.instagram.com/${getMetaGraphApiVersion()}`;
}

export class MetaApiError extends Error {
  constructor(
    public code: number,
    public subcode: number | undefined,
    public fbTraceId: string | undefined,
    message: string
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

export class TokenExpiredError extends MetaApiError {
  constructor(message: string, fbTraceId?: string) {
    super(190, undefined, fbTraceId, message);
    this.name = "TokenExpiredError";
  }
}

export class RateLimitError extends MetaApiError {
  constructor(message: string, fbTraceId?: string) {
    super(368, undefined, fbTraceId, message);
    this.name = "RateLimitError";
  }
}

export class PermissionError extends MetaApiError {
  constructor(message: string, fbTraceId?: string) {
    super(100, undefined, fbTraceId, message);
    this.name = "PermissionError";
  }
}

interface GraphApiError {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

export interface InstagramUser {
  id: string;
  // Professional account ID: this, not the app-scoped `id`, is webhook entry.id.
  user_id?: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
  // Point-in-time only; history comes from FollowerSnapshot.
  followers_count?: number;
}

export interface InstagramComment {
  id: string;
  text: string;
  from?: {
    id: string;
    username?: string;
  };
  timestamp: string;
  // Present when queried with replies{from}, to detect an owner reply.
  replies?: {
    data?: { id: string; from?: { id: string; username?: string } }[];
  };
}

export interface InstagramMedia {
  id: string;
  caption?: string;
  media_type: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  timestamp: string;
  permalink?: string;
  like_count?: number;
  comments_count?: number;
}

export interface InstagramMediaInsights {
  views?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  saved?: number;
  shares?: number;
  total_interactions?: number;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

async function handleResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok || (data as GraphApiError).error) {
    const err = (data as GraphApiError).error;
    const code = err?.code ?? response.status;
    const subcode = err?.error_subcode;
    const traceId = err?.fbtrace_id;
    // The path attributes otherwise identical errors; the query is dropped
    // because it carries the access token.
    let path = "";
    try {
      path = ` (${new URL(response.url).pathname})`;
    } catch {}
    const message = `${err?.message ?? "Unknown Meta API error"}${path} [code=${code} sub=${subcode ?? "-"} type=${err?.type ?? "-"} trace=${traceId ?? "-"}]`;

    switch (code) {
      case 190:
        throw new TokenExpiredError(message, traceId);
      case 368:
      case 4:
      case 17:
        throw new RateLimitError(message, traceId);
      case 10:
      case 100:
      case 200:
        throw new PermissionError(message, traceId);
      default:
        throw new MetaApiError(code, subcode, traceId, message);
    }
  }

  return data as T;
}

type SendResult = { recipient_id: string; message_id: string };

async function postGraph<T>(accessToken: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${instagramGraphBase()}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  return handleResponse(response);
}

// Meta caps button template text at 640 chars and button titles at 20.
function buttonTemplate(text: string, buttons: unknown[]) {
  return {
    attachment: {
      type: "template",
      payload: { template_type: "button", text: text.slice(0, 640), buttons },
    },
  };
}

function postbackButton(title: string, payload: string) {
  return [{ type: "postback", title: title.slice(0, 20), payload }];
}

export async function sendPrivateReply(
  accessToken: string,
  instagramAccountId: string,
  commentId: string,
  message: string
): Promise<SendResult> {
  return postGraph(accessToken, `${instagramAccountId}/messages`, {
    recipient: { comment_id: commentId },
    message: { text: message },
  });
}

// Tapping the button fires a `messaging_postbacks` webhook carrying `payload`,
// which delivers the follow-up ("reveal") message.
export async function sendPrivateReplyWithButton(
  accessToken: string,
  instagramAccountId: string,
  commentId: string,
  text: string,
  buttonTitle: string,
  payload: string
): Promise<SendResult> {
  return postGraph(accessToken, `${instagramAccountId}/messages`, {
    recipient: { comment_id: commentId },
    message: buttonTemplate(text, postbackButton(buttonTitle, payload)),
  });
}

export async function sendDirectMessageWithButton(
  accessToken: string,
  instagramAccountId: string,
  userId: string,
  text: string,
  buttonTitle: string,
  payload: string
): Promise<SendResult> {
  return postGraph(accessToken, `${instagramAccountId}/messages`, {
    recipient: { id: userId },
    message: buttonTemplate(text, postbackButton(buttonTitle, payload)),
  });
}

// Only available for users in an active conversation. Returns null when Meta
// omits the field, so callers decide how to treat the unverifiable case.
export async function getUserFollowStatus(
  accessToken: string,
  recipientId: string
): Promise<boolean | null> {
  const url = new URL(`${instagramGraphBase()}/${recipientId}`);
  url.searchParams.set("fields", "is_user_follow_business");

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data?.is_user_follow_business === "boolean"
      ? data.is_user_follow_business
      : null;
  } catch {
    return null;
  }
}

export interface LinkButton {
  title: string;
  url: string;
}

// Instagram's button template supports at most 3 buttons.
function toWebUrlButtons(buttons: LinkButton[]) {
  return buttons
    .slice(0, 3)
    .map((b) => ({ type: "web_url", url: b.url, title: b.title.slice(0, 20) }));
}

export async function sendPrivateReplyWithLinkButton(
  accessToken: string,
  instagramAccountId: string,
  commentId: string,
  text: string,
  buttons: LinkButton[]
): Promise<SendResult> {
  return postGraph(accessToken, `${instagramAccountId}/messages`, {
    recipient: { comment_id: commentId },
    message: buttonTemplate(text, toWebUrlButtons(buttons)),
  });
}

export async function sendDirectMessage(
  accessToken: string,
  instagramAccountId: string,
  userId: string,
  message: string
): Promise<SendResult> {
  return postGraph(accessToken, `${instagramAccountId}/messages`, {
    recipient: { id: userId },
    message: { text: message },
  });
}

export async function sendDirectMessageWithLinkButton(
  accessToken: string,
  instagramAccountId: string,
  userId: string,
  text: string,
  buttons: LinkButton[]
): Promise<SendResult> {
  return postGraph(accessToken, `${instagramAccountId}/messages`, {
    recipient: { id: userId },
    message: buttonTemplate(text, toWebUrlButtons(buttons)),
  });
}

export async function sendCommentReply(
  accessToken: string,
  commentId: string,
  message: string
): Promise<{ id: string }> {
  return postGraph(accessToken, `${commentId}/replies`, { message });
}

// Newest first; stops paging once past `sinceMs` so a viral post's backlog is
// never pulled. Comments hidden by Hidden Words may not be returned at all.
export async function getRecentMediaComments(
  accessToken: string,
  mediaId: string,
  sinceMs: number,
  max = 800
): Promise<InstagramComment[]> {
  const results: InstagramComment[] = [];

  const first = new URL(`${instagramGraphBase()}/${mediaId}/comments`);
  first.searchParams.set("fields", "id,text,timestamp,from,replies{from}");
  first.searchParams.set("order", "reverse_chronological");
  first.searchParams.set("limit", "50");
  first.searchParams.set("access_token", accessToken);

  let nextUrl: string | null = first.toString();

  while (nextUrl !== null && results.length < max) {
    const response: Response = await fetch(nextUrl);
    const page = await handleResponse<{
      data: InstagramComment[];
      paging?: { next?: string };
    }>(response);
    const data = page.data ?? [];
    results.push(...data);

    const oldest = data[data.length - 1];
    if (oldest?.timestamp && Date.parse(oldest.timestamp) < sinceMs) break;
    nextUrl = page.paging?.next ?? null;
  }

  return results
    .filter((c) => !c.timestamp || Date.parse(c.timestamp) >= sinceMs)
    .slice(0, max);
}

export interface InstagramParticipant {
  id: string;
  username?: string;
}

export interface InstagramMessage {
  id: string;
  created_time?: string;
  message?: string;
  from?: InstagramParticipant;
  to?: { data: InstagramParticipant[] };
}

export interface InstagramConversation {
  id: string;
  detailsUnavailable?: boolean;
  updated_time?: string;
  participants?: { data: InstagramParticipant[] };
  messages?: { data: InstagramMessage[] };
}

// One broken field expansion makes Meta reject the whole page with code 1
// (upstream #60): halve failing pages to isolate it, keep its basic metadata.
export async function getConversations(
  accessToken: string,
  igUserId: string
): Promise<InstagramConversation[]> {
  const fields =
    "participants,updated_time,messages.limit(1){message,from,created_time}";
  type Page = {
    data?: InstagramConversation[];
    paging?: { next?: string; cursors?: { after?: string } };
  };
  const results: InstagramConversation[] = [];
  const seenIds = new Set<string>();
  const seenCursors = new Set<string>();
  let after: string | undefined;
  let pageSize = 50;

  async function readPage(limit: number, requestedFields: string): Promise<Page> {
    // Never follow Meta's next URL: rebuild on our trusted host. A
    // messages.paging cursor must never advance this list.
    const url = new URL(`${instagramGraphBase()}/${igUserId}/conversations`);
    url.searchParams.set("platform", "instagram");
    url.searchParams.set("fields", requestedFields);
    url.searchParams.set("limit", String(limit));
    if (after) url.searchParams.set("after", after);
    return handleResponse<Page>(
      await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      })
    );
  }

  // Also bound cursor traversal in case Meta repeats data with changing cursors.
  for (let pages = 0; pages < 100 && results.length < 50; pages++) {
    let limit = Math.min(pageSize, 50 - results.length);
    let page: Page;
    let unavailable = false;
    while (true) {
      try {
        page = await readPage(limit, fields);
        break;
      } catch (error) {
        if (!(error instanceof MetaApiError) || error.code !== 1) throw error;
        if (limit > 1) {
          limit = Math.max(1, Math.floor(limit / 2));
          continue;
        }
        // id,updated_time succeeds in the reported case; if even that fails,
        // propagate rather than skip unknown data.
        page = await readPage(1, "id,updated_time");
        unavailable = true;
        console.warn("[Conversations] Detail expansion unavailable", {
          code: error.code,
          subcode: error.subcode,
          trace: error.fbTraceId,
        });
        break;
      }
    }

    const rows = page.data ?? [];
    for (const row of rows) {
      if (seenIds.has(row.id)) continue;
      seenIds.add(row.id);
      results.push(unavailable ? { ...row, detailsUnavailable: true } : row);
      if (results.length === 50) return results;
    }
    if (!page.paging?.next || rows.length === 0) return results;
    const nextAfter = page.paging.cursors?.after;
    if (!nextAfter || seenCursors.has(nextAfter)) {
      throw new Error("Instagram conversation pagination did not advance");
    }
    seenCursors.add(nextAfter);
    after = nextAfter;
    // Stay small around failures, grow back after successful expansions.
    pageSize = unavailable ? 1 : Math.min(50, limit * 2);
  }
  throw new Error("Instagram conversation pagination exceeded its safety limit");
}

// Meta only returns full details for the 20 most recent messages.
export async function getConversationMessages(
  accessToken: string,
  conversationId: string
): Promise<InstagramMessage[]> {
  const url = new URL(`${instagramGraphBase()}/${conversationId}`);
  url.searchParams.set("fields", "messages{id,created_time,from,to,message}");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<{ messages?: { data: InstagramMessage[] } }>(
    response
  );
  return data.messages?.data ?? [];
}

export async function getUserInfo(accessToken: string): Promise<InstagramUser> {
  const url = new URL(`${instagramGraphBase()}/me`);
  url.searchParams.set(
    "fields",
    "id,user_id,username,name,profile_picture_url,followers_count"
  );
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  return handleResponse<InstagramUser>(response);
}

const MEDIA_FIELDS =
  "id,caption,media_type,media_product_type,media_url,thumbnail_url,timestamp,permalink,like_count,comments_count";

// Instagram caps a single media page at 100 items.
const MEDIA_PAGE_SIZE = 100;

export async function getUserMedia(
  accessToken: string,
  limit = 25
): Promise<InstagramMedia[]> {
  const url = new URL(`${instagramGraphBase()}/me/media`);
  url.searchParams.set("fields", MEDIA_FIELDS);
  url.searchParams.set("limit", limit.toString());
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<{ data: InstagramMedia[] }>(response);
  return data.data;
}

// `max` is a safety ceiling so huge accounts (and per-media insight calls) stay bounded.
export async function getAllUserMedia(
  accessToken: string,
  max = 500
): Promise<InstagramMedia[]> {
  const results: InstagramMedia[] = [];

  const first = new URL(`${instagramGraphBase()}/me/media`);
  first.searchParams.set("fields", MEDIA_FIELDS);
  first.searchParams.set("limit", String(Math.min(MEDIA_PAGE_SIZE, max)));
  first.searchParams.set("access_token", accessToken);

  let nextUrl: string | null = first.toString();

  while (nextUrl !== null && results.length < max) {
    const response: Response = await fetch(nextUrl);
    const page = await handleResponse<{
      data: InstagramMedia[];
      paging?: { next?: string };
    }>(response);
    results.push(...page.data);
    nextUrl = page.paging?.next ?? null;
  }

  return results.slice(0, max);
}

// Accounts connected before the insights scope throw PermissionError. Metric
// validity varies by media type, so pass only metrics that apply.
export async function getMediaInsights(
  accessToken: string,
  mediaId: string,
  metrics: string[]
): Promise<InstagramMediaInsights> {
  const url = new URL(`${instagramGraphBase()}/${mediaId}/insights`);
  url.searchParams.set("metric", metrics.join(","));
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<{
    data: Array<{ name: string; values: Array<{ value: number }> }>;
  }>(response);

  const result: InstagramMediaInsights = {};
  for (const entry of data.data) {
    result[entry.name as keyof InstagramMediaInsights] =
      entry.values?.[0]?.value ?? 0;
  }
  return result;
}

// One day of net follower change.
export interface FollowerCountPoint {
  date: string; // YYYY-MM-DD
  delta: number;
}

// Instagram rejects account insight windows wider than 30 days.
const FOLLOWER_INSIGHT_MAX_DAYS = 30;

// Daily deltas, not totals. Omitted for accounts under 100 followers and some
// account types, so null means "no series", not an error.
export async function getFollowerCountSeries(
  accessToken: string,
  instagramAccountId: string,
  days: number = FOLLOWER_INSIGHT_MAX_DAYS
): Promise<FollowerCountPoint[] | null> {
  const span = Math.min(Math.max(days, 1), FOLLOWER_INSIGHT_MAX_DAYS);
  const until = Math.floor(Date.now() / 1000);
  const since = until - (span - 1) * 86_400;

  const url = new URL(`${instagramGraphBase()}/${instagramAccountId}/insights`);
  url.searchParams.set("metric", "follower_count");
  url.searchParams.set("period", "day");
  url.searchParams.set("since", String(since));
  url.searchParams.set("until", String(until));
  url.searchParams.set("access_token", accessToken);

  try {
    const response = await fetch(url.toString());
    const data = await handleResponse<{
      data: Array<{
        name: string;
        values: Array<{ value: number; end_time?: string }>;
      }>;
    }>(response);

    const metric = data.data.find((d) => d.name === "follower_count");
    if (!metric?.values?.length) return null;

    return metric.values.map((v) => ({
      date: (v.end_time ?? new Date().toISOString()).slice(0, 10),
      delta: v.value ?? 0,
    }));
  } catch (err) {
    // A missing permission is worth surfacing; anything else means the metric
    // is unavailable for this account.
    if (err instanceof PermissionError) throw err;
    console.warn(
      "[Instagram] follower_count insights unavailable:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

async function tokenRequest(
  path: string,
  params: Record<string, string>
): Promise<{ accessToken: string; expiresIn: number }> {
  const url = new URL(`${instagramGraphBase()}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const data = await handleResponse<TokenResponse>(await fetch(url.toString()));
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 5184000,
  };
}

export async function getLongLivedToken(shortLivedToken: string) {
  return tokenRequest("access_token", {
    grant_type: "ig_exchange_token",
    client_secret: requireEnv("INSTAGRAM_APP_SECRET"),
    access_token: shortLivedToken,
  });
}

export async function refreshLongLivedToken(longLivedToken: string) {
  return tokenRequest("refresh_access_token", {
    grant_type: "ig_refresh_token",
    access_token: longLivedToken,
  });
}

export async function subscribeInstagramAccountToWebhooks(
  instagramAccountId: string,
  accessToken: string
): Promise<{ success: boolean }> {
  return postGraph(accessToken, `${instagramAccountId}/subscribed_apps`, {
    subscribed_fields: ["comments", "messages"],
  });
}
