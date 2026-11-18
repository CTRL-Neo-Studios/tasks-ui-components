import {completeTask, type FieldOption, type Fields, statusOf, type Task, type TaskDocument, type View} from '@type32/tasks'
import {applyPatch, diff, type Patch, type TaskPatch, withValue} from './changes'
import {NONE} from './rows'

/** What a board's columns are by: the view's `groupBy`, the status when it has none. */
export const boardGroupBy = (view: View) => view.groupBy ?? 'values.status'

/**
 * A task moved from the column `from` to `to` (`taskGroups`' keys): its list, star or value changes. A multiSelect
 * swaps the one value for the other. Into a done status a task is completed as the checkbox does (a repeating one moves
 * to its next time, a custom done option kept); out of done, it's open again.
 */
export function moveToGroup(task: Task, groupBy: string, fields: Fields, from: string, to: string, now: string): TaskPatch {
    const value = to === NONE ? undefined : to
    if (groupBy === 'listId') return {listId: value}
    if (groupBy === 'starred') return {starred: to === 'true' ? true : undefined}
    const field = fields[groupBy.slice('values.'.length)]!
    if (field.type === 'boolean') return withValue(task, field.id, to === 'true' ? true : undefined)
    if (field.type === 'multiSelect') {
        const current = task.values?.[field.id]
        const rest = (Array.isArray(current) ? current : []).filter(v => v !== from && v !== value)
        return withValue(task, field.id, value === undefined ? rest : [...rest, value])
    }
    if (field.id === 'status' && value !== undefined) {
        const category = field.options.find(o => o.id === value)?.category
        const before = statusOf(task, fields)
        if (category === 'done' && before !== 'done') {
            const done = completeTask(task, now)
            // Done for good: in the column it was dropped on. A repeating task moved on is open again.
            return diff(task, done.values?.status === 'done' ? {...done, values: {...done.values, status: value}} : done)
        }
        if (before === 'done' && category !== 'done') return {...withValue(task, 'status', value), completedAt: undefined}
    }
    return withValue(task, field.id, value)
}

/** `doc` with a task moved before another (`before`), or after all of them: a board's order within a column. */
export function moveTask(doc: TaskDocument, id: string, before?: string): TaskDocument {
    const task = doc.tasks.find(t => t.id === id)
    if (!task || id === before) return doc
    const rest = doc.tasks.filter(t => t.id !== id)
    const at = before === undefined ? -1 : rest.findIndex(t => t.id === before)
    return {...doc, tasks: at === -1 ? [...rest, task] : rest.toSpliced(at, 0, task)}
}

/**
 * `doc` with an option of a field changed, or added (`added`) when the document doesn't have it: a built-in field gets
 * an entry of its own for it (renaming To do is an option `todo` with a title).
 */
export function withOption(doc: TaskDocument, field: string, option: string, patch: Patch<FieldOption>, now: string, added?: FieldOption): TaskDocument {
    const fields = [...(doc.fields ?? [])]
    let at = fields.findIndex(f => f.id === field)
    if (at === -1) at = fields.push({id: field}) - 1
    const options = [...(fields[at]!.options ?? [])]
    const index = options.findIndex(o => o.id === option)
    if (index === -1) options.push(applyPatch(added ?? {id: option, updatedAt: now}, patch, now))
    else options[index] = applyPatch(options[index]!, patch, now)
    fields[at] = {...fields[at]!, options}
    return {...doc, fields}
}

/** An option's id from its title (`Waiting on client` → `waiting-on-client`), unlike any in `taken`. */
export function optionId(title: string, taken: Iterable<string>): string {
    const used = new Set(taken)
    const base = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'option'
    let id = base
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`
    return id
}
