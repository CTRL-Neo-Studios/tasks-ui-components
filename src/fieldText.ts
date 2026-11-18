import type {ResolvedField, ResolvedOption, TaskDocument} from '@type32/tasks'
import type {TaskLabels} from './labels'

/** A field's title: a built-in one's in the labels' language, a custom one's as the document has it. */
export function fieldTitle(field: ResolvedField, labels: TaskLabels): string {
    return (field.builtIn && labels.fields[field.id]) || field.title
}

/** An option's title: a built-in one in the labels' language unless the document renamed it. */
export function optionTitle(doc: TaskDocument, field: ResolvedField, option: ResolvedOption, labels: TaskLabels): string {
    const label = field.builtIn ? labels.options[`${field.id}.${option.id}`] : undefined
    if (!label) return option.title
    const renamed = doc.fields?.find(f => f.id === field.id)?.options?.find(o => o.id === option.id)?.title
    return renamed ?? label
}

/** The flame's colour for a priority category (`priorityOf`). */
export const PRIORITY_CLASS: Record<string, string> = {high: 'tk:text-error', medium: 'tk:text-warning', low: 'tk:text-info'}

/** The colours offered for lists and options, in the order new ones take them. */
export const PALETTE = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#64748b']
