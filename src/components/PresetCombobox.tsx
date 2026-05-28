import { useEffect, useMemo, useRef, useState } from 'react'

interface PresetComboboxProps {
  options: string[]
  value: string
  onChange: (key: string) => void
  className?: string
  placeholder?: string
  /** Set oblíbených presetů. Pokud poskytnut, ukazuje se sekce "Oblíbené" nahoře. */
  favorites?: Set<string>
  /** Callback pro toggle oblíbený / neoblíbený. */
  onToggleFavorite?: (key: string) => void
}

/**
 * Combobox pro výběr presetu s vyhledáváním a (volitelnými) oblíbenými.
 *
 * Filtr: case-insensitive word-match. Query se splitne na slova podle whitespace,
 * každé slovo musí být substring v názvu presetu. Prázdný query = všechny presety.
 *
 * Klávesy:
 * - šipky nahoru/dolů: navigace v seznamu
 * - Enter: vybrat highlighted item
 * - Escape: zavřít dropdown a vyčistit query
 *
 * Click mimo komponentu zavře dropdown.
 *
 * Oblíbené presety se zobrazují v separátní sekci nahoře, pokud query je prázdný.
 * Při query > 0 se zobrazí ploše bez separace (jen hvězdička u row zůstává).
 */
export function PresetCombobox({
  options,
  value,
  onChange,
  className = '',
  placeholder = 'Hledat preset…',
  favorites,
  onToggleFavorite,
}: PresetComboboxProps) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIdx, setHighlightedIdx] = useState(0)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  // Flat list pro filtr (case-insensitive word-match).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    const tokens = q.split(/\s+/)
    return options.filter((opt) => {
      const lower = opt.toLowerCase()
      return tokens.every((t) => lower.includes(t))
    })
  }, [options, query])

  // Když query je prázdný a máme favorites, rozdělíme list na 2 sekce:
  // 1) Oblíbené (v pořadí podle options, ale jen ty které jsou ve favorites)
  // 2) Ostatní (zbytek)
  // Když je query, používáme flat filtered.
  const sections = useMemo(() => {
    if (!favorites || favorites.size === 0 || query.trim()) {
      return [{ label: null, items: filtered }]
    }
    const favs: string[] = []
    const rest: string[] = []
    for (const opt of options) {
      if (favorites.has(opt)) favs.push(opt)
      else rest.push(opt)
    }
    return [
      { label: 'Oblíbené', items: favs },
      { label: 'Všechny', items: rest },
    ]
  }, [favorites, query, options, filtered])

  // Flat seznam pro navigaci klávesnicí (sekce jsou jen vizuální).
  const flatNav = useMemo(() => sections.flatMap((s) => s.items), [sections])

  // Reset highlight, když se změní filter.
  useEffect(() => {
    setHighlightedIdx(0)
  }, [query])

  // Scroll highlighted item do view.
  useEffect(() => {
    if (!isOpen) return
    const list = listRef.current
    if (!list) return
    const item = list.querySelector(`[data-idx="${highlightedIdx}"]`) as HTMLElement | null
    if (item) {
      item.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIdx, isOpen])

  // Click mimo komponentu → zavřít.
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setQuery('')
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const selectOption = (key: string) => {
    onChange(key)
    setQuery('')
    setIsOpen(false)
    inputRef.current?.blur()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!isOpen) {
        setIsOpen(true)
        return
      }
      setHighlightedIdx((i) => Math.min(i + 1, flatNav.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const match = flatNav[highlightedIdx]
      if (match) selectOption(match)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setQuery('')
      setIsOpen(false)
      inputRef.current?.blur()
    }
  }

  const displayValue = isOpen || query ? query : value

  // Renderování ploché sekce → counter pro data-idx (musí mapovat na flatNav).
  let runningIdx = -1

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={displayValue}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value)
          if (!isOpen) setIsOpen(true)
        }}
        onFocus={() => {
          setIsOpen(true)
          if (!query) setQuery('')
        }}
        onKeyDown={handleKeyDown}
        className="w-full h-10 px-3 rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 focus:outline-none focus:border-purple-500"
        aria-label="Vyhledat preset"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        role="combobox"
      />

      {isOpen && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-lg bg-neutral-900 border border-neutral-700 shadow-xl text-sm"
        >
          {flatNav.length === 0 ? (
            <li className="px-3 py-2 text-neutral-500 italic">
              Žádné výsledky pro „{query}"
            </li>
          ) : (
            sections.map((section, sIdx) => {
              if (section.items.length === 0) return null
              return (
                <div key={section.label ?? `flat-${sIdx}`}>
                  {section.label && (
                    <div className="sticky top-0 z-10 px-3 py-1 text-[10px] uppercase tracking-wider text-neutral-500 bg-neutral-900/95 border-b border-neutral-800">
                      {section.label}
                    </div>
                  )}
                  {section.items.map((opt) => {
                    runningIdx++
                    const idx = runningIdx
                    const isHighlighted = idx === highlightedIdx
                    const isSelected = opt === value
                    const isFav = favorites?.has(opt) ?? false
                    return (
                      <li
                        key={opt}
                        role="option"
                        data-idx={idx}
                        aria-selected={isSelected}
                        onMouseEnter={() => setHighlightedIdx(idx)}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          selectOption(opt)
                        }}
                        className={[
                          'group flex items-center gap-2 px-3 py-2 cursor-pointer',
                          isHighlighted ? 'bg-purple-600/30 text-white' : 'text-neutral-200',
                          isSelected && !isHighlighted ? 'text-purple-400' : '',
                        ].join(' ')}
                        title={opt}
                      >
                        <span className="flex-1 min-w-0 truncate">{opt}</span>
                        {onToggleFavorite && (
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              // Zabránit selectu řádku.
                              e.preventDefault()
                              e.stopPropagation()
                              onToggleFavorite(opt)
                            }}
                            className={[
                              'shrink-0 w-6 h-6 flex items-center justify-center rounded transition-colors',
                              isFav
                                ? 'text-yellow-400'
                                : 'text-neutral-600 hover:text-neutral-300 opacity-0 group-hover:opacity-100',
                              isFav ? 'opacity-100' : '',
                            ].join(' ')}
                            aria-label={isFav ? 'Odebrat z oblíbených' : 'Přidat do oblíbených'}
                            title={isFav ? 'Odebrat z oblíbených' : 'Přidat do oblíbených'}
                          >
                            <svg viewBox="0 0 24 24" className="w-4 h-4" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                            </svg>
                          </button>
                        )}
                      </li>
                    )
                  })}
                </div>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}
