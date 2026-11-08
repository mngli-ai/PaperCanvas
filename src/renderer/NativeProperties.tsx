import { useLayoutEffect } from 'react'
import './native-properties.css'

type NativePropertiesProps = {
  host: HTMLElement | null
  drawingHost: HTMLElement | null
}

/** Dock Excalidraw 0.18's real Island, not a second React render of its controls.
 * LayerUI owns Section > (h2, Island). Keep Section in its original parent so
 * React can remove it normally when selection/tool/view mode changes. Moving
 * Section itself would make React's next removeChild throw NotFoundError.
 */
export function NativeProperties({ host, drawingHost }: NativePropertiesProps) {
  useLayoutEffect(() => {
    if (!host || !drawingHost || host === drawingHost) return
    const doc = host.ownerDocument
    const context = doc.createElement('div')
    context.className = 'excalidraw native-properties-context'
    const slot = doc.createElement('div')
    slot.className = 'selected-shape-actions native-properties-slot'
    context.append(slot)
    host.append(context)

    let current: {
      section: HTMLElement
      panel: HTMLElement
      marker: Comment
      root: HTMLElement
    } | null = null
    let disposed = false
    let queued = false
    let themedRoot: HTMLElement | null = null
    let copiedVariables = new Set<string>()

    const syncTheme = () => {
      if (!themedRoot) return
      context.className = `excalidraw native-properties-context${themedRoot.classList.contains('theme--dark') ? ' theme--dark' : ''}${themedRoot.classList.contains('excalidraw--mobile') ? ' excalidraw--mobile' : ''}`
      const view = doc.defaultView
      if (!view) return
      const computed = view.getComputedStyle(themedRoot)
      const next = new Set<string>()
      // Include instance-level overrides (and inherited application variables),
      // not only upstream's stock light/dark class declarations.
      for (let i = 0; i < computed.length; i++) {
        const name = computed.item(i)
        if (!name.startsWith('--')) continue
        next.add(name)
        const value = computed.getPropertyValue(name)
        if (context.style.getPropertyValue(name) !== value) context.style.setProperty(name, value)
      }
      for (const name of copiedVariables) if (!next.has(name)) context.style.removeProperty(name)
      copiedVariables = next
      context.dir = themedRoot.closest('[dir]')?.getAttribute('dir') || doc.documentElement.dir || 'ltr'
    }
    const themeObserver = new MutationObserver(syncTheme)

    const restore = () => {
      if (!current) return
      const { section, panel, marker } = current
      // Restore into even a detached Section. React may already have removed
      // that Section; never resurrect an unmounted tree in the visible editor.
      if (marker.parentNode === section) marker.replaceWith(panel)
      else if (panel.parentNode === slot) section.append(panel)
      section.removeAttribute('data-native-properties-source')
      slot.removeAttribute('aria-labelledby')
      current = null
    }

    const reconcile = () => {
      queued = false
      if (disposed) return
      if (current && (!host.isConnected || !drawingHost.contains(current.section) ||
        !current.section.isConnected || !drawingHost.contains(current.root))) restore()
      if (!host.isConnected || !drawingHost.isConnected) return
      if (current) {
        // Nothing changed: do not append/move again on every color/slider edit.
        if (current.panel.parentNode === slot) return
        restore()
      }
      const panel = drawingHost.querySelector<HTMLElement>(
        '.excalidraw .selected-shape-actions > .App-menu__left',
      )
      const section = panel?.parentElement
      const root = panel?.closest<HTMLElement>('.excalidraw')
      if (!panel || !section || !root || !section.classList.contains('selected-shape-actions')) return
      if (themedRoot !== root) {
        themeObserver.disconnect()
        themedRoot = root
        themeObserver.observe(root, { attributes: true, attributeFilter: ['class', 'style', 'dir'] })
      }
      syncTheme()
      const marker = doc.createComment('native-properties: original Island position')
      section.insertBefore(marker, panel)
      section.setAttribute('data-native-properties-source', '')
      const label = section.getAttribute('aria-labelledby')
      if (label) slot.setAttribute('aria-labelledby', label)
      current = { section, panel, marker, root }
      slot.append(panel)
    }
    const schedule = () => {
      if (queued || disposed) return
      queued = true
      queueMicrotask(reconcile)
    }
    // Observe only this editor's source tree. The dock is outside it, so edits
    // and our destination writes cannot create an observer feedback loop.
    const observer = new MutationObserver(schedule)
    observer.observe(drawingHost, { childList: true, subtree: true })
    // A sidebar may be collapsed without unmounting this adapter.
    const hostObserver = new MutationObserver(schedule)
    if (host.parentNode) hostObserver.observe(host.parentNode, { childList: true })
    reconcile()

    return () => {
      disposed = true
      observer.disconnect()
      hostObserver.disconnect()
      themeObserver.disconnect()
      restore()
      context.remove()
    }
  }, [host, drawingHost])
  return null
}

export default NativeProperties
