import { Monitor, Moon, Sun } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
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

  function cycle() {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
    setTheme(next)
    const dark = next === 'dark' || (next === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', dark)
    try {
      localStorage.setItem('theme', next)
    } catch {}
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
