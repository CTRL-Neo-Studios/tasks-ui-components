<script setup lang="ts">
/**
 * A calendar view of a document: a month, a week or a day (the view's `scale`), with a small month and the lists
 * beside it (a list switched off is left out of the view's `listIds`). Each occurrence of a repeating task is drawn;
 * times are the viewer's (`timeZone`). A click opens a task's editor; a drag moves it, or stretches its end; a drag on
 * empty hours, or a double click on a day, draws a new task. Reports what the user does; writes nothing.
 */
import {type CalendarDate, DateFormatter, getLocalTimeZone, now as nowIn, today as todayIn} from '@internationalized/date'
import UButton from '@nuxt/ui/components/Button.vue'
import UCalendar from '@nuxt/ui/components/Calendar.vue'
import UPopover from '@nuxt/ui/components/Popover.vue'
import {resolveFields, type Task, type TaskDocument, type View} from '@type32/tasks'
import {computed, nextTick, onBeforeUnmount, ref, shallowRef} from 'vue'
import {type CalendarItem, calendarItems, draftTask, monthWeeks, type Shift, shiftTask, SNAP_MINUTES, weekStart} from '../calendar'
import type {Patch, TaskPatch} from '../changes'
import {HOUR_PX, useCalendarDrag} from '../drag'
import {type TaskLabels, useLabels} from '../labels'
import CalendarMonth from './CalendarMonth.vue'
import CalendarWeek from './CalendarWeek.vue'
import TaskEditor from './TaskEditor.vue'

const props = withDefaults(defineProps<{
    document: TaskDocument
    view: View
    /** The viewer's IANA zone: what's today, and where every time is drawn. Default: the system's. */
    timeZone?: string
    locale?: string
    /** 0 is Sunday. */
    weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6
    labels?: Partial<TaskLabels>
    /** Off: a click reports `open` instead of opening the task's editor, and a new task isn't opened either. */
    editor?: boolean
}>(), {timeZone: undefined, locale: undefined, weekStartsOn: 1, labels: undefined, editor: true})
const emit = defineEmits<{
    change: [id: string, patch: TaskPatch]
    create: [task: Task]
    /** The view's `scale` or `listIds` changed here. */
    changeView: [patch: Patch<View>]
    /** A task clicked, with `editor` off. */
    open: [id: string]
    /**
     * One occurrence of a repeating task dragged: yours to ask whether it's that one (`detachOccurrence`) or the whole
     * series (`shiftTask`).
     */
    moveOccurrence: [item: CalendarItem, shift: Shift]
}>()
defineSlots<{ notes?(props: { task: Task, text: string, update: (text: string) => void }): unknown }>()
const labels = useLabels(() => props.labels)

const zone = computed(() => props.timeZone ?? getLocalTimeZone())
const today = computed(() => todayIn(zone.value))
const minutesNow = ref(0)
const tick = () => {
    const now = nowIn(zone.value)
    minutesNow.value = now.hour * 60 + now.minute
}
tick()
const timer = setInterval(tick, 60_000)
onBeforeUnmount(() => clearInterval(timer))

const fields = computed(() => resolveFields(props.document))
const lists = computed(() => new Map((props.document.lists ?? []).map(l => [l.id, l])))
const shownLists = computed(() => (props.document.lists ?? []).filter(l => !l.deletedAt))
const scale = computed(() => (['day', 'week', 'month'].includes(props.view.scale ?? '') ? props.view.scale as 'day' | 'week' | 'month' : 'month'))
const anchor = shallowRef<CalendarDate>(today.value)

const weeks = computed(() => monthWeeks(anchor.value, props.weekStartsOn))
const days = computed(() => {
    if (scale.value === 'day') return [anchor.value]
    const first = weekStart(anchor.value, props.weekStartsOn)
    return Array.from({length: 7}, (_, i) => first.add({days: i}))
})
const range = computed(() => {
    const first = scale.value === 'month' ? weeks.value[0]![0]! : days.value[0]!
    const last = scale.value === 'month' ? weeks.value[5]![6]! : days.value.at(-1)!
    return {from: first, to: last.add({days: 1}), timeZone: zone.value}
})
const items = computed(() => calendarItems(props.document, props.view, fields.value, range.value))

function go(step: -1 | 0 | 1) {
    if (step === 0) anchor.value = today.value
    else anchor.value = anchor.value.add(scale.value === 'month' ? {months: step} : {days: step * (scale.value === 'week' ? 7 : 1)})
}
const title = computed(() => {
    const locale = props.locale ?? new Intl.DateTimeFormat().resolvedOptions().locale
    if (scale.value === 'month') return new DateFormatter(locale, {month: 'long', year: 'numeric', timeZone: 'UTC'}).format(anchor.value.toDate('UTC'))
    const format = new DateFormatter(locale, {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'})
    if (scale.value === 'day') return new DateFormatter(locale, {dateStyle: 'full', timeZone: 'UTC'}).format(anchor.value.toDate('UTC'))
    return format.formatRange(days.value[0]!.toDate('UTC'), days.value[6]!.toDate('UTC'))
})
function setScale(next: 'day' | 'week' | 'month') {
    if (next !== scale.value) emit('changeView', {scale: next})
}
function openDay(day: CalendarDate) {
    anchor.value = day
    setScale('day')
}

// The lists column: a list switched off is left out of the view's `listIds`; all on is no `listIds`.
const listShown = (id: string) => !props.view.listIds || props.view.listIds.includes(id)
function toggleList(id: string) {
    const all = shownLists.value.map(l => l.id)
    const next = (props.view.listIds ?? all).includes(id) ? (props.view.listIds ?? all).filter(l => l !== id) : [...(props.view.listIds ?? []), id]
    emit('changeView', {listIds: all.every(l => next.includes(l)) ? undefined : next})
}

// The editor, one at a time, beside what was clicked.
const editing = shallowRef<{ id: string, el: HTMLElement }>()
const editingTask = computed(() => editing.value && props.document.tasks.find(t => t.id === editing.value!.id && !t.deletedAt))
async function openWhenDrawn(id: string) {
    await nextTick()
    requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`[data-item][data-task="${CSS.escape(id)}"]`)
        if (el) editing.value = {id, el}
    })
}
function create(task: Task) {
    emit('create', task)
    if (props.editor) void openWhenDrawn(task.id)
}

const drag = useCalendarDrag({
    open: (item, el) => (props.editor ? (editing.value = {id: item.task.id, el}) : emit('open', item.task.id)),
    commit(item, shift) {
        if (item.task.recurrence) emit('moveOccurrence', item, shift)
        else emit('change', item.task.id, shiftTask(item.task, shift))
    },
    draw: (day, start, end) => create(draftTask(day, day, {start, end})),
})
const itemDown = (grid: 'time' | 'days', event: PointerEvent, item: CalendarItem, edge: 'start' | 'end') => drag.itemDown(event, item, edge, grid)
function gridCreate(event: MouseEvent, day: CalendarDate) {
    if ((event.target as HTMLElement).closest('[data-item]')) return
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const start = Math.floor((event.clientY - box.top) / HOUR_PX * 60 / SNAP_MINUTES) * SNAP_MINUTES
    create(draftTask(day, day, {start, end: Math.min(24 * 60, start + 60)}))
}
</script>

<template>
  <div class="tk:@container tk:flex tk:h-full tk:min-h-0">
    <aside class="tk:hidden tk:w-64 tk:shrink-0 tk:flex-col tk:gap-4 tk:overflow-y-auto tk:border-e tk:border-default tk:p-3 tk:@3xl:flex">
      <UCalendar :model-value="anchor" :week-starts-on="weekStartsOn" size="sm" @update:model-value="(v: any) => v && (anchor = v)" />
      <div v-if="shownLists.length" class="tk:flex tk:flex-col tk:gap-0.5">
        <div class="tk:px-2 tk:pb-1 tk:text-xs tk:font-semibold tk:uppercase tk:tracking-wide tk:text-muted">{{ labels.lists }}</div>
        <button
          v-for="list in shownLists"
          :key="list.id"
          type="button"
          class="tk:flex tk:items-center tk:gap-2 tk:rounded-md tk:px-2 tk:py-1 tk:text-start tk:text-sm tk:hover:bg-elevated/60"
          :aria-pressed="listShown(list.id)"
          :data-list="list.id"
          @click="toggleList(list.id)"
        >
          <span
            class="tk:size-3 tk:shrink-0 tk:rounded-sm tk:border-2"
            :style="{borderColor: list.color ?? 'var(--ui-primary)', backgroundColor: listShown(list.id) ? (list.color ?? 'var(--ui-primary)') : 'transparent'}"
          />
          <span class="tk:truncate" :class="listShown(list.id) ? 'tk:text-default' : 'tk:text-muted'">{{ list.title }}</span>
        </button>
      </div>
    </aside>
    <div class="tk:flex tk:min-w-0 tk:flex-1 tk:flex-col">
      <div class="tk:flex tk:items-center tk:gap-2 tk:border-b tk:border-default tk:px-3 tk:py-1.5">
        <UButton icon="i-lucide-chevron-left" size="sm" variant="ghost" color="neutral" :title="labels.previous" @click="go(-1)" />
        <UButton icon="i-lucide-chevron-right" size="sm" variant="ghost" color="neutral" :title="labels.next" @click="go(1)" />
        <UButton size="sm" variant="outline" color="neutral" :label="labels.today" @click="go(0)" />
        <span class="tk:ms-1 tk:truncate tk:font-semibold tk:text-highlighted" data-calendar-title>{{ title }}</span>
        <span class="tk:grow" />
        <UButton
          v-for="s in (['day', 'week', 'month'] as const)"
          :key="s"
          size="sm"
          :variant="scale === s ? 'soft' : 'ghost'"
          :color="scale === s ? 'primary' : 'neutral'"
          :label="labels[s]"
          @click="setScale(s)"
        />
      </div>
      <CalendarMonth
        v-if="scale === 'month'"
        class="tk:min-h-0 tk:flex-1"
        :weeks="weeks"
        :items="items"
        :month="anchor.month"
        :today="today"
        :fields="fields"
        :lists="lists"
        :locale="locale"
        :preview="drag.preview.value"
        @item-down="(e: PointerEvent, item: CalendarItem, edge: 'start' | 'end') => itemDown('days', e, item, edge)"
        @day-open="openDay"
        @day-create="(day: CalendarDate) => create(draftTask(day, day))"
      />
      <CalendarWeek
        v-else
        class="tk:min-h-0 tk:flex-1"
        :days="days"
        :items="items"
        :today="today"
        :now="minutesNow"
        :fields="fields"
        :lists="lists"
        :locale="locale"
        :preview="drag.preview.value"
        @item-down="(e: PointerEvent, item: CalendarItem, edge: 'start' | 'end') => itemDown('time', e, item, edge)"
        @grid-down="drag.gridDown"
        @grid-create="gridCreate"
      />
    </div>
    <UPopover
      :open="!!editingTask"
      :reference="editing?.el"
      :content="{side: 'right', align: 'start', sideOffset: 8}"
      @update:open="(open: boolean) => !open && (editing = undefined)"
    >
      <template #content>
        <div v-if="editingTask" class="tk:w-md tk:max-w-[90vw] tk:p-3">
          <TaskEditor
            :key="editingTask.id"
            :task="editingTask"
            :document="document"
            :fields="fields"
            :today="today"
            :time-zone="zone"
            :locale="locale"
            :week-starts-on="weekStartsOn"
            @change="(patch: TaskPatch) => emit('change', editingTask!.id, patch)"
            @create="create"
            @close="editing = undefined"
          >
            <template v-if="$slots.notes" #notes="scope">
              <slot name="notes" v-bind="scope" />
            </template>
          </TaskEditor>
        </div>
      </template>
    </UPopover>
  </div>
</template>
