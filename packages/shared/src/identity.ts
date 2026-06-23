export const ROOM_NAME_MIN_LENGTH = 2
export const ROOM_NAME_MAX_LENGTH = 24
export const PICKUP_QUESTION_MIN_LENGTH = 4
export const PICKUP_ANSWER_MIN_LENGTH = 2
export const PICKUP_TEXT_MAX_LENGTH = 280

export const ROOM_NAME_PATTERN = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .'-]{2,24}$/

export type ValidationResult =
  | { valid: true; value: string; message: string }
  | { valid: false; value: string; message: string }

export function normalizeIdentityText(value: string) {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

export function limitRoomName(value: string) {
  return value.slice(0, ROOM_NAME_MAX_LENGTH)
}

export function normalizeRoomName(value: string) {
  return limitRoomName(normalizeIdentityText(value))
}

export function validateRoomName(value: string): ValidationResult {
  const normalized = normalizeRoomName(value)
  if (normalized.length < ROOM_NAME_MIN_LENGTH || !ROOM_NAME_PATTERN.test(normalized)) {
    return { valid: false, value: normalized, message: 'Use 2-24 chars' }
  }

  return { valid: true, value: normalized, message: 'Looks good. 2-24 supported characters.' }
}

export function validatePickupQuestion(value: string): ValidationResult {
  const normalized = normalizeIdentityText(value)
  if (normalized.length < PICKUP_QUESTION_MIN_LENGTH) {
    return { valid: false, value: normalized, message: 'Admin will ask this if your prediction wins.' }
  }
  if (normalized.length > PICKUP_TEXT_MAX_LENGTH) {
    return { valid: false, value: normalized, message: 'Keep it under 280 characters.' }
  }

  return { valid: true, value: normalized, message: 'Good. Admin can ask this at pickup.' }
}

export function validatePickupAnswer(value: string): ValidationResult {
  const normalized = normalizeIdentityText(value)
  if (normalized.length < PICKUP_ANSWER_MIN_LENGTH) {
    return { valid: false, value: normalized, message: 'Your private reply for claiming a prize.' }
  }
  if (normalized.length > PICKUP_TEXT_MAX_LENGTH) {
    return { valid: false, value: normalized, message: 'Keep it under 280 characters.' }
  }

  return { valid: true, value: normalized, message: 'Good. Keep this answer private.' }
}

export function hasPickupVerification(question: string, answer: string) {
  return validatePickupQuestion(question).valid && validatePickupAnswer(answer).valid
}
