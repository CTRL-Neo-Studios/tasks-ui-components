<script setup lang="ts">
/**
 * A timeline (Gantt) view of a document: the outline on the left (title, length, progress; subtasks under their
 * parent, folding), each task's times on a day axis on the right (spans as bars, moments as diamonds, dues as marks, a
 * parent without times of its own as the stretch its subtasks cover), dependency lines, today's line; a day, week or
 * month scale (the view's `scale`). One scroller: the outline stays at the left, the axis' header at the top, and only
 * the rows on screen are drawn. A click opens a task's editor; a drag moves a bar, or stretches its end, by days (a
 * repeating task's series moves whole); a drag from the dot after a bar to another row reports that row's task waits
 * for it (`dependsOn`); a right click opens a task's menu. Reports what the user does; writes nothing.
 */
import {DateFormatter, getLocalTimeZone, now as nowIn, today as todayIn} from '@internationalized/date'
import UButton from '@nuxt/ui/components/Button.vue'
import UContextMenu, {type ContextMenuItem} from '@nuxt/ui/components/ContextMenu.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import UPopover from '@nuxt/ui/components/Popover.vue'
import UToggleGroup from '@nuxt/ui/components/ToggleGroup.vue'
import {useVirtualizer} from '@tanstack/vue-virtual'
import {isOpen, resolveFields, type Task, type TaskDocument, type View, viewTasks} from '@type32/tasks'
import {computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch} from 'vue'
import {DAY_MINUTES, shiftTask} from '../calendar'
import type {Patch, TaskPatch} from '../changes'
import {followPointer} from '../drag'
import {type TaskLabels, useLabels} from '../labels'
import {DAY_WIDTH, linkPath, type Scale, timelineAxis, type TimelineBar, type TimelineRow, timelineRows, timelineTicks} from '../timeline'
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
    /** Off: a click reports `open` instead of opening the task's editor; no menu, no dependencies drawn. */
    editor?: boolean
}>(), {timeZone: undefined, locale: undefined, weekStartsOn: 1, labels: undefined, editor: true})
const emit = defineEmits<{
    change: [id: string, patch: TaskPatch]
    create: [task: Task]
    /** The view's `scale` changed here. */
    changeView: [patch: Patch<View>]
    /** A task clicked, with `editor` off. */
    open: [id: string]
}>()
defineSlots<{ notes?(props: { task: Task, text: string, update: (text: string) => void }): unknown }>()
const labels = useLabels(() => props.labels)

/** A row's height, the header's, the outline's width; in pixels. */
const ROW = 36
const HEADER = 52
const OUTLINE = 320

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
const now = () => new Date().toISOString()

const fields = computed(() => resolveFields(props.document))
const lists = computed(() => (props.document.lists ?? []).filter(l => !l.deletedAt))
const listColor = computed(() => new Map((props.document.lists ?? []).map(l => [l.id, l.color])))
const scale = computed((): Scale => (props.view.scale && props.view.scale in DAY_WIDTH ? props.view.scale as Scale : 'week'))
const dw = computed(() => DAY_WIDTH[scale.value])
const axis = computed(() => timelineAxis(viewTasks(props.document, props.view, fields.value), zone.value, today.value))
const width = computed(() => axis.value.to.compare(axis.value.from) * dw.value)
const nowX = computed(() => (today.value.compare(axis.value.from) + minutesNow.value / DAY_MINUTES) * dw.value)

const folded = shallowRef(new Set<string>())
function fold(id: string) {
    const next = new Set(folded.value)
    if (!next.delete(id)) next.add(id)
    folded.value = next
}
const rows = computed(() => timelineRows(props.document, props.view, fields.value, axis.value, folded.value))
const indexOf = computed(() => new Map(rows.value.map((r, i) => [r.task.id, i])))

// The header's cells and their words, in the locale.
const locale = computed(() => props.locale ?? new Intl.DateTimeFormat().resolvedOptions().locale)
const header = computed(() => {
    const format = (options: Intl.DateTimeFormatOptions) => new DateFormatter(locale.value, {...options, timeZone: 'UTC'})
    const major = format(scale.value === 'month' ? {year: 'numeric'} : {month: 'long', year: 'numeric'})
    const minor = format(scale.value === 'day' ? {day: 'numeric'} : scale.value === 'week' ? {month: 'short', day: 'numeric'} : {month: 'short'})
    const {major: tops, minor: bottoms} = timelineTicks(axis.value, scale.value, props.weekStartsOn)
    return {
        major: tops.map(t => ({...t, label: major.format(t.day.toDate('UTC'))})),
        minor: bottoms.map(t => ({...t, label: minor.format(t.day.toDate('UTC'))})),
    }
})
const units = computed(() => Object.fromEntries((['day', 'hour'] as const).map(unit => [unit, new Intl.NumberFormat(locale.value, {style: 'unit', unit, unitDisplay: 'narrow', maximumFractionDigits: 1})])))
const lengthText = (days: number | undefined) => (days === undefined ? '' : days < 1 ? units.value.hour!.format(days * 24) : units.value.day!.format(days))

const scroller = useTemplateRef<HTMLElement>('scroller')
const content = useTemplateRef<HTMLElement>('content')
const virtualizer = useVirtualizer(computed(() => ({
    count: rows.value.length,
    getScrollElement: () => scroller.value,
    estimateSize: () => ROW,
    paddingStart: HEADER,
    getItemKey: (i: number) => rows.value[i]!.task.id,
    overscan: 12,
})))

/** What's drawn of a row, from its first time to its last: its bars, or its subtasks' stretch. */
function extent(row: TimelineRow) {
    if (row.bars.length === 0) return row.summary
    return {from: Math.min(...row.bars.map(b => b.from)), to: Math.max(...row.bars.map(b => b.to))}
}
const rowY = (index: number) => HEADER + index * ROW + ROW / 2
// Every dependency between rows drawn, finish to start; those with a row on screen are drawn.
const links = computed(() => rows.value.flatMap((row, i) => {
    const to = extent(row)
    return !to ? [] : (row.task.dependsOn ?? []).flatMap((id) => {
        const j = indexOf.value.get(id)
        const from = j === undefined ? undefined : extent(rows.value[j]!)
        return !from ? [] : [{key: `${id}\u0000${row.task.id}`, lo: Math.min(i, j!), hi: Math.max(i, j!), path: linkPath(from.to * dw.value, rowY(j!), to.from * dw.value, rowY(i), ROW)}]
    })
}))
const shownLinks = computed(() => {
    const items = virtualizer.value.getVirtualItems()
    const [first, last] = [items[0]?.index ?? 0, items.at(-1)?.index ?? -1]
    return links.value.filter(l => l.hi >= first && l.lo <= last)
})

// Moved and stretched bars, by days; a line drawn from a bar's dot.
const preview = shallowRef<{ key: string, days: number, edge: 'start' | 'end' }>()
const drawing = shallowRef<{ x1: number, y1: number, x2: number, y2: number }>()
const color = (task: Task) => (task.listId !== undefined ? listColor.value.get(task.listId) : undefined) ?? 'var(--ui-primary)'
function barStyle(row: TimelineRow, bar: TimelineBar) {
    const p = preview.value?.key === bar.item.key ? preview.value : undefined
    const from = bar.from + (p?.edge === 'start' ? p.days : 0)
    const to = bar.to + (p ? p.days : 0)
    return {
        left: `${from * dw.value}px`,
        width: `${Math.max(3, (to - from) * dw.value)}px`,
        backgroundColor: `color-mix(in oklab, ${color(row.task)} 30%, transparent)`,
        borderColor: color(row.task),
    }
}
const pointX = (bar: TimelineBar) => (bar.from + (preview.value?.key === bar.item.key ? preview.value.days : 0)) * dw.value

function barDown(event: PointerEvent, row: TimelineRow, bar: TimelineBar, edge: 'start' | 'end') {
    if (event.button !== 0) return
    event.stopPropagation()
    const el = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-bar]')!
    const days = (e: PointerEvent) => Math.round((e.clientX - event.clientX) / dw.value)
    followPointer(event, e => (preview.value = {key: bar.item.key, days: days(e), edge}), (e, moved) => {
        preview.value = undefined
        if (!moved) return open(row.task.id, el)
        const d = days(e)
        if (d) emit('change', row.task.id, shiftTask(row.task, {days: d, minutes: 0, edge}))
    })
}

function linkDown(event: PointerEvent, row: TimelineRow, index: number) {
    if (event.button !== 0) return
    event.stopPropagation()
    const [x1, y1] = [extent(row)!.to * dw.value, rowY(index)]
    const at = (e: PointerEvent) => {
        const box = content.value!.getBoundingClientRect()
        return {x1, y1, x2: e.clientX - box.left - OUTLINE, y2: e.clientY - box.top}
    }
    followPointer(event, e => (drawing.value = at(e)), (e, moved) => {
        drawing.value = undefined
        if (!moved) return
        const id = document.elementsFromPoint(e.clientX, e.clientY)
            .map(el => (el as HTMLElement).closest<HTMLElement>('[data-row]')?.dataset.task)
            .find(t => t !== undefined)
        const target = id && props.document.tasks.find(t => t.id === id)
        if (target && target.id !== row.task.id && !target.dependsOn?.includes(row.task.id)) {
            emit('change', target.id, {dependsOn: [...target.dependsOn ?? [], row.task.id]})
        }
    })
}

// The editor, one at a time, beside what was clicked.
const editing = shallowRef<{ id: string, el: HTMLElement }>()
const editingTask = computed(() => editing.value && props.document.tasks.find(t => t.id === editing.value!.id && !t.deletedAt))
const open = (id: string, el: HTMLElement) => (props.editor ? (editing.value = {id, el}) : emit('open', id))
async function openWhenDrawn(id: string) {
    await nextTick()
    requestAnimationFrame(() => {
        const row = scroller.value?.querySelector<HTMLElement>(`[data-row][data-task="${CSS.escape(id)}"]`)
        const el = row?.querySelector<HTMLElement>('[data-bar]') ?? row?.querySelector<HTMLElement>('[data-title]')
        if (el) editing.value = {id, el}
    })
}
function create(task: Task) {
    emit('create', task)
    void openWhenDrawn(task.id)
}

// The menu of the task right-clicked (its bar or its row); elsewhere, none.
const menuTask = shallowRef<Task>()
function pick(event: MouseEvent) {
    const id = (event.target as HTMLElement).closest<HTMLElement>('[data-row]')?.dataset.task
    menuTask.value = id === undefined || !props.editor ? undefined : props.document.tasks.find(t => t.id === id)
    if (!menuTask.value) event.stopPropagation()
}
const menu = computed((): ContextMenuItem[][] => {
    const task = menuTask.value
    if (!task) return []
    const titles = new Map(props.document.tasks.map(t => [t.id, t.title]))
    const setList = (listId: string | undefined) => emit('change', task.id, {listId})
    const waits = task.dependsOn ?? []
    return [
        [
            {label: labels.value.edit, icon: 'i-lucide-pencil', onSelect: () => void openWhenDrawn(task.id)},
            {label: labels.value.duplicate, icon: 'i-lucide-copy', onSelect: () => emit('create', {...task, id: crypto.randomUUID(), updatedAt: now()})},
            {
                label: labels.value.list,
                icon: 'i-lucide-palette',
                children: [
                    {label: labels.value.noList, type: 'checkbox', checked: task.listId === undefined, onUpdateChecked: () => setList(undefined)},
                    ...lists.value.map(l => ({label: l.title, type: 'checkbox' as const, checked: task.listId === l.id, slot: 'list', swatch: l.color, onUpdateChecked: () => setList(l.id)})),
                ],
            },
        ],
        ...(waits.length ? [[
            {type: 'label' as const, label: labels.value.removeDependency},
            ...waits.map(id => ({
                label: titles.get(id) || id,
                icon: 'i-lucide-unlink',
                onSelect: () => emit('change', task.id, {dependsOn: waits.length > 1 ? waits.filter(w => w !== id) : undefined}),
            })),
        ]] : []),
        [{label: labels.value.delete, icon: 'i-lucide-trash-2', color: 'error', onSelect: () => emit('change', task.id, {deletedAt: now()})}],
    ]
})

// Opens at today, and goes back to it at a new scale.
const toToday = () => scroller.value?.scrollTo({left: nowX.value - 120})
onMounted(toToday)
watch(dw, () => void nextTick(toToday))
function setScale(next: Scale) {
    if (next !== scale.value) emit('changeView', {scale: next})
}
</script>

<template>
  <div class="tk:flex tk:h-full tk:min-h-0 tk:flex-col">
    <div class="tk:flex tk:items-center tk:gap-2 tk:border-b tk:border-default tk:px-3 tk:py-1.5">
      <UButton size="sm" variant="outline" color="neutral" :label="labels.today" @click="toToday" />
      <span class="tk:grow" />
      <UToggleGroup
        :items="(['day', 'week', 'month'] as const).map(s => ({value: s, label: labels[s]}))"
        size="sm"
        :model-value="scale"
        @update:model-value="(v: unknown) => (['day', 'week', 'month'] as const).includes(v as never) && setScale(v as Scale)"
      />
    </div>
    <UContextMenu :items="menu">
      <div ref="scroller" class="tk:relative tk:min-h-0 tk:flex-1 tk:overflow-auto tk:select-none" @contextmenu.capture="pick">
        <div ref="content" class="tk:relative tk:min-h-full" :style="{width: `${OUTLINE + width}px`, height: `${virtualizer.getTotalSize()}px`}">
          <div class="tk:sticky tk:top-0 tk:z-30 tk:flex tk:border-b tk:border-default tk:bg-default" :style="{height: `${HEADER}px`}">
            <div
              class="tk:sticky tk:start-0 tk:z-10 tk:flex tk:shrink-0 tk:items-end tk:gap-1 tk:whitespace-nowrap tk:border-e tk:border-default tk:bg-default tk:px-3 tk:pb-1.5 tk:text-xs tk:font-medium tk:text-muted"
              :style="{width: `${OUTLINE}px`}"
            >
              <span class="tk:flex-1">{{ labels.title }}</span>
              <span class="tk:w-14 tk:text-end">{{ labels.duration }}</span>
              <span class="tk:w-12 tk:text-end">{{ labels.fields.progress }}</span>
            </div>
            <div class="tk:relative tk:shrink-0 tk:text-xs" :style="{width: `${width}px`}">
              <div
                v-for="t in header.major"
                :key="`M${t.day}`"
                class="tk:absolute tk:top-0 tk:h-1/2 tk:border-s tk:border-default tk:px-2 tk:pt-1 tk:font-medium tk:text-highlighted"
                :style="{left: `${t.at * dw}px`, width: `${t.width * dw}px`}"
              >
                <span class="tk:sticky tk:inline-block tk:whitespace-nowrap" :style="{left: `${OUTLINE + 8}px`}">{{ t.label }}</span>
              </div>
              <div
                v-for="t in header.minor"
                :key="`m${t.day}`"
                class="tk:absolute tk:bottom-0 tk:h-1/2 tk:overflow-hidden tk:whitespace-nowrap tk:border-s tk:border-default tk:pt-1 tk:text-muted"
                :class="scale === 'day' ? 'tk:text-center' : 'tk:px-1.5'"
                :style="{left: `${t.at * dw}px`, width: `${t.width * dw}px`}"
              >{{ t.width * dw >= 28 ? t.label : '' }}</div>
            </div>
          </div>

          <div class="tk:pointer-events-none tk:absolute tk:inset-y-0" :style="{left: `${OUTLINE}px`, width: `${width}px`}">
            <div v-for="t in header.minor" :key="t.day.toString()" class="tk:absolute tk:inset-y-0 tk:border-s tk:border-default/60" :style="{left: `${t.at * dw}px`}" />
            <div class="tk:absolute tk:inset-y-0 tk:w-0.5 tk:bg-error" :style="{left: `${nowX}px`}" />
          </div>
          <svg
            class="tk:pointer-events-none tk:absolute tk:top-0 tk:overflow-visible tk:text-muted"
            :style="{left: `${OUTLINE}px`}"
            :width="width"
            :height="virtualizer.getTotalSize()"
          >
            <defs>
              <marker id="tk-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0L8 4L0 8z" fill="currentColor" />
              </marker>
            </defs>
            <path v-for="l in shownLinks" :key="l.key" :d="l.path" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#tk-arrow)" data-link />
            <line v-if="drawing" :x1="drawing.x1" :y1="drawing.y1" :x2="drawing.x2" :y2="drawing.y2" class="tk:text-primary" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3" />
          </svg>
          <!-- The outline column's background the whole way down, over the lines, under the rows. -->
          <div
            class="tk:pointer-events-none tk:sticky tk:start-0 tk:border-e tk:border-default tk:bg-default"
            :style="{width: `${OUTLINE}px`, height: `calc(100% - ${HEADER}px)`}"
          />

          <div
            v-for="item in virtualizer.getVirtualItems()"
            :key="String(item.key)"
            class="tk:group tk:absolute tk:start-0 tk:top-0 tk:flex"
            :style="{transform: `translateY(${item.start}px)`, height: `${ROW}px`, width: `${OUTLINE + width}px`}"
          >
            <template v-for="row in [rows[item.index]!]" :key="row.task.id">
              <div data-row :data-task="row.task.id" class="tk:flex tk:size-full">
                <div
                  class="tk:sticky tk:start-0 tk:z-20 tk:flex tk:shrink-0 tk:items-center tk:gap-1 tk:border-e tk:border-default tk:bg-default tk:pe-3 tk:text-sm tk:group-hover:bg-elevated"
                  :style="{width: `${OUTLINE}px`, paddingInlineStart: `${8 + row.depth * 16}px`}"
                >
                  <button
                    v-if="row.parent"
                    type="button"
                    class="tk:flex tk:size-5 tk:shrink-0 tk:items-center tk:justify-center tk:rounded tk:text-muted tk:hover:text-default"
                    :aria-expanded="!folded.has(row.task.id)"
                    data-fold
                    @click="fold(row.task.id)"
                  >
                    <UIcon :name="folded.has(row.task.id) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" class="tk:size-4" />
                  </button>
                  <span v-else class="tk:w-5 tk:shrink-0" />
                  <button
                    type="button"
                    data-title
                    class="tk:min-w-0 tk:flex-1 tk:truncate tk:text-start"
                    :class="[row.parent && 'tk:font-medium', isOpen(row.task, fields) ? 'tk:text-highlighted' : 'tk:text-muted tk:line-through']"
                    @click="open(row.task.id, $event.currentTarget as HTMLElement)"
                  >{{ row.task.title || labels.newTask }}</button>
                  <span class="tk:w-14 tk:shrink-0 tk:text-end tk:text-xs tk:tabular-nums tk:text-muted">{{ lengthText(row.length) }}</span>
                  <span class="tk:w-12 tk:shrink-0 tk:text-end tk:text-xs tk:tabular-nums tk:text-muted">{{ row.progress === undefined ? '' : `${Math.round(row.progress)}%` }}</span>
                </div>
                <!-- A closed task fades here, not in the outline, whose background hides what scrolls under it. -->
                <div class="tk:relative tk:shrink-0" :class="!isOpen(row.task, fields) && 'tk:opacity-60'" :style="{width: `${width}px`}">
                  <div
                    v-if="row.summary"
                    class="tk:absolute tk:top-[14px] tk:h-2 tk:overflow-hidden tk:rounded-sm tk:bg-inverted/25"
                    :style="{left: `${row.summary.from * dw}px`, width: `${Math.max(3, (row.summary.to - row.summary.from) * dw)}px`}"
                    data-summary
                  >
                    <div class="tk:h-full tk:bg-inverted/70" :style="{width: `${row.progress ?? 0}%`}" />
                  </div>
                  <template v-for="bar in row.bars" :key="bar.item.key">
                    <div
                      v-if="bar.item.kind === 'span'"
                      data-bar
                      :data-item="bar.item.key"
                      class="tk:absolute tk:top-2 tk:h-5 tk:cursor-grab tk:overflow-hidden tk:rounded tk:border"
                      :style="barStyle(row, bar)"
                      @pointerdown="barDown($event, row, bar, 'start')"
                    >
                      <div class="tk:h-full" :style="{width: `${row.progress ?? 0}%`, backgroundColor: color(row.task)}" />
                      <span class="tk:absolute tk:inset-y-0 tk:end-0 tk:w-1.5 tk:cursor-ew-resize" data-stretch @pointerdown="barDown($event, row, bar, 'end')" />
                    </div>
                    <div
                      v-else
                      data-bar
                      :data-item="bar.item.key"
                      class="tk:absolute tk:top-0 tk:flex tk:h-full tk:w-4 tk:-translate-x-1/2 tk:cursor-grab tk:items-center tk:justify-center"
                      :style="{left: `${pointX(bar)}px`}"
                      @pointerdown="barDown($event, row, bar, 'start')"
                    >
                      <UIcon v-if="bar.item.kind === 'due'" name="i-lucide-flag" class="tk:size-4" :style="{color: color(row.task)}" />
                      <span v-else class="tk:size-3 tk:rotate-45 tk:rounded-[2px]" :style="{backgroundColor: color(row.task)}" />
                    </div>
                  </template>
                  <span
                    v-for="(x, i) in row.dues"
                    :key="`due${i}`"
                    class="tk:pointer-events-none tk:absolute tk:top-1 tk:h-7 tk:w-0.5 tk:rounded tk:bg-error"
                    :style="{left: `${x * dw}px`}"
                  />
                  <template v-for="span in [extent(row)]" :key="0">
                    <template v-if="span">
                      <span
                        v-if="editor"
                        class="tk:absolute tk:top-[13px] tk:size-2.5 tk:cursor-crosshair tk:rounded-full tk:border-2 tk:border-primary tk:bg-default tk:opacity-0 tk:group-hover:opacity-100"
                        :style="{left: `${span.to * dw + 4}px`}"
                        data-link-from
                        @pointerdown="linkDown($event, row, item.index)"
                      />
                      <span
                        class="tk:pointer-events-none tk:absolute tk:inset-y-0 tk:flex tk:items-center tk:whitespace-nowrap tk:text-xs tk:text-muted"
                        :style="{left: `${span.to * dw + 20}px`}"
                      >{{ row.task.title }}</span>
                    </template>
                  </template>
                </div>
              </div>
            </template>
          </div>
          <div v-if="rows.length === 0" class="tk:sticky tk:start-0 tk:py-16 tk:text-center tk:text-sm tk:text-muted" :style="{width: `${OUTLINE}px`}">{{ labels.empty }}</div>
        </div>
      </div>
      <template #list-leading="{item}">
        <span class="tk:size-2.5 tk:shrink-0 tk:rounded-full" :style="{backgroundColor: (item as {swatch?: string}).swatch ?? 'var(--ui-primary)'}" />
      </template>
    </UContextMenu>
    <UPopover
      :open="!!editingTask"
      :reference="editing?.el"
      :content="{side: 'bottom', align: 'start', sideOffset: 6}"
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
