<script setup lang="ts">
/**
 * A board view of a document: a column a group of the view's `groupBy` (the status without one), every option or
 * list a column even while empty, cards dragged between columns (`moveToGroup`) and, while the view doesn't sort,
 * within them (`move`). Columns are added, renamed, coloured and deleted where they're options or lists. Reports what
 * the user does; writes nothing.
 */
import {getLocalTimeZone, today as todayIn} from '@internationalized/date'
import UButton from '@nuxt/ui/components/Button.vue'
import type {DropdownMenuItem} from '@nuxt/ui/components/DropdownMenu.vue'
import USelect from '@nuxt/ui/components/Select.vue'
import {type FieldOption, type List, resolveFields, type Task, type TaskDocument, type View, viewTasks} from '@type32/tasks'
import {computed, ref} from 'vue'
import {boardGroupBy, moveToGroup, optionId} from '../board'
import {applyPatch, type Patch, type TaskPatch} from '../changes'
import {PALETTE} from '../fieldText'
import {type TaskLabels, useLabels} from '../labels'
import {type Group, NONE, taskGroups} from '../rows'
import BoardColumn from './BoardColumn.vue'

const props = withDefaults(defineProps<{
    document: TaskDocument
    view: View
    /** The viewer's IANA zone, which decides what's today. Default: the system's. */
    timeZone?: string
    locale?: string
    /** 0 is Sunday. */
    weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6
    labels?: Partial<TaskLabels>
}>(), {timeZone: undefined, locale: undefined, weekStartsOn: undefined, labels: undefined})
const emit = defineEmits<{
    change: [id: string, patch: TaskPatch]
    create: [task: Task]
    /** A task moved before another in the document (`moveTask`), or after all of them. */
    move: [id: string, before: string | undefined]
    changeList: [id: string, patch: Patch<List>]
    createList: [list: List]
    /** An option of a field changed (`withOption`); a built-in one renamed is an option added to the document. */
    changeOption: [field: string, option: string, patch: Patch<FieldOption>]
    createOption: [field: string, option: FieldOption]
}>()
defineSlots<{ notes?(props: { task: Task, text: string, update: (text: string) => void }): unknown }>()
const labels = useLabels(() => props.labels)

const zone = computed(() => props.timeZone ?? getLocalTimeZone())
const today = computed(() => todayIn(zone.value))
const fields = computed(() => resolveFields(props.document))
const groupBy = computed(() => boardGroupBy(props.view))
const view = computed(() => ({...props.view, groupBy: groupBy.value}))
const field = computed(() => (groupBy.value.startsWith('values.') ? fields.value[groupBy.value.slice('values.'.length)] : undefined))
const columns = computed(() => taskGroups(props.document, view.value, viewTasks(props.document, view.value, fields.value), {
    fields: fields.value,
    labels: labels.value,
    today: today.value,
    timeZone: zone.value,
}).filter(g => g.key !== NONE || g.tasks.length > 0))
const listById = computed(() => new Map((props.document.lists ?? []).map(l => [l.id, l])))
const listOf = (task: Task) => (groupBy.value === 'listId' || task.listId === undefined ? undefined : listById.value.get(task.listId))
const ordered = computed(() => props.view.sortBy === undefined)
const now = () => new Date().toISOString()

function drop(to: Group, id: string, from: string, before: string | undefined) {
    const task = props.document.tasks.find(t => t.id === id)
    if (!task) return
    if (from !== to.key) emit('change', id, moveToGroup(task, groupBy.value, fields.value, from, to.key, now()))
    if (ordered.value && before !== id) emit('move', id, before)
}
function add(to: Group, title: string) {
    const task: Task = {id: crypto.randomUUID(), title, updatedAt: now()}
    emit('create', applyPatch(task, moveToGroup(task, groupBy.value, fields.value, NONE, to.key, now()), now()))
}

// What a column is: an option of a select or multiSelect, a list, or neither (a star, a boolean, None).
const editable = computed(() => groupBy.value === 'listId' || field.value?.type === 'select' || field.value?.type === 'multiSelect')
const renaming = ref<string>()
function rename(group: Group, title: string | undefined) {
    if (renaming.value !== group.key) return
    renaming.value = undefined
    if (title === undefined) return
    if (groupBy.value === 'listId') emit('changeList', group.key, {title})
    else emit('changeOption', field.value!.id, group.key, {title})
}
function recolor(group: Group, color: string) {
    if (groupBy.value === 'listId') emit('changeList', group.key, {color})
    else emit('changeOption', field.value!.id, group.key, {color})
}
const builtInOption = (group: Group) => !!field.value?.builtIn && field.value.options.some(o => o.id === group.key && o.category === o.id)
function menu(group: Group): DropdownMenuItem[][] | undefined {
    if (!editable.value || group.key === NONE) return undefined
    return [
        [{label: labels.value.rename, icon: 'i-lucide-pencil', onSelect: () => (renaming.value = group.key)}],
        [{
            label: labels.value.color,
            icon: 'i-lucide-palette',
            children: PALETTE.map(color => ({label: color, type: 'checkbox' as const, checked: group.color === color, onUpdateChecked: () => recolor(group, color)})),
        }],
        // A built-in option can't be deleted; the others are kept, marked deleted, as the format wants.
        ...(builtInOption(group) ? [] : [[{
            label: labels.value.delete,
            icon: 'i-lucide-trash-2',
            color: 'error' as const,
            onSelect: () => (groupBy.value === 'listId'
                ? emit('changeList', group.key, {deletedAt: now()})
                : emit('changeOption', field.value!.id, group.key, {deletedAt: now()})),
        }]]),
    ]
}

// Add column: a list, or an option (with the meaning it maps to, for a field that has categories).
const adding = ref(false)
const draft = ref('')
const category = ref<string>()
const categories = computed(() => field.value?.categories ?? [])
const categoryItems = computed(() => categories.value.map(c => ({label: labels.value.options[`${field.value!.id}.${c}`] ?? c, value: c})))
function startAdding() {
    adding.value = true
    draft.value = ''
    category.value = categories.value[0]
}
function addColumn() {
    const title = draft.value.trim()
    adding.value = false
    if (!title) return
    const color = PALETTE[columns.value.length % PALETTE.length]!
    if (groupBy.value === 'listId') return emit('createList', {id: crypto.randomUUID(), title, color, updatedAt: now()})
    const id = optionId(title, field.value!.options.map(o => o.id))
    emit('createOption', field.value!.id, {id, title, color, ...(category.value !== undefined && {category: category.value}), updatedAt: now()})
}
const focus = (el: unknown) => (el as HTMLInputElement | null)?.focus()
</script>

<template>
  <div class="tk:flex tk:h-full tk:min-h-0 tk:gap-3 tk:overflow-x-auto tk:p-3">
    <BoardColumn
      v-for="group in columns"
      :key="group.key"
      :group="group"
      :document="document"
      :fields="fields"
      :list-of="listOf"
      :ordered="ordered"
      :menu="menu(group)"
      :renaming="renaming === group.key"
      :today="today"
      :time-zone="zone"
      :locale="locale"
      :week-starts-on="weekStartsOn"
      @change="(id, patch) => emit('change', id, patch)"
      @create="emit('create', $event)"
      @create-option="(field: string, option: FieldOption) => emit('createOption', field, option)"
      @drop="(id, from, before) => drop(group, id, from, before)"
      @add="add(group, $event)"
      @rename="rename(group, $event)"
    >
      <template v-if="$slots.notes" #notes="scope">
        <slot name="notes" v-bind="scope" />
      </template>
    </BoardColumn>
    <div v-if="editable" class="tk:w-72 tk:shrink-0">
      <div v-if="adding" class="tk:flex tk:flex-col tk:gap-2 tk:rounded-xl tk:bg-elevated/50 tk:p-2" @keydown.esc="adding = false">
        <input
          :ref="focus"
          v-model="draft"
          :placeholder="labels.columnName"
          class="tk:rounded-lg tk:border tk:border-default tk:bg-default tk:p-2 tk:text-sm tk:outline-none"
          data-column-new
          @keydown.enter="addColumn"
        >
        <USelect v-if="categoryItems.length" v-model="category" :items="categoryItems" size="sm" :title="labels.category" />
        <div class="tk:flex tk:justify-end tk:gap-1">
          <UButton size="sm" variant="ghost" color="neutral" :label="labels.cancel" @click="adding = false" />
          <UButton size="sm" :label="labels.addColumn" @click="addColumn" />
        </div>
      </div>
      <UButton v-else icon="i-lucide-plus" size="sm" variant="ghost" color="neutral" :label="labels.addColumn" @click="startAdding" />
    </div>
  </div>
</template>
