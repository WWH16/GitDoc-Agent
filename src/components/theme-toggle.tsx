import { Monitor, Moon, Sun } from 'lucide-react'
import { useState, useSyncExternalStore, type MouseEvent } from 'react'
import { flushSync } from 'react-dom'
import { Button } from '@/components/ui/button'

const THEMES = ['light', 'dark', 'system'] as const

// Both index.html files apply the saved theme before first paint; this cycles light, dark, system.
// The landing page and the app share the 'theme' key, so a choice on one carries to the other.
export function ThemeToggle() {
  const [theme, setTheme] = useState<(typeof THEMES)[number]>(() => {
    try {
      const t = localStorage.getItem('theme')
      return THEMES.find((x) => x === t) ?? 'system'
    } catch {
      return 'system'
    }
  })
  const Icon = { light: Sun, dark: Moon, system: Monitor }[theme]

  function cycle(e: MouseEvent<HTMLButtonElement>) {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
    try {
      localStorage.setItem('theme', next)
    } catch {}
    const html = document.documentElement
    const dark = next === 'dark' || (next === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    const apply = () => {
      flushSync(() => setTheme(next))
      html.classList.toggle('dark', dark)
    }
    // No visible change, reduced motion or no View Transitions: switch at once
    if (dark === html.classList.contains('dark') || matchMedia('(prefers-reduced-motion: reduce)').matches || !document.startViewTransition) {
      apply()
      return
    }
    // The new theme grows as a circle from the toggle until it covers the farthest corner of the screen
    const { left, top, width, height } = e.currentTarget.getBoundingClientRect()
    const x = left + width / 2
    const y = top + height / 2
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
    document.startViewTransition(apply).ready.then(() =>
      html.animate(
        { clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 500, easing: 'cubic-bezier(0.165, 0.84, 0.44, 1)', pseudoElement: '::view-transition-new(root)' },
      ),
    )
  }

  return (
    <Button variant="ghost" size="icon" aria-label={`Theme: ${theme}. Change theme`} title={`Theme: ${theme}`} onClick={cycle}>
      <Icon />
    </Button>
  )
}

// Whether `.dark` is on <html> right now, re-rendering when ThemeToggle flips it
export function useDark() {
  return useSyncExternalStore(
    (onChange) => {
      const observer = new MutationObserver(onChange)
      observer.observe(document.documentElement, { attributeFilter: ['class'] })
      return () => observer.disconnect()
    },
    () => document.documentElement.classList.contains('dark'),
  )
}
