// Mermaid diagrams drawn in the browser with Mermaid's redux themes, so they follow light and dark mode.
// Mermaid (~500 KB) loads on the first diagram. The n8n workflow still draws, checks and repairs each diagram; the
// docs' markdown carries the repaired code.

type Mermaid = (typeof import('mermaid'))['default']

let mermaid: Promise<Mermaid> | null = null
// One drawing at a time: the theme is Mermaid-wide, and the docs, the full view and Ask can all draw at once
let queue: Promise<unknown> = Promise.resolve()
// The full view shows the same doc again, and a theme switch back redraws: both reuse earlier drawings
const drawn = new Map<string, Promise<string>>()
let count = 0

/** Puts a card-coloured box behind each sequence message and frame condition, so lifelines that cross the text
 *  (often through the gap between two words) pass behind it. Mermaid has no setting for this. */
function onCards(svg: string, card: string) {
  // Measured in the page, laid out but unseen; Mermaid's strict mode has already sanitized the drawing
  const host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:-99999px;visibility:hidden'
  host.innerHTML = svg
  document.body.append(host)
  for (const text of host.querySelectorAll<SVGTextElement>('text.messageText, text.loopText')) {
    const box = text.getBBox()
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    for (const [k, v] of Object.entries({ x: box.x - 4, y: box.y - 1, width: box.width + 8, height: box.height + 2, rx: 3 }))
      rect.setAttribute(k, String(v))
    rect.setAttribute('fill', card)
    text.before(rect)
  }
  const out = host.innerHTML
  host.remove()
  return out
}

/** `code` drawn as an SVG data URL in the light or dark theme. Rejects when Mermaid can't read the code. */
export function drawDiagram(code: string, dark: boolean): Promise<string> {
  const key = `${dark}\n${code}`
  let url = drawn.get(key)
  if (!url) {
    url = queue.then(async () => {
      const m = await (mermaid ??= import('mermaid').then((x) => x.default))
      // The docs card's colour (index.css --card), so text on a line can be cut out of it
      const card = dark ? '#171717' : '#ffffff'
      m.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: dark ? 'redux-dark-color' : 'redux-color',
        themeVariables: { edgeLabelBackground: card },
        // Flowchart labels on a card-coloured chip in the full text colour, so lines pass behind them
        themeCSS: `
          .edgeLabel, .edgeLabel p, .edgeLabel span { background-color: ${card}; color: ${dark ? '#f5f5f5' : '#1f2937'}; }
          .edgeLabel p { padding: 1px 4px; border-radius: 4px; }`,
      })
      const { svg } = await m.render(`mermaid-${++count}`, code)
      // Base64, like the workflow's drawings, so the zoom viewer reads the size from the viewBox the same way
      let bytes = ''
      for (const b of new TextEncoder().encode(onCards(svg, card))) bytes += String.fromCharCode(b)
      return `data:image/svg+xml;base64,${btoa(bytes)}`
    })
    queue = url.catch(() => {})
    drawn.set(key, url)
  }
  return url
}
