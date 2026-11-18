<script setup lang="ts">
/**
 * A task opened for editing: its title, its notes (the `notes` slot, a textarea by default), Do and Due, repeat, list,
 * tags, priority, star, status, and the document's other fields. Reports each edit as a patch (`change`); writes
 * nothing.
 */
import type {CalendarDate} from '@internationalized/date'
import UButton from '@nuxt/ui/components/Button.vue'
import UDropdownMenu from '@nuxt/ui/components/DropdownMenu.vue'
import UInputTags from '@nuxt/ui/components/InputTags.vue'
import UPopover from '@nuxt/ui/components/Popover.vue'
import USelect from '@nuxt/ui/components/Select.vue'
import UTextarea from '@nuxt/ui/components/Textarea.vue'
import {type Fields, type FieldValue, type Frequency, isOverdue, type List, priorityOf, type Task, type TaskDocument} from '@type32/tasks'
import {computed, onMounted, useTemplateRef} from 'vue'
import {type TaskPatch, withDue, withRepeat, withStart, withValue} from '../changes'
import {fieldTitle, optionTitle, PRIORITY_CLASS} from '../fieldText'
import {type TaskLabels, useLabels} from '../labels'
import DatePicker from './DatePicker.vue'
import FieldInput from './FieldInput.vue'

const props = defineProps<{
    task: Task
    document: TaskDocument
    fields: Fields
    today: CalendarDate
    timeZone: string
    locale?: string
    weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6
    labels?: Partial<TaskLabels>
}>()
const emit = defineEmits<{
    change: [patch: TaskPatch]
    /** A subtask to add (`parentId` set). */
    create: [task: Task]
    close: []
}>()
defineSlots<{ notes?(props: { task: Task, text: string, update: (text: string) => void }): unknown }>()
const labels = useLabels(() => props.labels)

const change = (patch: TaskPatch) => emit('change', patch)
const now = () => new Date().toISOString()
const title = useTemplateRef<HTMLInputElement>('title')
onMounted(() => title.value?.focus())

const NONE = '\u0000none'
const lists = computed(() => (props.document.lists ?? []).filter(l => !l.deletedAt || l.id === props.task.listId))
const listItems = computed(() => [
    {label: labels.value.noList, value: NONE},
    ...lists.value.map((l: List) => ({label: l.title, value: l.id})),
])

const FREQUENCIES: Frequency[] = ['daily', 'weekly', 'monthly', 'yearly']
const repeat = computed(() => {
    const rule = props.task.recurrence
    if (!rule) return NONE
    const plain = Object.keys(rule).length === 1 || (Object.keys(rule).length === 2 && rule.interval === 1)
    return plain ? rule.freq : 'custom'
})
const repeatItems = computed(() => [
    {label: labels.value.repeatNone, value: NONE},
    ...FREQUENCIES.map(freq => ({label: labels.value[`repeat${freq[0]!.toUpperCase()}${freq.slice(1)}` as 'repeatDaily'], value: freq})),
    ...(repeat.value === 'custom' ? [{label: labels.value.repeatCustom, value: 'custom'}] : []),
])
const canRepeat = computed(() => props.task.start !== undefined || props.task.due !== undefined)

const status = computed(() => props.fields.status!)
const priority = computed(() => props.fields.priority!)
const optionsOf = (id: 'status' | 'priority') => {
    const field = props.fields[id]!
    const current = props.task.values?.[id]
    return field.options.filter(o => !o.deleted || o.id === current).map(o => ({
        label: optionTitle(props.document, field, o, labels.value),
        type: 'checkbox' as const,
        checked: (current ?? (id === 'status' ? 'todo' : undefined)) === o.id,
        onUpdateChecked: () => change(withValue(props.task, id, o.id)),
    }))
}
const priorityItems = computed(() => [
    ...optionsOf('priority'),
    {label: labels.value.none, type: 'checkbox' as const, checked: props.task.values?.priority === undefined, onUpdateChecked: () => change(withValue(props.task, 'priority', undefined))},
])
const moreItems = computed(() => [
    [{label: fieldTitle(status.value, labels.value), icon: 'i-lucide-circle-dot', children: optionsOf('status')}],
    [{
        label: labels.value.addSubtask,
        icon: 'i-lucide-list-tree',
        onSelect: () => emit('create', {
            id: crypto.randomUUID(),
            title: '',
            parentId: props.task.id,
            ...(props.task.listId !== undefined && {listId: props.task.listId}),
            updatedAt: now(),
        }),
    }],
    [{label: labels.value.delete, icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => change({deletedAt: now()})}],
])
const flame = computed(() => PRIORITY_CLASS[priorityOf(props.task, props.fields) ?? ''] ?? 'tk:text-muted')
const tags = computed(() => {
    const v = props.task.values?.tags
    return Array.isArray(v) ? v : []
})
// The fields a chip doesn't already edit, in the document's order: the document's own, and a built-in one (progress,
// location) or a deleted one only while the task has a value for it.
const otherFields = computed(() => Object.values(props.fields).filter(f => !['status', 'priority', 'tags'].includes(f.id)
    && ((!f.builtIn && !f.deleted) || props.task.values?.[f.id] !== undefined)))
const late = computed(() => isOverdue(props.task, props.fields, {timeZone: props.timeZone}))
</script>

<template>
  <div class="tk:flex tk:min-w-0 tk:flex-1 tk:flex-col tk:gap-2" @keydown.esc.stop="emit('close')">
    <input
      ref="title"
      :value="task.title"
      :placeholder="labels.title"
      class="tk:w-full tk:bg-transparent tk:text-highlighted tk:outline-none"
      @input="change({title: ($event.target as HTMLInputElement).value})"
      @keydown.enter="emit('close')"
    >
    <slot name="notes" :task="task" :text="task.notes ?? ''" :update="(text: string) => change({notes: text || undefined})">
      <UTextarea
        :model-value="task.notes ?? ''"
        :placeholder="labels.notes"
        autoresize
        :rows="1"
        variant="none"
        :padded="false"
        class="tk:w-full"
        :ui="{base: 'tk:px-0'}"
        @update:model-value="change({notes: String($event) || undefined})"
      />
    </slot>
    <div v-if="otherFields.length" class="tk:grid tk:grid-cols-[auto_1fr] tk:items-center tk:gap-x-3 tk:gap-y-1 tk:text-sm">
      <template v-for="field in otherFields" :key="field.id">
        <span class="tk:text-muted">{{ fieldTitle(field, labels) }}</span>
        <FieldInput
          :field="field"
          :value="task.values?.[field.id]"
          :document="document"
          :today="today"
          :locale="locale"
          :week-starts-on="weekStartsOn"
          @update="(v: FieldValue | undefined) => change(withValue(task, field.id, v))"
        />
      </template>
    </div>
    <div class="tk:flex tk:flex-wrap tk:items-center tk:justify-end tk:gap-1">
      <DatePicker
        :model-value="task.start"
        :label="labels.do"
        icon="i-lucide-calendar"
        :today="today"
        :locale="locale"
        :week-starts-on="weekStartsOn"
        @update:model-value="change(withStart(task, $event?.slice(0, 10)))"
      />
      <DatePicker
        :model-value="task.due"
        :label="labels.due"
        icon="i-lucide-calendar-clock"
        allow-time
        :late="late"
        :today="today"
        :locale="locale"
        :week-starts-on="weekStartsOn"
        @update:model-value="change(withDue(task, $event))"
      />
      <USelect
        :model-value="repeat"
        :items="repeatItems"
        :disabled="!canRepeat"
        :title="canRepeat ? labels.repeat : labels.repeatNeedsDate"
        icon="i-lucide-repeat"
        size="sm"
        variant="ghost"
        @update:model-value="(v: string) => v !== 'custom' && change(withRepeat(v === NONE ? undefined : v as Frequency))"
      />
      <USelect
        :model-value="task.listId ?? NONE"
        :items="listItems"
        icon="i-lucide-list"
        size="sm"
        variant="ghost"
        @update:model-value="(v: string) => change({listId: v === NONE ? undefined : v})"
      />
      <UPopover>
        <UButton icon="i-lucide-tag" size="sm" variant="ghost" color="neutral" :title="fieldTitle(fields.tags!, labels)">
          <span v-if="tags.length">{{ tags.length }}</span>
        </UButton>
        <template #content>
          <UInputTags
            :model-value="tags"
            :placeholder="labels.addTag"
            class="tk:m-2 tk:w-64"
            @update:model-value="change(withValue(task, 'tags', $event as string[]))"
          />
        </template>
      </UPopover>
      <UDropdownMenu :items="priorityItems">
        <UButton icon="i-lucide-flame" size="sm" variant="ghost" color="neutral" :class="flame" :title="fieldTitle(priority, labels)" />
      </UDropdownMenu>
      <UButton
        icon="i-lucide-star"
        size="sm"
        variant="ghost"
        color="neutral"
        :class="task.starred ? 'tk:text-warning' : 'tk:text-muted'"
        :title="task.starred ? labels.unstar : labels.star"
        @click="change({starred: task.starred ? undefined : true})"
      />
      <UDropdownMenu :items="moreItems">
        <UButton icon="i-lucide-ellipsis" size="sm" variant="ghost" color="neutral" :title="labels.more" />
      </UDropdownMenu>
    </div>
  </div>
</template>
