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

/** `code` drawn as an SVG data URL in the light or dark theme. Rejects when Mermaid can't read the code. */
export function drawDiagram(code: string, dark: boolean): Promise<string> {
  const key = `${dark}\n${code}`
  let url = drawn.get(key)
  if (!url) {
    url = queue.then(async () => {
      const m = await (mermaid ??= import('mermaid').then((x) => x.default))
      m.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: dark ? 'redux-dark-color' : 'redux-color',
      })
      const { svg } = await m.render(`mermaid-${++count}`, code)
      // Base64, like the workflow's drawings, so the zoom viewer reads the size from the viewBox the same way
      let bytes = ''
      for (const b of new TextEncoder().encode(svg)) bytes += String.fromCharCode(b)
      return `data:image/svg+xml;base64,${btoa(bytes)}`
    })
    queue = url.catch(() => {})
    drawn.set(key, url)
  }
  return url
}
