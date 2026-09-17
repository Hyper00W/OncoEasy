type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiRequestOptions = Omit<
  RequestInit,
  "body" | "headers" | "method"
> & {
  accessToken?: string;
  body?: unknown;
  headers?: HeadersInit;
};

export type AccessTokenProvider = () => string | null | undefined;

type ApiErrorResponse = {
  success: false;
  error: {
    code: string;
    message: string;
  };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly accessTokenProvider?: AccessTokenProvider;

  constructor(
    baseUrl = import.meta.env.VITE_API_BASE_URL,
    accessTokenProvider?: AccessTokenProvider
  ) {
    if (!baseUrl) {
      throw new Error("VITE_API_BASE_URL is not configured");
    }

    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.accessTokenProvider = accessTokenProvider;
  }

  get<T>(path: string, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  post<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>("POST", path, { ...options, body });
  }

  put<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>("PUT", path, { ...options, body });
  }

  patch<T>(
    path: string,
    body?: unknown,
    options?: ApiRequestOptions
  ): Promise<T> {
    return this.request<T>("PATCH", path, { ...options, body });
  }

  delete<T>(path: string, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, options);
  }

  private async request<T>(
    method: HttpMethod,
    path: string,
    options: ApiRequestOptions = {}
  ): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");

    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }

    const accessToken = options.accessToken ?? this.accessTokenProvider?.();
    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      headers,
      method
    });

    const responseBody = await readResponseBody(response);

    if (!response.ok) {
      throw createApiError(response, responseBody);
    }

    return responseBody as T;
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }

  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  return text || undefined;
}

function createApiError(response: Response, body: unknown): ApiError {
  if (isApiErrorResponse(body)) {
    return new ApiError(response.status, body.error.code, body.error.message);
  }

  return new ApiError(
    response.status,
    "HTTP_ERROR",
    response.statusText || "The request failed"
  );
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const response = value as Record<string, unknown>;
  const error = response.error;

  return (
    response.success === false &&
    typeof error === "object" &&
    error !== null &&
    typeof (error as Record<string, unknown>).code === "string" &&
    typeof (error as Record<string, unknown>).message === "string"
  );
}

export const apiClient = new ApiClient();