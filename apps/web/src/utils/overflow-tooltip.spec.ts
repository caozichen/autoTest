// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { installOverflowTooltips } from './overflow-tooltip'
let cleanup = () => {}
afterEach(() => { cleanup(); document.body.innerHTML = '' })
it('shows full clipped text on hover, refreshes dynamic text, and leaves existing titles intact', () => {
  cleanup = installOverflowTooltips()
  const el = document.createElement('span')
  el.style.overflowX = 'hidden'
  Object.defineProperties(el, { clientWidth: { value: 20 }, scrollWidth: { value: 100 } })
  el.innerText = '2026-09-14 14:55:00'
  document.body.append(el)
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  expect(el.title).toBe(el.innerText)
  el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
  expect(el.hasAttribute('title')).toBe(false)
  el.innerText = 'a new long value'
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  expect(el.title).toBe('a new long value')
  el.title = 'explicit help'
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  expect(el.title).toBe('explicit help')
})
it('does not add tooltips to unclipped text or password inputs', () => {
  cleanup = installOverflowTooltips()
  const el = document.createElement('span')
  el.innerText = 'short'
  document.body.append(el)
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  expect(el.hasAttribute('title')).toBe(false)
  const input = document.createElement('input')
  input.type = 'password'
  input.value = 'secret'
  document.body.append(input)
  input.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  expect(input.hasAttribute('title')).toBe(false)
})
