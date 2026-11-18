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

/** A section of the list, a column of the board: its key (an option's id, a list's, `true`), its title, its tasks. */
export interface Group {
    key: string
    label: string
    color?: string
    tasks: Task[]
}

/** The key of the group of tasks without a value. */
export const NONE = '\u0000none'

const group = (key: string, label: string, color?: string): Group => ({key, label, color, tasks: []})

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
    for (const g of taskGroups(doc, view, roots, options)) {
        if (g.tasks.length === 0) continue
        rows.push({kind: 'section', key: `\u0000${g.key}`, label: g.label, color: g.color, count: g.tasks.length})
        for (const task of g.tasks) push(task, 0, g.key)
    }
    return rows
}

/**
 * `tasks` (in their order) in the view's groups, every group there is, empty or not: by date (Today, Upcoming,
 * Anytime, Done) without `groupBy`; else a group a list, a select's option or a multiSelect's (in the field's order,
 * then values outside the options), `true` and `false` for a star or a boolean, and the group without a value
 * (`NONE`) last. A deleted list or option is a group only while a task has it; a task without a status is to do; a
 * task with several values is in each of their groups.
 */
export function taskGroups(doc: TaskDocument, view: View, tasks: readonly Task[], {fields, labels, today, timeZone}: RowOptions): Group[] {
    const by = view.groupBy
    if (by === undefined) {
        const [now, upcoming, anytime, done] = [
            group('today', labels.today), group('upcoming', labels.upcoming), group('anytime', labels.anytime), group('done', labels.done),
        ] as const
        const days = new Map<Task, CalendarDate>()
        for (const task of tasks) {
            if (!isOpen(task, fields)) {
                done.tasks.push(task)
                continue
            }
            const day = taskDay(task, timeZone)
            if (!day) anytime.tasks.push(task)
            else {
                days.set(task, day)
                ;(day.compare(today) <= 0 ? now : upcoming).tasks.push(task)
            }
        }
        if (view.sortBy === undefined) for (const g of [now, upcoming]) g.tasks.sort((a, b) => days.get(a)!.compare(days.get(b)!))
        return [now, upcoming, anytime, done]
    }
    if (by === 'starred' || (by.startsWith('values.') && fields[by.slice('values.'.length)]!.type === 'boolean')) {
        const id = by.slice('values.'.length)
        const [yes, no] = by === 'starred'
            ? [group('true', labels.starred), group('false', labels.notStarred)]
            : [group('true', labels.yes), group('false', labels.no)]
        for (const task of tasks) ((by === 'starred' ? task.starred : task.values?.[id]) === true ? yes : no).tasks.push(task)
        return [yes, no]
    }
    // Lists and options alike: what there is, then the deleted and unknown values tasks still have.
    const field = by === 'listId' ? undefined : fields[by.slice('values.'.length)]!
    const choices = field
        ? field.options.map(o => ({id: o.id, deleted: o.deleted, label: optionTitle(doc, field, o, labels), color: o.color}))
        : (doc.lists ?? []).map(l => ({id: l.id, deleted: l.deletedAt !== undefined, label: l.title, color: l.color}))
    const groups = new Map(choices.filter(c => !c.deleted).map(c => [c.id, group(c.id, c.label, c.color)]))
    const none = group(NONE, field ? labels.none : labels.noList)
    const valuesOf = (task: Task): string[] => {
        const v = field ? task.values?.[field.id] ?? (field.id === 'status' ? 'todo' : undefined) : task.listId
        return Array.isArray(v) ? v : typeof v === 'string' ? [v] : []
    }
    for (const task of tasks) {
        const values = valuesOf(task)
        if (values.length === 0) none.tasks.push(task)
        for (const id of values) {
            if (!groups.has(id)) {
                const known = choices.find(c => c.id === id)
                groups.set(id, group(id, known?.label ?? id, known?.color))
            }
            groups.get(id)!.tasks.push(task)
        }
    }
    return [...groups.values(), none]
}
