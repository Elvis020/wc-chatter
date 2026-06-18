export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'INTERNAL_ERROR'

export type ApiErrorStatus = 400 | 403 | 404 | 409 | 500

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public status: ApiErrorStatus = 400,
  ) {
    super(message)
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return {
      body: {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      status: error.status,
    }
  }

  console.error(error)
  return {
    body: {
      error: {
        code: 'INTERNAL_ERROR' as const,
        message: 'Something went wrong.',
      },
    },
    status: 500 as const,
  }
}
