export interface RocketFlagErrorEnvelope {
  error: string;
  detail: string;
  docs?: string;
}

export class RocketFlagApiError extends Error {
  public readonly status: number;
  public readonly errorTitle: string;
  public readonly detail: string;
  public readonly docs?: string;

  constructor(status: number, envelope: RocketFlagErrorEnvelope) {
    const message = envelope.detail
      ? `${envelope.error}: ${envelope.detail}`
      : envelope.error;
    super(message);
    this.name = "RocketFlagApiError";
    this.status = status;
    this.errorTitle = envelope.error;
    this.detail = envelope.detail;
    if (envelope.docs !== undefined) {
      this.docs = envelope.docs;
    }
    Object.setPrototypeOf(this, RocketFlagApiError.prototype);
  }

  public isUnauthorizedError(): boolean {
    return this.status === 401;
  }

  public isPaymentRequiredError(): boolean {
    return this.status === 402;
  }

  public isReadOnlyTokenError(): boolean {
    return (
      this.status === 403 &&
      /read|permission|write/i.test(`${this.errorTitle} ${this.detail}`)
    );
  }

  public isEnvironmentForbiddenError(): boolean {
    return this.status === 403 && !this.isReadOnlyTokenError();
  }

  public isNotFoundError(): boolean {
    return this.status === 404;
  }

  public isRateLimitedError(): boolean {
    return this.status === 429;
  }
}

export class RocketFlagNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RocketFlagNetworkError";
    Object.setPrototypeOf(this, RocketFlagNetworkError.prototype);
  }
}
