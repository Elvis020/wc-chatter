import { describe, expect, test } from 'bun:test'
import { resolveApiBaseUrl, resolveWsBaseUrl } from './api'

describe('api client URL resolution', () => {
  test('derives websocket URL from the configured https API origin', () => {
    expect(resolveWsBaseUrl(undefined, 'https://api.turntabl.app')).toBe('wss://api.turntabl.app/ws')
  })

  test('derives websocket URL from the configured http API origin', () => {
    expect(resolveWsBaseUrl(undefined, 'http://localhost:8787')).toBe('ws://localhost:8787/ws')
  })

  test('keeps an explicit websocket URL when provided', () => {
    expect(resolveWsBaseUrl('wss://live.turntabl.app/ws/', 'https://api.turntabl.app')).toBe('wss://live.turntabl.app/ws')
  })

  test('keeps an explicit API URL normalized', () => {
    expect(resolveApiBaseUrl('https://api.turntabl.app/')).toBe('https://api.turntabl.app')
  })
})
