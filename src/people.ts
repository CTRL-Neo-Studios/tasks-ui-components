/*
 * How a task is drawn: its colour (its own, else its list's) and its assignees (the built-in field's options).
 */
import type {Fields, List, Task} from '@type32/tasks'

/** A task's colour: its `color`, else its list's, else none (the theme's primary is the caller's). */
export function taskColor(task: Task, lists: ReadonlyMap<string, List> | readonly List[]): string | undefined {
    if (task.color) return task.color
    if (task.listId === undefined) return undefined
    const list = 'get' in lists ? lists.get(task.listId) : lists.find(l => l.id === task.listId)
    return list?.color
}

/** Text that reads on `color` (`#rrggbb`): black on a light one, white on a dark one or on a theme colour. */
export function textOn(color: string | undefined): string {
    const m = color && /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
    if (!m) return '#fff'
    const [r, g, b] = m.slice(1).map(h => Number.parseInt(h, 16) / 255).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.4 ? '#111' : '#fff'
}

export interface Person {
    id: string
    name: string
    initials: string
    color?: string
}

/** Up to two letters of a name: its first two words' firsts (`Ada Lovelace` → `AL`), or its first two letters. */
export function initials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean)
    const letters = words.length > 1 ? [words[0]!, words[1]!].map(w => [...w][0]!) : [...(words[0] ?? '')].slice(0, 2)
    return letters.join('').toUpperCase()
}

/** The people a task is for, in its order; an id that's no option shows as itself. */
export function assigneesOf(task: Task, fields: Fields): Person[] {
    const value = task.values?.assignees
    if (!Array.isArray(value)) return []
    const options = new Map(fields.assignees?.options.map(o => [o.id, o]))
    return value.map((id) => {
        const option = options.get(id)
        const name = option?.title ?? id
        return {id, name, initials: initials(name), ...(option?.color && {color: option.color})}
    })
}
