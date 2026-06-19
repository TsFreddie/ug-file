import { UgosApiError, UgosHttpError } from "./errors.js";
import { md5Hex, rsaEncryptBase64 } from "./crypto.js";
import type {
  ConflictAction,
  DownloadTokenResponse,
  GenericResponse,
  ListDirRequest,
  LoginResponse,
  ReadFileEncoding,
  SessionContainer,
  UgreenLinkNodeInfo,
  UgosDirent,
  UgosFileEntry,
  UgosListDirResponse,
  UgosRoot,
  UgosClientConfig,
  UploadFileOptions
} from "./types.js";
import { UrlBuilder } from "./url-builder.js";

const DEFAULT_LIST_DIR_REQUEST: ListDirRequest = {
  limit: 2000,
  page: 1,
  is_shield_recycle: false,
  data_type: 0,
  left_no_page_show: false,
  left_count: 5000,
  sort_type: 1,
  reverse: false,
  permission: 4,
  root_type: 3
};

const UGREENLINK_NODE_INFO_URL = "https://api.ugnas.com/api/p2p/v2/ta/nodeInfo/byAlias";

export class UgosClient {
  private readonly config: UgosClientConfig;
  private urls?: UrlBuilder;
  private urlsPromise?: Promise<UrlBuilder>;
  private readonly fetchImpl: typeof fetch;
  private session?: SessionContainer;

  /**
   * Creates a new UGOS client instance.
   *
   * @param config - Client configuration. Provide either a direct `url` or a
   *   UGREENlink `uglinkid` for automatic URL resolution.
   * @throws If no `fetch` implementation is available (Node <18 without polyfill).
   *
   * @example Direct URL
   * ```ts
   * const client = new UgosClient({
   *   url: "https://example.ugnas.com",
   *   username: "admin",
   *   password: "secret"
   * });
   * ```
   *
   * @example UGREENlink ID
   * ```ts
   * const client = new UgosClient({
   *   uglinkid: "myalias",
   *   username: "admin",
   *   password: "secret"
   * });
   * ```
   */
  constructor(config: UgosClientConfig) {
    this.config = config;
    if ("url" in config) {
      this.urls = new UrlBuilder(config.url);
    }
    this.fetchImpl = config.fetch ?? globalThis.fetch;

    if (!this.fetchImpl) {
      throw new Error("A fetch implementation is required. Use Node 18+ or pass config.fetch.");
    }
  }

  /**
   * Resolves a UGREENlink alias to the corresponding base URL.
   *
   * Queries the UGREENlink public API (`api.ugnas.com`) to look up the
   * relay domain for the given alias. The returned URL has the form
   * `https://<alias>.<relayDomain>`.
   *
   * @param ugreenLinkId - The UGREENlink alias (e.g. `"myalias"`).
   * @param fetchImpl - A `fetch`-compatible function (defaults to
   *   `globalThis.fetch`). Required in environments where global `fetch` is
   *   not available (e.g. Node <18).
   * @returns The resolved base URL string.
   * @throws {UgosHttpError} If the HTTP request fails.
   * @throws {UgosApiError} If the API returns a non-200 code or missing data.
   *
   * @example
   * ```ts
   * const url = await UgosClient.resolveUgreenLinkUrl("myalias");
   * ```
   */
  static async resolveUgreenLinkUrl(ugreenLinkId: string, fetchImpl = globalThis.fetch): Promise<string> {
    if (!fetchImpl) {
      throw new Error("A fetch implementation is required. Use Node 18+ or pass config.fetch.");
    }

    const alias = ugreenLinkId.trim();
    const response = await fetchImpl(UGREENLINK_NODE_INFO_URL, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ alias })
    });
    const text = await response.text();

    if (!response.ok) {
      throw new UgosHttpError(response.status, response.statusText, text);
    }

    const body = JSON.parse(text) as GenericResponse<UgreenLinkNodeInfo>;
    if (body.code !== 200) {
      throw new UgosApiError(`UGREENlink lookup failed: ${body.msg ?? body.code}`, body.code, body);
    }
    if (!body.data?.relayDomain) {
      throw new UgosApiError("UGREENlink lookup did not return relayDomain", body.code, body);
    }

    return `https://${alias}.${body.data.relayDomain}`;
  }

  /**
   * Returns the current authentication session, or `undefined` if not logged
   * in.
   *
   * The session is populated after a successful {@link login} call and
   * contains the session tokens, user ID, public key, and the raw login
   * response.
   */
  get currentSession(): SessionContainer | undefined {
    return this.session;
  }

  private async getPasswordRSA(): Promise<string> {
    const urls = await this.getUrls();
    const response = await this.fetchJson<unknown>(urls.rsaQuery(), {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ username: this.config.username })
    });
    this.assertSuccess(response.body, "RSA query failed");

    const rsaToken = response.headers.get("x-rsa-token");
    if (!rsaToken) {
      throw new UgosApiError("RSA query did not return x-rsa-token", response.body.code, response.body);
    }
    return rsaToken;
  }

  /**
   * Authenticates with the UGOS server and establishes a session.
   *
   * The login flow performs the following steps:
   * 1. If configured with a UGREENlink ID and the URL hasn't been resolved
   *    yet, resolves it via {@link resolveUgreenLinkUrl}.
   * 2. Fetches an RSA public key token from the server (via the RSA query
   *    endpoint).
   * 3. RSA-encrypts the password with the server's public key.
   * 4. Sends the encrypted credentials to the login endpoint.
   *
   * On success, the session is stored internally and used for all
   * subsequent authenticated requests.
   *
   * @returns A {@link SessionContainer} with the session tokens, user ID,
   *   public key, and the full login response.
   * @throws {UgosApiError} If the RSA query or login API returns an error.
   * @throws {UgosHttpError} If an HTTP transport error occurs.
   *
   * @example
   * ```ts
   * const session = await client.login();
   * console.log("Logged in as uid:", session.uid);
   * ```
   */
  async login(): Promise<SessionContainer> {
    const urls = await this.getUrls();
    const passwordRsa = await this.getPasswordRSA();
    const response = await this.fetchJson<LoginResponse>(urls.login(), {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        username: this.config.username,
        password: rsaEncryptBase64(this.config.password, passwordRsa),
        otp: true,
        is_simple: true
      })
    });
    const data = this.assertSuccess(response.body, "Login failed");

    const session: SessionContainer = {
      tokenId: data.token_id,
      token: data.token,
      uid: data.uid,
      publicKey: data.public_key,
      login: data
    };
    this.session = session;
    return session;
  }

  /**
   * Lists the contents of a directory.
   *
   * By default returns up to 2000 entries from page 1. Use the `options`
   * parameter to traverse larger directories.
   *
   * @param path - The remote directory path to list. Defaults to the root
   *   (`""`).
   * @param options - Pagination options.
   * @param options.page - Page number (1-based). Defaults to `1`.
   * @param options.limit - Maximum entries per page. Defaults to `2000`.
   * @returns An array of {@link UgosDirent} entries, each with `isFile()`
   *   and `isDirectory()` helper methods.
   * @throws {UgosApiError} If the API returns an error.
   * @throws {Error} If no active session exists (call {@link login} first).
   *
   * @example
   * ```ts
   * const entries = await client.list("/Documents");
   * for (const entry of entries) {
   *   console.log(entry.name, entry.isDirectory() ? "(dir)" : "");
   * }
   * ```
   *
   * @example Pagination
   * ```ts
   * const page1 = await client.list("/large-dir", { page: 1, limit: 100 });
   * const page2 = await client.list("/large-dir", { page: 2, limit: 100 });
   * ```
   */
  async list(path = "", options?: { page?: number; limit?: number }): Promise<UgosDirent[]> {
    const listing = await this.listDir({ path, ...options }, this.requireSession());
    return (listing.right_files?.files ?? []).map(toDirent);
  }

  /**
   * Checks whether a file or directory exists at the given path.
   *
   * The root path (`""` or `"/"`) always returns `true`. For other paths,
   * a directory listing is performed to locate the entry. If the parent
   * directory doesn't exist (error code `1301`), the method retries against
   * the root to catch top-level entries.
   *
   * @param path - The remote path to check.
   * @returns `true` if the path exists, `false` otherwise.
   * @throws {Error} If no active session exists (call {@link login} first).
   *
   * @example
   * ```ts
   * if (await client.exists("/backup/file.txt")) {
   *   console.log("File exists");
   * }
   * ```
   */
  async exists(path: string): Promise<boolean> {
    if (!path || path === "/") {
      return true;
    }

    return (await this.getEntry(path, this.requireSession())) !== undefined;
  }

  /**
   * Retrieves the root folders for the authenticated user.
   *
   * Makes two parallel API calls to list personal root folders
   * (`root_type=4`) and shared root folders (`root_type=3`). Only
   * directory entries are included in the results.
   *
   * @returns A {@link UgosRoot} object with `personal` and `shared`
   *   {@link UgosDirent} arrays.
   * @throws {Error} If no active session exists (call {@link login} first).
   *
   * @example
   * ```ts
   * const { personal, shared } = await client.root();
   * console.log("Personal roots:", personal.map(e => e.name));
   * console.log("Shared roots:", shared.map(e => e.name));
   * ```
   */
  async root(): Promise<UgosRoot> {
    const session = this.requireSession();
    const [personal, shared] = await Promise.all([
      this.listRootFolders(4, session),
      this.listRootFolders(3, session),
    ]);
    return {
      personal,
      shared
    };
  }

  /**
   * Retrieves metadata (file size, timestamps, permissions, etc.) for a
   * single path.
   *
   * Internally performs a directory listing of the parent and locates the
   * entry by name.
   *
   * @param path - The remote path to stat.
   * @returns A {@link UgosDirent} with the entry's metadata and helper
   *   methods.
   * @throws {Error} If the path does not exist.
   * @throws {Error} If no active session exists (call {@link login} first).
   *
   * @example
   * ```ts
   * const info = await client.stat("/Documents/report.pdf");
   * console.log("Size:", info.size, "Modified:", new Date(info.mtime));
   * ```
   */
  async stat(path: string): Promise<UgosDirent> {
    const entry = await this.getEntry(path, this.requireSession());
    if (!entry) {
      throw new Error(`Path does not exist: ${path}`);
    }
    return toDirent(entry);
  }

  /**
   * Creates a new directory.
   *
   * @param path - The remote directory path to create.
   * @param recursive - If `true`, intermediate directories are created
   *   automatically. Defaults to `false`.
   * @throws {UgosApiError} If the API returns an error (e.g. parent doesn't
   *   exist and `recursive` is `false`).
   * @throws {Error} If no active session exists (call {@link login} first).
   *
   * @example
   * ```ts
   * await client.mkdir("/Documents/Projects");
   * await client.mkdir("/Documents/a/b/c", true);
   * ```
   */
  async mkdir(path: string, recursive = false): Promise<void> {
    const urls = await this.getUrls();
    const response = await this.fetchJson<unknown>(urls.createFolder(), {
      method: "POST",
      headers: {
        ...this.authHeaders(this.requireSession()),
        ...jsonHeaders()
      },
      body: JSON.stringify({ path, no_recursive_creation: !recursive })
    });
    this.assertSuccess(response.body, "Create folder failed");
  }

  /**
   * Copies one or more files or directories to a destination.
   *
   * @param src - A single source path or an array of source paths.
   * @param dst - The destination directory path.
   * @param action - Conflict resolution strategy when a target already
   *   exists:
   *   - `"skip"` / `1` — Skip conflicting items (default).
   *   - `"overwrite"` / `2` — Replace conflicting items.
   *   - `"keep-both"` / `3` — Keep both (the copy gets a renamed entry).
   * @throws {UgosApiError} If the API returns an error.
   * @throws {Error} If no active session exists (call {@link login} first).
   *
   * @example
   * ```ts
   * await client.copy("/Documents/file.txt", "/Backup/");
   * await client.copy(["/a.txt", "/b.txt"], "/Backup/", "overwrite");
   * ```
   */
  async copy(src: string | string[], dst: string, action: ConflictAction = "skip"): Promise<void> {
    await this.copyOrMove(src, dst, false, action);
  }

  /**
   * Moves one or more files or directories to a destination.
   *
   * @param src - A single source path or an array of source paths.
   * @param dst - The destination directory path.
   * @param action - Conflict resolution strategy when a target already
   *   exists:
   *   - `"skip"` / `1` — Skip conflicting items (default).
   *   - `"overwrite"` / `2` — Replace conflicting items.
   *   - `"keep-both"` / `3` — Keep both (the moved item gets a renamed
   *     entry).
   * @throws {UgosApiError} If the API returns an error.
   * @throws {Error} If no active session exists (call {@link login} first).
   *
   * @example
   * ```ts
   * await client.move("/Downloads/file.txt", "/Documents/");
   * await client.move(["/a.txt", "/b.txt"], "/Archive/", "overwrite");
   * ```
   */
  async move(src: string | string[], dst: string, action: ConflictAction = "skip"): Promise<void> {
    await this.copyOrMove(src, dst, true, action);
  }

  /**
   * Renames a file or directory.
   *
   * @param path - The full path of the file or directory to rename.
   * @param newName - The new name (basename only, not a full path).
   * @throws {UgosApiError} If the API returns an error.
   * @throws {Error} If no active session exists (call {@link login} first).
   *
   * @example
   * ```ts
   * await client.rename("/Documents/old.txt", "new.txt");
   * ```
   */
  async rename(path: string, newName: string): Promise<void> {
    const urls = await this.getUrls();
    const response = await this.fetchJson<unknown>(urls.rename(), {
      method: "POST",
      headers: {
        ...this.authHeaders(this.requireSession()),
        ...jsonHeaders()
      },
      body: JSON.stringify({ path, new_name: newName })
    });
    this.assertSuccess(response.body, "Rename path failed");
  }

  /**
   * Downloads one or more files, returning the raw HTTP {@link Response}.
   *
   * The download flow performs the following steps:
   * 1. Detects permissions for the requested paths.
   * 2. Requests a download token and URL.
   * 3. Fetches the download URL and returns the raw response (binary).
   *
   * The caller is responsible for consuming the response body (e.g. via
   * `response.arrayBuffer()`, `response.blob()`, or streaming). For reading
   * text files, consider using {@link readFile} instead.
   *
   * @param path - A single path or an array of paths to download.
   * @returns The raw HTTP {@link Response}. On success, the body contains
   *   the file contents.
   * @throws {UgosApiError} If the permission detection or download token
   *   API returns an error.
   * @throws {UgosHttpError} If the download HTTP request fails (non-2xx).
   * @throws {Error} If no active session exists (call {@link login} first).
   *
   * @example
   * ```ts
   * const response = await client.download("/Documents/report.pdf");
   * const blob = await response.blob();
   * ```
   */
  async download(path: string | string[]): Promise<Response> {
    const paths = Array.isArray(path) ? path : [path];
    return this.downloadPaths(paths, this.requireSession());
  }

  /**
   * Reads a file's contents.
   *
   * Downloads the file and returns its contents either as a decoded string
   * or as raw bytes.
   *
   * @param path - The remote file path to read.
   * @param encoding - If `"utf8"` or `"utf-8"`, the file is decoded to a
   *   string. Otherwise, a `Uint8Array` of raw bytes is returned.
   *
   * @example Read as bytes
   * ```ts
   * const bytes = await client.readFile("/Documents/data.bin");
   * console.log("First byte:", bytes[0]);
   * ```
   *
   * @example Read as UTF-8 string
   * ```ts
   * const text = await client.readFile("/Documents/notes.txt", "utf8");
   * console.log(text);
   * ```
   */
  async readFile(path: string, encoding: ReadFileEncoding): Promise<string>;
  async readFile(path: string): Promise<Uint8Array>;
  async readFile(path: string, encoding?: ReadFileEncoding): Promise<string | Uint8Array> {
    const response = await this.download(path);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return encoding ? new TextDecoder().decode(bytes) : bytes;
  }

/**
   * Uploads file content to a remote path.
   *
   * The upload uses a three-step process:
   * 1. **Pre-upload** — Sends file metadata (name, size, UUID, directory)
   *    via `multipart/form-data`.
   * 2. **Update temp info** — Confirms the temp file info with the server.
   * 3. **Upload data** — Sends the raw file bytes with upload parameters in
   *    the `ug-param` header.
   *
   * The `content` is internally converted to a `Uint8Array` before upload.
   * Supported content types include `string`, `Blob`, `ArrayBuffer`,
   * `ArrayBufferView`, and `ReadableStream<Uint8Array>`.
   * An MD5 checksum is computed for deduplication and resume support.
   *
   * @param path - The full remote destination path (including filename).
   * @param content - The file content to upload. Accepts `string`, `Blob`,
   *   `ArrayBuffer`, `ArrayBufferView`, or `ReadableStream<Uint8Array>`.
   * @param options - Optional upload parameters:
   *   - `changeTime?` — Modification timestamp (defaults to `Date.now()`).
   *   - `actionType?` — Conflict resolution strategy (defaults to `"skip"`):
   *   - `resume?` — Enable resumable upload (defaults to `true`).
   *   - `isLivePhoto?` — Mark as live photo upload (defaults to `false`).
   *   - `uuid?` — Custom upload UUID (auto-generated if omitted).
   *   - `beginSize?` — Starting byte offset for chunked uploads (defaults to `0`).
   *   - `currentSize?` — Current uploaded bytes (defaults to `0`).
   * @throws {UgosApiError} If any upload step fails.
   * @throws {Error} If no active session exists (call {@link login} first).
   *
   * @example Upload a string
   * ```ts
   * await client.upload("/Documents/hello.txt", "Hello, world!");
   * ```
   *
   * @example Upload a Uint8Array
   * ```ts
   * const bytes = new TextEncoder().encode("Hello");
   * await client.upload("/Documents/data.bin", bytes, { resume: false });
   * ```
   */
  async upload(
    path: string,
    content: UploadFileOptions["content"],
    options?: Partial<Omit<UploadFileOptions, "content" | "filename" | "dir">>
  ): Promise<void> {
    const { dir, filename } = splitRemotePath(path);
    const urls = await this.getUrls();
    const session = this.requireSession();
    const file = await toBuffer(content);
    const changeTime = options?.changeTime ?? Date.now();
    const uuid = options?.uuid ?? `${randomUuid()}_1_${md5Hex(file)}`;
    const actionType = normalizeConflictAction(options?.actionType ?? "skip");
    const resume = options?.resume ?? true;
    const isLivePhoto = options?.isLivePhoto ?? false;
    const beginSize = options?.beginSize ?? 0;
    const currentSize = options?.currentSize ?? 0;

    const form = new FormData();
    form.set("uuid", uuid);
    form.set("dir", dir);
    form.set("action_type", String(actionType));
    form.set("size", String(file.length));
    form.set("begin_size", String(beginSize));
    form.set("current_size", String(currentSize));
    form.set("change_time", String(changeTime));
    form.set("filename", filename);
    form.set("resume", String(resume));
    form.set("first_request", "true");
    form.set("file", new Blob([]), filename);

    const preUpload = await this.fetchJson<unknown>(urls.uploadFile(), {
      method: "POST",
      headers: this.authHeaders(session),
      body: form
    });
    this.assertSuccess(preUpload.body, "Pre-upload failed");

    const updateInfo = await this.fetchJson<unknown>(
      urls.updateTmpInfo(dir, uuid, filename, file.length),
      {
        method: "GET",
        headers: this.authHeaders(session)
      }
    );
    this.assertSuccess(updateInfo.body, "Upload temp info failed");

    const upload = await this.fetchJson<unknown>(urls.uploadFileV2(), {
      method: "POST",
      headers: {
        ...this.authHeaders(session),
        "ug-param": JSON.stringify({
          uuid,
          file_name: encodeURIComponent(filename),
          action_type: actionType,
          size: file.length,
          current_size: file.length,
          resume,
          dir: encodeURIComponent(dir),
          change_time: changeTime,
          is_live_photo: isLivePhoto,
          first_request: false,
          begin_size: beginSize
        })
      },
      body: new Uint8Array(file)
    });
    this.assertSuccess(upload.body, "Upload file data failed");
  }

  /**
   * Moves one or more files or directories to the trash (soft delete).
   *
   * Trashed items can typically be restored from the UGOS recycle bin.
   * Use {@link delete} for permanent removal.
   *
   * @param path - A single path or an array of paths to trash.
   * @throws {UgosApiError} If the API returns an error.
   * @throws {Error} If no active session exists (call {@link login} first).
   *
   * @example
   * ```ts
   * await client.trash("/Documents/old-file.txt");
   * await client.trash(["/a.txt", "/b.txt"]);
   * ```
   */
  async trash(path: string | string[]): Promise<void> {
    const paths = Array.isArray(path) ? path : [path];
    if (paths.length === 0) {
      return;
    }
    await this.deletePaths(paths, false);
  }

  /**
   * Permanently deletes one or more files or directories.
   *
   * This operation is irreversible. Use {@link trash} for soft deletion
   * that supports recovery from the recycle bin.
   *
   * @param path - A single path or an array of paths to delete.
   * @throws {UgosApiError} If the API returns an error.
   * @throws {Error} If no active session exists (call {@link login} first).
   *
   * @example
   * ```ts
   * await client.delete("/Documents/obsolete.txt");
   * await client.delete(["/a.txt", "/b.txt"]);
   * ```
   */
  async delete(path: string | string[]): Promise<void> {
    const paths = Array.isArray(path) ? path : [path];
    if (paths.length === 0) {
      return;
    }
    await this.deletePaths(paths, true);
  }

  private async listDir(request: ListDirRequest = {}, session = this.requireSession()): Promise<UgosListDirResponse> {
    const urls = await this.getUrls();
    const body = { ...DEFAULT_LIST_DIR_REQUEST, ...request };
    const response = await this.fetchJson<UgosListDirResponse>(urls.listDir(), {
      method: "POST",
      headers: {
        ...this.authHeaders(session),
        ...jsonHeaders(),
        referer: `${urls.baseUrl}/filemgr/?_filemgr=a58981e8`
      },
      body: JSON.stringify(body)
    });
    return this.assertSuccess(response.body, "List directory failed");
  }

  private async getDownloadToken(paths: string[], session = this.requireSession()): Promise<DownloadTokenResponse> {
    const urls = await this.getUrls();
    await this.detectPermissions(paths, session);
    const response = await this.fetchJson<DownloadTokenResponse>(urls.downloadToken(paths), {
      method: "GET",
      headers: this.authHeaders(session)
    });
    return this.assertSuccess(response.body, "Download token failed");
  }

  private async downloadPaths(paths: string[], session = this.requireSession()): Promise<Response> {
    const urls = await this.getUrls();
    const token = await this.getDownloadToken(paths, session);
    const url = urls.downloadLink(token.dl_url);
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        ...this.authHeaders(session),
        Connection: "Keep-Alive",
        "Keep-Alive": "timeout=5, max=1000",
        Referer: url,
        Pragma: "no-cache",
        "Upgrade-Insecure-Requests": "1"
      }
    });
    await this.assertHttpSuccess(response);
    return response;
  }

  private async deletePaths(paths: string[], forever: boolean): Promise<void> {
    const urls = await this.getUrls();
    const session = this.requireSession();
    const response = await this.fetchJson<unknown>(urls.delPaths(), {
      method: "POST",
      headers: {
        ...this.authHeaders(session),
        ...jsonHeaders()
      },
      body: JSON.stringify({ paths, forever })
    });
    this.assertSuccess(response.body, "Delete paths failed");
  }

  private async copyOrMove(src: string | string[], dst: string, move: boolean, action: ConflictAction): Promise<void> {
    const urls = await this.getUrls();
    const response = await this.fetchJson<unknown>(urls.copyOrMovePath(), {
      method: "POST",
      headers: {
        ...this.authHeaders(this.requireSession()),
        ...jsonHeaders()
      },
      body: JSON.stringify({
        dst,
        src: Array.isArray(src) ? src : [src],
        action_type: normalizeConflictAction(action),
        type: move,
        intranet_share_id: 0
      })
    });
    this.assertSuccess(response.body, move ? "Move paths failed" : "Copy paths failed");
  }

  private async detectPermissions(paths: string[], session: SessionContainer): Promise<void> {
    const urls = await this.getUrls();
    const response = await this.fetchJson<unknown>(urls.detectionPermissions(), {
      method: "POST",
      headers: {
        ...this.authHeaders(session),
        ...jsonHeaders()
      },
      body: JSON.stringify({ paths, type: 4, intranet_share_id: 0 })
    });
    this.assertSuccess(response.body, "Permission detection failed");
  }

  private async listRootFolders(rootType: number, session: SessionContainer): Promise<UgosDirent[]> {
    const listing = await this.listDir({ root_type: rootType }, session);
    return (listing.right_files?.files ?? []).map(toDirent).filter((entry) => entry.isDirectory());
  }

  private async getEntry(path: string, session: SessionContainer): Promise<UgosFileEntry | undefined> {
    const { dir, filename } = splitRemotePath(path);
    let listing: UgosListDirResponse;

    try {
      listing = await this.listDir({ path: dir }, session);
    } catch (error) {
      if (!(error instanceof UgosApiError) || error.code !== 1301) {
        throw error;
      }
      listing = await this.listDir({ path: "" }, session);
    }

    return (listing.right_files?.files ?? []).find((entry) => entry.name === filename || entry.path === path);
  }

  private authHeaders(session: SessionContainer): Record<string, string> {
    return {
      "x-ugreen-security-key": session.tokenId,
      "x-ugreen-token": rsaEncryptBase64(session.token, session.publicKey)
    };
  }

  private async getUrls(): Promise<UrlBuilder> {
    if (this.urls) {
      return this.urls;
    }

    if (!this.urlsPromise) {
      if (!("uglinkid" in this.config)) {
        throw new Error("No UGOS URL source configured.");
      }
      this.urlsPromise = UgosClient.resolveUgreenLinkUrl(this.config.uglinkid, this.fetchImpl).then((url) => {
        this.urls = new UrlBuilder(url);
        return this.urls;
      });
    }

    return this.urlsPromise;
  }

  private requireSession(): SessionContainer {
    if (!this.session) {
      throw new Error("No active UGOS session. Call login() first.");
    }
    return this.session;
  }

  private async fetchJson<T>(url: string, init: RequestInit): Promise<{ body: GenericResponse<T>; headers: Headers }> {
    const response = await this.fetchImpl(url, init);
    const text = await response.text();
    await this.assertHttpSuccess(response, text);
    return { body: JSON.parse(text) as GenericResponse<T>, headers: response.headers };
  }

  private assertSuccess<T>(response: GenericResponse<T>, context: string): T {
    if (response.code !== 200) {
      throw new UgosApiError(`${context}: ${response.msg ?? response.code}`, response.code, response);
    }
    return response.data;
  }

  private async assertHttpSuccess(response: Response, body?: string): Promise<void> {
    if (!response.ok) {
      throw new UgosHttpError(response.status, response.statusText, body ?? (await response.text()));
    }
  }
}

function jsonHeaders(): Record<string, string> {
  return { "content-type": "application/json" };
}

function toDirent(entry: UgosFileEntry): UgosDirent {
  return {
    ...entry,
    isFile: () => entry.file_type !== 1,
    isDirectory: () => entry.file_type === 1
  };
}

function splitRemotePath(path: string): { dir: string; filename: string } {
  const normalized = path.replace(/\/+$/, "");
  const separator = normalized.lastIndexOf("/");
  const filename = separator === -1 ? normalized : normalized.slice(separator + 1);
  const dir = separator <= 0 ? "/" : normalized.slice(0, separator);

  if (!filename) {
    throw new Error(`Remote path must include a filename: ${path}`);
  }

  return { dir, filename };
}

function normalizeConflictAction(action: ConflictAction): 1 | 2 | 3 {
  if (typeof action === "number") {
    return action;
  }
  if (action === "overwrite") {
    return 2;
  }
  if (action === "keep-both") {
    return 3;
  }
  return 1;
}

async function toBuffer(content: UploadFileOptions["content"]): Promise<Uint8Array> {
  if (typeof content === "string") {
    return new TextEncoder().encode(content);
  }
  if (content instanceof Blob) {
    return new Uint8Array(await content.arrayBuffer());
  }
  if (isReadableStream(content)) {
    return readStreamToBytes(content);
  }
  if (ArrayBuffer.isView(content)) {
    return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
  }
  return new Uint8Array(content);
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return typeof value === "object" && value !== null && "getReader" in value;
}

async function readStreamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
      length += value.length;
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function randomUuid(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("crypto.getRandomValues is required to generate upload UUIDs.");
  }
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
