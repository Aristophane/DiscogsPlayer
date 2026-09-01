/**
 * Enveloppe d'erreur commune à toutes les routes API (SPECIFICATION.md §17.8).
 *
 * Règle : le `message` est destiné à l'utilisateur et localisé ; les détails techniques
 * restent dans les logs serveur. Aucune erreur brute de bibliothèque ou de fournisseur
 * ne traverse cette frontière.
 */
import { NextResponse } from 'next/server';

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    retryAt?: string;
    requestId: string;
  };
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAt: Date | undefined;

  constructor(params: {
    code: string;
    /** Message déjà localisé, affichable tel quel. */
    message: string;
    status: number;
    retryable?: boolean;
    retryAt?: Date;
    /** Cause technique, journalisée mais jamais renvoyée au client. */
    cause?: unknown;
  }) {
    super(params.message, params.cause === undefined ? undefined : { cause: params.cause });
    this.name = 'ApiError';
    this.code = params.code;
    this.status = params.status;
    this.retryable = params.retryable ?? false;
    this.retryAt = params.retryAt;
  }

  toResponse(requestId: string): NextResponse<ApiErrorBody> {
    return NextResponse.json<ApiErrorBody>(
      {
        error: {
          code: this.code,
          message: this.message,
          retryable: this.retryable,
          ...(this.retryAt ? { retryAt: this.retryAt.toISOString() } : {}),
          requestId,
        },
      },
      { status: this.status, headers: { 'x-request-id': requestId } },
    );
  }
}
