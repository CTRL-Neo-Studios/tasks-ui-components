import type {CalendarDate} from '@internationalized/date'
import {type Fields, isOpen, type List, type Task, type TaskDocument, type View, viewTasks} from '@type32/tasks'
import {dayOf} from './dates'
import {optionTitle} from './fieldText'
import type {TaskLabels} from './labels'

export type Row =
    | { kind: 'section', key: string, label: string, color?: string, count: number }
    | { kind: 'task', key: string, task: Task, depth: number }

export interface RowOptions {
    fields: Fields
    labels: TaskLabels
    today: CalendarDate
    timeZone: string
    /** Only this list and the lists nested in it (the lists column), on top of the view's own `listIds`. */
    listId?: string
}

/** `id` and every list nested under it. */
export function listAndNested(lists: readonly List[], id: string): Set<string> {
    const out = new Set([id])
    for (let grew = true; grew;) {
        grew = false
        for (const l of lists) {
            if (l.parentId !== undefined && out.has(l.parentId) && !out.has(l.id)) {
                out.add(l.id)
                grew = true
            }
        }
    }
    return out
}

/** The earlier of a task's Do and Due day, for the viewer. */
export function taskDay(task: Task, timeZone: string): CalendarDate | undefined {
    const days = [task.start, task.due].filter(v => v !== undefined).map(v => dayOf(v, task.timeZone, timeZone))
    return days.length === 0 ? undefined : days.reduce((a, b) => (b.compare(a) < 0 ? b : a))
}

interface Group {
    key: string
    label: string
    color?: string
    roots: Task[]
}

const group = (key: string, label: string, color?: string): Group => ({key, label, color, roots: []})

/**
 * The view's tasks as the list draws them: a section per group, each group's tasks with their subtasks under them.
 * Without `groupBy`: Today (to do or due by today, overdue too), Upcoming, Anytime (no date), Done (done or
 * cancelled); Today and Upcoming by day unless the view sorts. A subtask whose parent is shown is drawn under it,
 * whatever its own group. Empty groups aren't drawn.
 */
export function taskRows(doc: TaskDocument, view: View, options: RowOptions): Row[] {
    let shown = viewTasks(doc, view, options.fields)
    if (options.listId !== undefined) {
        const lists = listAndNested(doc.lists ?? [], options.listId)
        shown = shown.filter(t => t.listId !== undefined && lists.has(t.listId))
    }
    const ids = new Set(shown.map(t => t.id))
    const children = new Map<string, Task[]>()
    const roots: Task[] = []
    for (const task of shown) {
        if (task.parentId === undefined || !ids.has(task.parentId)) roots.push(task)
        else children.set(task.parentId, [...children.get(task.parentId) ?? [], task])
    }

    const rows: Row[] = []
    const push = (task: Task, depth: number, key: string) => {
        rows.push({kind: 'task', key: `${key}\u0000${task.id}`, task, depth})
        for (const child of children.get(task.id) ?? []) push(child, depth + 1, key)
    }
    for (const g of groupsOf(doc, view, roots, options)) {
        if (g.roots.length === 0) continue
        rows.push({kind: 'section', key: `\u0000${g.key}`, label: g.label, color: g.color, count: g.roots.length})
        for (const task of g.roots) push(task, 0, g.key)
    }
    return rows
}

function groupsOf(doc: TaskDocument, view: View, roots: Task[], {fields, labels, today, timeZone}: RowOptions): Group[] {
    const by = view.groupBy
    if (by === undefined) {
        const [now, upcoming, anytime, done] = [
            group('today', labels.today), group('upcoming', labels.upcoming), group('anytime', labels.anytime), group('done', labels.done),
        ] as const
        const days = new Map<Task, CalendarDate>()
        for (const task of roots) {
            if (!isOpen(task, fields)) {
                done.roots.push(task)
                continue
            }
            const day = taskDay(task, timeZone)
            if (!day) anytime.roots.push(task)
            else {
                days.set(task, day)
                ;(day.compare(today) <= 0 ? now : upcoming).roots.push(task)
            }
        }
        if (view.sortBy === undefined) for (const g of [now, upcoming]) g.roots.sort((a, b) => days.get(a)!.compare(days.get(b)!))
        return [now, upcoming, anytime, done]
    }
    if (by === 'listId') {
        const byList = new Map((doc.lists ?? []).map(l => [l.id, group(l.id, l.title, l.color)]))
        const none = group('', labels.noList)
        for (const task of roots) (byList.get(task.listId ?? '') ?? none).roots.push(task)
        return [...byList.values(), none]
    }
    if (by === 'starred') {
        const [yes, no] = [group('true', labels.starred), group('false', labels.notStarred)]
        for (const task of roots) (task.starred ? yes : no).roots.push(task)
        return [yes, no]
    }
    const field = fields[by.slice('values.'.length)]!
    // A task without a status counts as to do.
    const value = (task: Task) => task.values?.[field.id] ?? (field.id === 'status' ? 'todo' : undefined)
    if (field.type === 'boolean') {
        const [yes, no] = [group('true', labels.yes), group('false', labels.no)]
        for (const task of roots) (value(task) === true ? yes : no).roots.push(task)
        return [yes, no]
    }
    // A select or multiSelect: a group an option, in the field's order, then values outside the options (an open
    // field's), then none. A task with several values is in each of their groups.
    const byValue = new Map(field.options.map(o => [o.id, group(o.id, optionTitle(doc, field, o, labels), o.color)]))
    const none = group('\u0000none', labels.none)
    for (const task of roots) {
        const v = value(task)
        const values = Array.isArray(v) ? v : typeof v === 'string' ? [v] : []
        if (values.length === 0) none.roots.push(task)
        for (const id of values) {
            if (!byValue.has(id)) byValue.set(id, group(id, id))
            byValue.get(id)!.roots.push(task)
        }
    }
    return [...byValue.values(), none]
}
