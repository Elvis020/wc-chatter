import { describe, expect, test } from 'bun:test'
import {
  hasPickupVerification,
  limitRoomName,
  normalizeRoomName,
  validatePickupAnswer,
  validatePickupQuestion,
  validateRoomName,
} from '../src/index'

describe('identity policy', () => {
  test('normalizes and caps room names at 24 characters', () => {
    expect(normalizeRoomName('  Ada   Lovelace  ')).toBe('Ada Lovelace')
    expect(limitRoomName('1234567890123456789012345')).toBe('123456789012345678901234')
    expect(validateRoomName('1234567890123456789012345')).toEqual({
      valid: true,
      value: '123456789012345678901234',
      message: 'Looks good. 2-24 supported characters.',
    })
  })

  test('rejects unsupported or too-short names with the concise UI message', () => {
    expect(validateRoomName('a')).toEqual({ valid: false, value: 'a', message: 'Use 2-24 chars' })
    expect(validateRoomName('bad@name')).toEqual({ valid: false, value: 'bad@name', message: 'Use 2-24 chars' })
  })

  test('validates pickup question and answer as one setup requirement', () => {
    expect(validatePickupQuestion('last three digits?').valid).toBe(true)
    expect(validatePickupAnswer('184').valid).toBe(true)
    expect(hasPickupVerification('last three digits?', '184')).toBe(true)
    expect(hasPickupVerification('why', '184')).toBe(false)
  })
})
