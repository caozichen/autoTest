/** Delegation also covers teleported dialogs and dynamically rendered table rows. */
export function installOverflowTooltips(root: Document = document): () => void {
  const owned = new Map<HTMLElement, string>()
  const restore = () => {
    for (const [element, title] of owned) {
      if (element.title === title) element.removeAttribute('title')
    }
    owned.clear()
  }
  const show = (event: Event) => {
    restore()
    let element = event.target instanceof Element ? event.target : null
    if (element?.closest('input, textarea, [contenteditable="true"]')) return
    while (element && element !== root.body) {
      if (element instanceof HTMLElement) {
        const style = getComputedStyle(element)
        const clippedX = ['hidden', 'clip'].includes(style.overflowX) && element.scrollWidth > element.clientWidth
        const clippedY = ['hidden', 'clip'].includes(style.overflowY) && element.scrollHeight > element.clientHeight
        if (clippedX || clippedY) {
          // Read only the displayed text; never expand masked values or hidden descendants.
          const text = element.innerText?.trim()
          if (text && !element.hasAttribute('title')) {
            element.title = text
            owned.set(element, text)
          }
          return
        }
      }
      element = element.parentElement
    }
  }
  root.addEventListener('mouseover', show)
  root.addEventListener('focusin', show)
  root.addEventListener('mouseout', restore)
  return () => {
    restore()
    root.removeEventListener('mouseover', show)
    root.removeEventListener('focusin', show)
    root.removeEventListener('mouseout', restore)
  }
}
