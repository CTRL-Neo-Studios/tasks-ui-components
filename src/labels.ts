import {computed, inject, provide, type ComputedRef, type InjectionKey} from 'vue'

/** Every string the components show, English by default. Pass your translations as `labels` (any subset). */
export const defaultLabels = {
    today: 'Today',
    upcoming: 'Upcoming',
    anytime: 'Anytime',
    done: 'Done',
    none: 'None',
    yes: 'Yes',
    no: 'No',
    starred: 'Starred',
    notStarred: 'Not starred',
    allTasks: 'All tasks',
    lists: 'Lists',
    noList: 'No list',
    newList: 'New list',
    listName: 'List name',
    rename: 'Rename',
    color: 'Colour',
    delete: 'Delete',
    newTask: 'New task',
    title: 'Title',
    notes: 'Notes',
    do: 'Do',
    due: 'Due',
    addTime: 'Add time',
    removeTime: 'Remove time',
    clear: 'Clear',
    repeat: 'Repeat',
    repeatNone: 'Never',
    repeatDaily: 'Every day',
    repeatWeekly: 'Every week',
    repeatMonthly: 'Every month',
    repeatYearly: 'Every year',
    repeatCustom: 'Custom',
    repeatNeedsDate: 'Set a Do or Due date to repeat',
    addTag: 'Add a tag',
    addColumn: 'Add column',
    columnName: 'Column name',
    category: 'Means',
    cancel: 'Cancel',
    day: 'Day',
    week: 'Week',
    month: 'Month',
    previous: 'Previous',
    next: 'Next',
    edit: 'Edit',
    duplicate: 'Duplicate',
    list: 'List',
    duration: 'Duration',
    removeDependency: 'Remove dependency on',
    star: 'Star',
    unstar: 'Remove star',
    more: 'More',
    addSubtask: 'Add subtask',
    complete: 'Complete',
    reopen: 'Reopen',
    empty: 'No tasks',
    /** The built-in fields' titles, by id. */
    fields: {status: 'Status', priority: 'Priority', tags: 'Tags', progress: 'Progress', location: 'Location'} as Record<string, string>,
    /** The built-in options' titles, by `<field>.<option>`; a document's own title for one wins. */
    options: {
        'status.todo': 'To do',
        'status.doing': 'In progress',
        'status.done': 'Done',
        'status.cancelled': 'Cancelled',
        'priority.low': 'Low',
        'priority.medium': 'Medium',
        'priority.high': 'High',
    } as Record<string, string>,
}

export type TaskLabels = typeof defaultLabels

const KEY: InjectionKey<ComputedRef<TaskLabels>> = Symbol('task-labels')

/** The labels for a component: its own `labels` over those of the component it's in, over English. */
export function useLabels(own: () => Partial<TaskLabels> | undefined): ComputedRef<TaskLabels> {
    const outer = inject(KEY, undefined)
    const labels = computed(() => ({...(outer?.value ?? defaultLabels), ...own()}))
    provide(KEY, labels)
    return labels
}
