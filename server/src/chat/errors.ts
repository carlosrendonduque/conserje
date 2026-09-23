/**
 * A request that cannot be served, carrying the HTTP status and a stable
 * machine-readable code the widget can branch on.
 *
 * The message is written to be safe to show a visitor: no internal paths, no
 * provider errors, nothing about configuration.
 */

export const RATE_LIMITED = 'rate_limited';
export const MESSAGE_TOO_LONG = 'message_too_long';
export const EMPTY_MESSAGE = 'empty_message';
export const SESSION_CLOSED = 'session_closed';
export const TURN_LIMIT = 'turn_limit_reached';
export const UPSTREAM_UNAVAILABLE = 'upstream_unavailable';

export class ChatError extends Error {
  override readonly name = 'ChatError';

  readonly errorCode: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    errorCode: string,
    status: number,
    message: string,
    retryable = false,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.errorCode = errorCode;
    this.status = status;
    this.retryable = retryable;
  }

  static rateLimited(): ChatError {
    return new ChatError(
      RATE_LIMITED,
      429,
      'Too many messages from here right now. Try again in a few minutes.',
      true,
    );
  }

  static messageTooLong(limit: number): ChatError {
    return new ChatError(
      MESSAGE_TOO_LONG,
      400,
      `That message is too long. Keep it under ${limit} characters.`,
    );
  }

  static emptyMessage(): ChatError {
    return new ChatError(EMPTY_MESSAGE, 400, 'Say something first.');
  }

  static sessionClosed(): ChatError {
    return new ChatError(SESSION_CLOSED, 409, 'This conversation is already finished.');
  }

  static upstreamUnavailable(retryable: boolean, cause?: unknown): ChatError {
    return new ChatError(
      UPSTREAM_UNAVAILABLE,
      503,
      'The assistant is unavailable right now.',
      retryable,
      { cause },
    );
  }
}
