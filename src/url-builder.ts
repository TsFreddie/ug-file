export class UrlBuilder {
  readonly baseUrl: string;

  constructor(url: string) {
    this.baseUrl = normalizeBaseUrl(url);
  }

  rsaQuery(): string {
    return `${this.baseUrl}/ugreen/v1/verify/check`;
  }

  login(): string {
    return `${this.baseUrl}/ugreen/v1/verify/login`;
  }

  codeLogin(): string {
    return `${this.baseUrl}/ugreen/v1/verify/code/login`;
  }

  isLogin(): string {
    return `${this.baseUrl}/ugreen/v1/verify/is_login`;
  }

  listDir(): string {
    return `${this.baseUrl}/ugreen/v2/filemgr/getDirFileListV2`;
  }

  createFolder(): string {
    return `${this.baseUrl}/ugreen/v2/filemgr/createFolder`;
  }

  copyOrMovePath(): string {
    return `${this.baseUrl}/ugreen/v2/filemgr/cpOrMvPath`;
  }

  rename(): string {
    return `${this.baseUrl}/ugreen/v2/filemgr/rename`;
  }

  uploadFile(): string {
    return `${this.baseUrl}/ugreen/v1/filemgr/fileUpload`;
  }

  updateTmpInfo(dir: string, uuid: string, filename: string, size: number): string {
    const params = new URLSearchParams({
      dir,
      uuid,
      filename,
      action_type: "0",
      size: String(size)
    });
    return `${this.baseUrl}/ugreen/v1/filemgr/getUpdateTmpInfo?${params.toString()}`;
  }

  uploadFileV2(): string {
    return `${this.baseUrl}/ugreen/v1/filemgr/fileUploadV2?`;
  }

  detectionPermissions(): string {
    return `${this.baseUrl}/ugreen/v1/filemgr/detectionPermissions`;
  }

  downloadToken(paths: string[]): string {
    const params = new URLSearchParams();
    for (const path of paths) {
      params.append("paths", path);
    }
    params.set("intranet_share_id", "0");
    params.set("coding", "true");
    return `${this.baseUrl}/ugreen/v2/filemgr/getDownloadToken?${params.toString()}`;
  }

  downloadLink(dlUrl: string): string {
    return `${this.baseUrl}${dlUrl}`;
  }

  delPaths(): string {
    return `${this.baseUrl}/ugreen/v2/filemgr/delPaths`;
  }
}

function normalizeBaseUrl(url: string): string {
  const normalized = url.includes("://") ? url : `https://${url}`;
  return normalized.replace(/\/+$/, "");
}
