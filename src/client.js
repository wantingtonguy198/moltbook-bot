// Minimal client for the Moltbook API (https://www.moltbook.com)
//
// SECURITY: the API key must only ever be sent to BASE_URL below.
// Do not make this configurable from untrusted input (env var is fine,
// since you control that) — never let a request argument override the host.

const BASE_URL = "https://www.moltbook.com/api/v1/";

export class MoltbookError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "MoltbookError";
    this.status = status;
    this.body = body;
  }
}

export class MoltbookClient {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error(
        "Missing Moltbook API key. Set MOLTBOOK_API_KEY in your .env file."
      );
    }
    this.apiKey = apiKey;
  }

  async _request(method, path, { query, body, auth = true } = {}) {
    const url = new URL(path, BASE_URL);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, v);
      }
    }

    const headers = { "Content-Type": "application/json" };
    if (auth) headers.Authorization = `Bearer ${this.apiKey}`;

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    let data;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (res.status === 429) {
      throw new MoltbookError(
        `Rate limited. Retry after ${data.retry_after_seconds ?? "?"}s`,
        { status: 429, body: data }
      );
    }
    if (!res.ok) {
      throw new MoltbookError(data.error || `Request failed: ${res.status}`, {
        status: res.status,
        body: data,
      });
    }
    return data;
  }

  // ---- Profile / status ----
  me() {
    return this._request("GET", "agents/me");
  }
  status() {
    return this._request("GET", "agents/status");
  }
  profile(name) {
    return this._request("GET", "agents/profile", { query: { name } });
  }
  updateProfile({ description, metadata } = {}) {
    return this._request("PATCH", "agents/me", {
      body: { description, metadata },
    });
  }
  home() {
    return this._request("GET", "home");
  }

  // ---- Posts ----
  createPost({ submolt, title, content, url, type }) {
    return this._request("POST", "posts", {
      body: { submolt_name: submolt, title, content, url, type },
    });
  }
  getFeed({ sort = "hot", limit = 25, cursor, filter } = {}) {
    return this._request("GET", "feed", {
      query: { sort, limit, cursor, filter },
    });
  }
  getPosts({ submolt, sort = "new", limit = 25, cursor } = {}) {
    return this._request("GET", "posts", {
      query: { submolt, sort, limit, cursor },
    });
  }
  getPost(postId) {
    return this._request("GET", `posts/${postId}`);
  }
  deletePost(postId) {
    return this._request("DELETE", `posts/${postId}`);
  }
  pinPost(postId) {
    return this._request("POST", `posts/${postId}/pin`);
  }
  unpinPost(postId) {
    return this._request("DELETE", `posts/${postId}/pin`);
  }

  // ---- Comments ----
  addComment(postId, content, parentId) {
    return this._request("POST", `posts/${postId}/comments`, {
      body: { content, parent_id: parentId },
    });
  }
  getComments(postId, { sort = "best", limit = 35, cursor, requesterId } = {}) {
    return this._request("GET", `posts/${postId}/comments`, {
      query: { sort, limit, cursor, requester_id: requesterId },
    });
  }

  // ---- Voting ----
  upvotePost(postId) {
    return this._request("POST", `posts/${postId}/upvote`);
  }
  downvotePost(postId) {
    return this._request("POST", `posts/${postId}/downvote`);
  }
  upvoteComment(commentId) {
    return this._request("POST", `comments/${commentId}/upvote`);
  }

  // ---- Submolts ----
  listSubmolts() {
    return this._request("GET", "submolts");
  }
  getSubmolt(name, requesterId) {
    return this._request("GET", `submolts/${name}`, {
      query: { requester_id: requesterId },
    });
  }
  createSubmolt({ name, displayName, description, allowCrypto = false }) {
    return this._request("POST", "submolts", {
      body: {
        name,
        display_name: displayName,
        description,
        allow_crypto: allowCrypto,
      },
    });
  }
  subscribe(name) {
    return this._request("POST", `submolts/${name}/subscribe`);
  }
  unsubscribe(name) {
    return this._request("DELETE", `submolts/${name}/subscribe`);
  }
  submoltFeed(name, { sort = "new" } = {}) {
    return this._request("GET", `submolts/${name}/feed`, { query: { sort } });
  }

  // ---- Follows ----
  follow(name) {
    return this._request("POST", `agents/${name}/follow`);
  }
  unfollow(name) {
    return this._request("DELETE", `agents/${name}/follow`);
  }

  // ---- Search ----
  search(q, { type = "all", limit = 20, cursor } = {}) {
    return this._request("GET", "search", {
      query: { q, type, limit, cursor },
    });
  }

  // ---- Verification challenges ----
  verify(verificationCode, answer) {
    return this._request("POST", "verify", {
      body: { verification_code: verificationCode, answer },
    });
  }

  // ---- Notifications ----
  markPostNotificationsRead(postId) {
    return this._request("POST", `notifications/read-by-post/${postId}`);
  }
  markAllNotificationsRead() {
    return this._request("POST", "notifications/read-all");
  }
}
