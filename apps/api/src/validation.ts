import { validateRoomName } from '@turntabl-score-room/shared'
import { ApiError } from './errors.js'

const USER_ID_PATTERN = /^user-[0-9a-fA-F-]{36}$|^seed-[A-Za-z0-9-]+$/

export function normalizeUsername(value: unknown) {
  if (typeof value !== 'string') {
    throw new ApiError('VALIDATION_ERROR', 'Username is required.', 400)
  }

  const result = validateRoomName(value)
  if (!result.valid) {
    throw new ApiError('VALIDATION_ERROR', result.message, 400)
  }

  return result.value
}

export function normalizeUserId(value: unknown) {
  if (typeof value !== 'string') {
    throw new ApiError('VALIDATION_ERROR', 'User id is required.', 400)
  }

  const normalized = value.trim()
  if (!USER_ID_PATTERN.test(normalized)) {
    throw new ApiError('VALIDATION_ERROR', 'User id is invalid.', 400)
  }

  return normalized
}

export function normalizeScore(value: unknown, label: string) {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 99) {
    throw new ApiError('VALIDATION_ERROR', `${label} must be an integer from 0 to 99.`, 400)
  }

  return Number(value)
}

export function normalizeText(value: unknown, label: string, fallback?: string) {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string') {
    throw new ApiError('VALIDATION_ERROR', `${label} must be text.`, 400)
  }

  const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (!normalized) return fallback
  if (normalized.length > 280) {
    throw new ApiError('VALIDATION_ERROR', `${label} must be 280 characters or fewer.`, 400)
  }

  return normalized
}
