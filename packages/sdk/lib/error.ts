export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public details?: Array<{
      field: string;
      message: string;
    }>,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export class APIError extends Error {
  constructor(
    message: string,
    public status?: number,
    public details?: Array<{
      field: string;
      message: string;
    }>,
  ) {
    super(message);
    this.name = "APIError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "No ad found for this address") {
    super(message);
    this.name = "NotFoundError";
  }
}
