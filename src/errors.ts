export class UgosApiError extends Error {
  readonly code: number;
  readonly response: unknown;

  constructor(message: string, code: number, response: unknown) {
    super(message);
    this.name = "UgosApiError";
    this.code = code;
    this.response = response;
  }
}

export class UgosHttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: string;

  constructor(status: number, statusText: string, body: string) {
    super(`UGOS request failed with HTTP ${status} ${statusText}`);
    this.name = "UgosHttpError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}
