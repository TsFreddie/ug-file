export type UgosClientConfig = UgosUrlClientConfig | UgosLinkClientConfig;

export interface UgosClientBaseConfig {
  fetch?: typeof fetch;
  trustInfo?: UgosLoginTrustInfo;
}

export interface UgosUrlClientConfig extends UgosClientBaseConfig {
  url: string;
}

export interface UgosLinkClientConfig extends UgosClientBaseConfig {
  uglinkid: string;
}

export interface UgosLoginCredentials {
  username: string;
  password: string;
  keepalive?: boolean;
}

export interface UgosLoginTrustInfo {
  client_type?: string;
  system?: string;
  dev_name?: string;
  [key: string]: unknown;
}

export interface UgosLoginCodeOptions {
  type?: number;
  trust?: boolean;
  trustInfo?: UgosLoginTrustInfo;
}

export interface UgosLoginCodeChallenge {
  tokenId: string;
  uid?: number;
  role?: string;
  urgentEmail?: string;
  data: LoginCodeRequiredResponse;
}

export interface UgosLoginSuccessResult {
  success: true;
  requiresCode: false;
  session: SessionContainer;
  data?: LoginResponse;
  body?: GenericResponse<LoginResponse>;
}

export interface UgosLoginCodeRequiredResult {
  success: false;
  requiresCode: true;
  challenge: UgosLoginCodeChallenge;
  code: number;
  message?: string;
  data: LoginCodeRequiredResponse;
  body: GenericResponse<LoginCodeRequiredResponse>;
  verifyCode(code: string, trust?: boolean | UgosLoginCodeOptions): Promise<UgosLoginResult>;
}

export interface UgosLoginFailureResult {
  success: false;
  requiresCode: false;
  code: number;
  message?: string;
  data?: unknown;
  body: GenericResponse<unknown>;
}

export type UgosLoginResult = UgosLoginSuccessResult | UgosLoginCodeRequiredResult | UgosLoginFailureResult;

export interface GenericResponse<T> {
  code: number;
  msg?: string;
  data: T;
}

export interface UgreenLinkNodeInfo {
  alias: string;
  appDomain?: string;
  dockerDomain?: string;
  netInfo?: {
    smartdns?: {
      lan?: string[];
      host?: string;
    };
    ipv4?: string[];
    ipv6?: string[];
    httpPort?: number;
    ddns?: string[];
    httpsPort?: number;
    [key: string]: unknown;
  };
  relayDomain: string;
  [key: string]: unknown;
}

export type UgosFileType = 0 | 1 | number;

export interface SessionContainer {
  tokenId: string;
  token: string;
  uid: number;
  publicKey: string;
  keepalive: boolean;
}

export interface LoginResponse {
  auth_type?: string;
  clusterId?: string;
  color?: string;
  deny_change_pwd?: boolean;
  edev?: boolean;
  enable_change_pwd?: boolean;
  enable_otp?: boolean;
  is_arm?: boolean;
  is_bootstrap_completed?: boolean;
  is_cloud?: boolean;
  is_domain?: boolean;
  is_exceed?: boolean;
  is_simple?: boolean;
  is_ugk?: boolean;
  match_rule?: boolean;
  mobile_guide?: boolean;
  model?: string;
  nas_name?: string;
  need_bind?: boolean;
  network_info?: unknown[];
  password_expire?: boolean;
  public_key: string;
  role?: string;
  sn?: string;
  static_token?: string;
  system_version?: string;
  token: string;
  token_id: string;
  uid: number;
  urgent_email?: string;
  username?: string;
  version_number?: number;
  [key: string]: unknown;
}

export interface LoginCodeRequiredResponse {
  enable_otp?: boolean;
  is_exceed?: boolean;
  role?: string;
  token_id: string;
  uid?: number;
  urgent_email?: string;
  [key: string]: unknown;
}

export interface ListDirRequest {
  path?: string;
  limit?: number;
  page?: number;
  is_shield_recycle?: boolean;
  data_type?: number;
  left_no_page_show?: boolean;
  left_count?: number;
  sort_type?: number;
  reverse?: boolean;
  permission?: number;
  root_type?: number;
  [key: string]: unknown;
}

export interface UgosFileEntry {
  path: string;
  name: string;
  size: number;
  takes_space?: number;
  ext?: string;
  file_collation?: string;
  ctime: number;
  mtime: number;
  atime: number;
  file_type: UgosFileType;
  owner_type?: string;
  owner?: string;
  owner_name?: string;
  uid?: number;
  dtime?: number;
  remaining_del_time?: number;
  recycle_status?: number;
  recycle_in_path?: boolean;
  recycle_open?: boolean;
  permission_mask?: number;
  is_quick_access?: boolean;
  top_path?: string;
  type?: number;
  icon?: number;
  icons?: number[];
  intranet_share_id?: number;
  parent_permission_mask?: number;
  mount_point_type?: number;
  is_net_mount_point?: number;
  mount_type?: number;
  mount?: {
    is_mount: boolean;
    mount_path: string;
  };
  support_uninstall?: boolean;
  is_livephoto?: boolean;
  alisa_name?: string;
  name_suffix_label?: string;
  name_suffix?: string;
  id?: number;
  navigation_path?: string;
  error_state?: number;
  network_icon?: number;
  tag_ids?: unknown;
  tags_info?: unknown;
  cid?: string;
  net_disk_name?: string;
  [key: string]: unknown;
}

export interface UgosDirent extends UgosFileEntry {
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface UgosFileList {
  status: number;
  total: number;
  top_path: string;
  type: number;
  permission_mask: number;
  files: UgosFileEntry[] | null;
  mounts: unknown;
  net_mounts: unknown;
  mount_childs: unknown;
  external_shares: unknown;
  external_child: unknown;
  ios_list: unknown;
  share_list: unknown;
  share_user_list: unknown;
  search_files: unknown;
  [key: string]: unknown;
}

export interface UgosListDirResponse {
  left_tree: UgosFileList;
  right_files: UgosFileList | null;
  status: number;
  [key: string]: unknown;
}

export interface UgosRoot {
  personal: UgosDirent[];
  shared: UgosDirent[];
}

export type ReadFileEncoding = "utf8" | "utf-8";

export interface UploadFileOptions {
  content: Blob | ArrayBuffer | ArrayBufferView | ReadableStream<Uint8Array> | string;
  filename: string;
  dir: string;
  changeTime?: number;
  actionType?: ConflictAction;
  resume?: boolean;
  isLivePhoto?: boolean;
  uuid?: string;
  beginSize?: number;
  currentSize?: number;
}

export type ConflictAction = 0 | 1 | 3 | "skip" | "overwrite" | "keep-both";

export interface DownloadTokenResponse {
  dl_token: string;
  dl_url: string;
}
