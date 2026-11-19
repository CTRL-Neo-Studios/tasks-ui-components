<script setup lang="ts">
/**
 * A timeline of a document: the outline on the left (each task's circle, title, duration and progress; subtasks under
 * their parent, folding), and on the right each task's times on an axis that zooms from months to hours: a span as a
 * solid bar in the task's colour with its title and people, a moment as a diamond, a due as a mark, a parent as a thin
 * line over its subtasks. Pinch or ⌘/Ctrl + scroll zooms around the pointer; the presets jump. One scroller: the
 * outline stays at the left, the header at the top, and only the rows and header cells on screen are drawn.
 *
 * A click selects a bar (⌘D duplicates it, ⌫ deletes it), a double click opens its editor; a drag moves it, or
 * stretches its end, by a day or, zoomed to hours, by a quarter hour; a drag from the dot after a bar to another row
 * says that row's task waits for it (`dependsOn`); a right click opens its menu. Dependency lines are faint except a
 * hovered or selected task's. Reports what the user does; writes nothing.
 */
import {type CalendarDate, DateFormatter, getLocalTimeZone, isSameDay, isWeekend, now as nowIn, today as todayIn} from '@internationalized/date'
import UButton from '@nuxt/ui/components/Button.vue'
import UCalendar from '@nuxt/ui/components/Calendar.vue'
import UContextMenu, {type ContextMenuItem} from '@nuxt/ui/components/ContextMenu.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import UPopover from '@nuxt/ui/components/Popover.vue'
import UToggleGroup from '@nuxt/ui/components/ToggleGroup.vue'
import {useVirtualizer} from '@tanstack/vue-virtual'
import {type FieldOption, isOpen, resolveFields, type Task, type TaskDocument, type View, viewTasks} from '@type32/tasks'
import {computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch} from 'vue'
import {DAY_MINUTES, shiftTask} from '../calendar'
import type {Patch, TaskPatch} from '../changes'
import {dayOf} from '../dates'
import {followPointer} from '../drag'
import {PALETTE} from '../fieldText'
import {type TaskLabels, useLabels} from '../labels'
import {assigneesOf, taskColor, textOn} from '../people'
import {clampZoom, linkPath, presetOf, scaleOf, tickUnit, timelineAxis, type TimelineBar, type TimelineRow, timelineRows, timelineTicks, viewZoom, ZOOM_PRESETS, type ZoomPreset} from '../timeline'
import PeopleStack from './PeopleStack.vue'
import TaskCheck from './TaskCheck.vue'
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
    /** Copy link in a task's menu, when the app has links to tasks. */
    copyLink?: (id: string) => void
}>(), {timeZone: undefined, locale: undefined, weekStartsOn: 1, labels: undefined, editor: true, copyLink: undefined})
const emit = defineEmits<{
    change: [id: string, patch: TaskPatch]
    create: [task: Task]
    /** A person added in a task's editor (`assignees`). */
    createOption: [field: string, option: FieldOption]
    /** The view's `zoom` (and the `scale` nearest it) changed here. */
    changeView: [patch: Patch<View>]
    /** A task clicked, with `editor` off. */
    open: [id: string]
}>()
defineSlots<{ notes?(props: { task: Task, text: string, update: (text: string) => void }): unknown }>()
const labels = useLabels(() => props.labels)

/** A row's height, the header's, the outline's width; in pixels. */
const ROW = 44
const HEADER = 56
const OUTLINE = 440

const zone = computed(() => props.timeZone ?? getLocalTimeZone())
const today = computed(() => todayIn(zone.value))
const minutesNow = ref(0)
const tick = () => {
    const now = nowIn(zone.value)
    minutesNow.value = now.hour * 60 + now.minute
}
tick()
const timer = setInterval(tick, 60_000)
const now = () => new Date().toISOString()

const fields = computed(() => resolveFields(props.document))
const lists = computed(() => (props.document.lists ?? []).filter(l => !l.deletedAt))
const listById = computed(() => new Map((props.document.lists ?? []).map(l => [l.id, l])))
const color = (task: Task) => taskColor(task, listById.value) ?? 'var(--ui-primary)'
const axis = computed(() => timelineAxis(viewTasks(props.document, props.view, fields.value), zone.value, today.value))
const days = computed(() => axis.value.to.compare(axis.value.from))

// The zoom, in pixels a day: the view's, followed here at once and written back once a gesture rests.
const zoom = ref(viewZoom(props.view))
const dw = computed(() => zoom.value)
watch(() => viewZoom(props.view), (z) => {
    if (!saving) zoom.value = z
})
const width = computed(() => days.value * dw.value)
const unit = computed(() => tickUnit(dw.value))
const nowX = computed(() => (today.value.compare(axis.value.from) + minutesNow.value / DAY_MINUTES) * dw.value)

const folded = shallowRef(new Set<string>())
function fold(id: string) {
    const next = new Set(folded.value)
    if (!next.delete(id)) next.add(id)
    folded.value = next
}
const rows = computed(() => timelineRows(props.document, props.view, fields.value, axis.value, folded.value))
const indexOf = computed(() => new Map(rows.value.map((r, i) => [r.task.id, i])))

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

// What's on screen of the axis, in days, with a screen either side: the header's cells and the weekends drawn.
const scroll = ref({left: 0, width: 1200})
let scrollFrame = 0
function scrolled() {
    cancelAnimationFrame(scrollFrame)
    scrollFrame = requestAnimationFrame(() => {
        const el = scroller.value
        if (el) scroll.value = {left: el.scrollLeft, width: el.clientWidth - OUTLINE}
    })
}
const range = computed((): [number, number] => {
    const {left, width: shown} = scroll.value
    return [(left - shown) / dw.value, (left + 2 * shown) / dw.value]
})

// The header's cells and their words, in the locale.
const locale = computed(() => props.locale ?? new Intl.DateTimeFormat().resolvedOptions().locale)
const formats = computed(() => {
    const f = (options: Intl.DateTimeFormatOptions) => new DateFormatter(locale.value, {...options, timeZone: 'UTC'})
    return {
        monthYear: f({month: 'long', year: 'numeric'}),
        year: f({year: 'numeric'}),
        dayLong: f({weekday: 'short', month: 'short', day: 'numeric'}),
        weekday: f({weekday: 'narrow'}),
        day: f({day: 'numeric'}),
        monthDay: f({month: 'short', day: 'numeric'}),
        month: f({month: 'short'}),
        monthLong: f({month: 'long'}),
        hour: f({hour: 'numeric'}),
    }
})
const header = computed(() => {
    const f = formats.value
    const date = (d: CalendarDate, hour = 0) => new Date(Date.UTC(d.year, d.month - 1, d.day, hour))
    const {major, minor} = timelineTicks(axis.value, dw.value, props.weekStartsOn, range.value)
    const top = unit.value === 'hour' ? f.dayLong : unit.value === 'month' ? f.year : f.monthYear
    return {
        major: major.map(t => ({...t, label: top.format(date(t.day))})),
        minor: minor.map(t => ({
            ...t,
            key: `${t.day}:${t.hour ?? ''}`,
            today: unit.value === 'day' && isSameDay(t.day, today.value),
            weekday: unit.value === 'day' ? f.weekday.format(date(t.day)) : '',
            label: unit.value === 'hour' ? f.hour.format(date(t.day, t.hour))
                : unit.value === 'day' ? f.day.format(date(t.day))
                    : unit.value === 'week' ? f.monthDay.format(date(t.day))
                        : (t.width * dw.value >= 72 ? f.monthLong : f.month).format(date(t.day)),
        })),
    }
})
// Weekends, shaded down the chart while days are wide enough to tell apart.
const weekends = computed(() => {
    if (unit.value === 'month') return []
    const [lo, hi] = range.value
    const out: number[] = []
    for (let i = Math.max(0, Math.floor(lo)); i < Math.min(days.value, Math.ceil(hi)); i++) {
        if (isWeekend(axis.value.from.add({days: i}), locale.value)) out.push(i)
    }
    return out
})

const units = computed(() => Object.fromEntries((['day', 'hour'] as const).map(u => [u, new Intl.NumberFormat(locale.value, {style: 'unit', unit: u, unitDisplay: 'long', maximumFractionDigits: 1})])))
const lengthText = (d: number | undefined) => (d === undefined ? '' : d < 1 ? units.value.hour!.format(d * 24) : units.value.day!.format(d))

// Zooming around a point (the pointer's, else the middle): the day under it stays under it.
let saving: ReturnType<typeof setTimeout> | undefined
function zoomAt(next: number, clientX?: number) {
    const el = scroller.value
    next = clampZoom(next)
    if (!el || next === zoom.value) return
    const x = clientX === undefined ? (el.clientWidth - OUTLINE) / 2 : clientX - el.getBoundingClientRect().left - OUTLINE
    const day = (el.scrollLeft + x) / zoom.value
    zoom.value = next
    void nextTick(() => {
        el.scrollLeft = day * next - x
        scrolled()
    })
    clearTimeout(saving)
    saving = setTimeout(() => {
        saving = undefined
        const z = Math.round(zoom.value * 100) / 100
        if (z !== props.view.zoom) emit('changeView', {zoom: z, scale: scaleOf(z)})
    }, 600)
}
// A trackpad's pinch comes as a wheel with Ctrl (Chromium) or as gesture events (WebKit); ⌘/Ctrl + wheel too.
let pinch = 1
let pinchAt = 0
let pinchFrame = 0
function wheel(e: WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    pinch *= Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01))
    pinchAt = e.clientX
    if (pinchFrame) return
    pinchFrame = requestAnimationFrame(() => {
        pinchFrame = 0
        zoomAt(zoom.value * pinch, pinchAt)
        pinch = 1
    })
}
type GestureEvent = UIEvent & { scale: number, clientX: number }
let gestureFrom = 0
const gestureStart = (e: Event) => {
    e.preventDefault()
    gestureFrom = zoom.value
}
const gestureChange = (e: Event) => {
    e.preventDefault()
    zoomAt(gestureFrom * (e as GestureEvent).scale, (e as GestureEvent).clientX)
}
const preset = computed(() => presetOf(zoom.value))
const presetItems = computed(() => (Object.keys(ZOOM_PRESETS) as ZoomPreset[]).map(p => ({value: p, label: labels.value[p]})))

const toToday = () => scroller.value?.scrollTo({left: nowX.value - (scroll.value.width / 3)})
const onResize = () => scrolled()
onMounted(() => {
    const el = scroller.value!
    el.addEventListener('wheel', wheel, {passive: false})
    el.addEventListener('gesturestart', gestureStart)
    el.addEventListener('gesturechange', gestureChange)
    window.addEventListener('resize', onResize)
    scrolled()
    void nextTick(toToday)
})
onBeforeUnmount(() => {
    clearInterval(timer)
    clearTimeout(saving)
    cancelAnimationFrame(scrollFrame)
    cancelAnimationFrame(pinchFrame)
    scroller.value?.removeEventListener('wheel', wheel)
    scroller.value?.removeEventListener('gesturestart', gestureStart)
    scroller.value?.removeEventListener('gesturechange', gestureChange)
    window.removeEventListener('resize', onResize)
})

/** What's drawn of a row, from its first time to its last: its bars, or its subtasks' stretch. */
function extent(row: TimelineRow) {
    if (row.bars.length === 0) return row.summary
    return {from: Math.min(...row.bars.map(b => b.from)), to: Math.max(...row.bars.map(b => b.to))}
}
const rowY = (index: number) => HEADER + index * ROW + ROW / 2
// Every dependency between rows, finish to start; those with a row on screen drawn, a hovered or selected task's
// strong, the rest faint.
const selected = ref<string>()
const hovered = ref<string>()
const links = computed(() => rows.value.flatMap((row, i) => {
    const to = extent(row)
    return !to ? [] : (row.task.dependsOn ?? []).flatMap((id) => {
        const j = indexOf.value.get(id)
        const from = j === undefined ? undefined : extent(rows.value[j]!)
        return !from ? [] : [{key: `${id}\u0000${row.task.id}`, ends: [id, row.task.id], lo: Math.min(i, j!), hi: Math.max(i, j!), path: linkPath(from.to * dw.value, rowY(j!), to.from * dw.value, rowY(i), ROW)}]
    })
}))
const shownLinks = computed(() => {
    const items = virtualizer.value.getVirtualItems()
    const [first, last] = [items[0]?.index ?? 0, items.at(-1)?.index ?? -1]
    const focus = [selected.value, hovered.value]
    return links.value.filter(l => l.hi >= first && l.lo <= last).map(l => ({...l, strong: l.ends.some(id => focus.includes(id))}))
})

// Moved and stretched bars (by days, fractions for minutes); a line drawn from a bar's dot.
const preview = shallowRef<{ key: string, days: number, edge: 'start' | 'end' }>()
const drawing = shallowRef<{ x1: number, y1: number, x2: number, y2: number }>()
function placed(bar: TimelineBar) {
    const p = preview.value?.key === bar.item.key ? preview.value : undefined
    return {from: bar.from + (p?.edge === 'start' ? p.days : 0), to: bar.to + (p ? p.days : 0)}
}
/** A bar's look: where it is, its colour, and whether its title fits in it (else it's written after it). */
function barOf(row: TimelineRow, bar: TimelineBar) {
    const {from, to} = placed(bar)
    const px = Math.max(6, (to - from) * dw.value)
    const people = assigneesOf(row.task, fields.value)
    const title = row.task.title || labels.value.newTask
    const fits = px >= 24 + Math.min(people.length, 3) * 14 + title.length * 7
    const fill = color(row.task)
    const left = from * dw.value
    // A bar running off the left keeps its people and title at the edge of what's shown, while there's room.
    const inset = Math.max(0, Math.min(scroll.value.left - left, px - 160))
    return {left, px, inset, people, title, fits, peopleFit: px >= 16 + Math.min(people.length, 3) * 14, fill, text: textOn(fill)}
}
const pointX = (bar: TimelineBar) => placed(bar).from * dw.value

function barDown(event: PointerEvent, row: TimelineRow, bar: TimelineBar, edge: 'start' | 'end') {
    if (event.button !== 0) return
    event.stopPropagation()
    // Zoomed to hours, a date-time task moves by quarter hours; anything else by days.
    const byMinutes = unit.value === 'hour' && (row.task.start ?? row.task.due ?? '').includes('T')
    const delta = (e: PointerEvent) => {
        const d = (e.clientX - event.clientX) / dw.value
        return byMinutes ? Math.round((d * DAY_MINUTES) / 15) * 15 / DAY_MINUTES : Math.round(d)
    }
    const el = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-bar]')!
    followPointer(event, e => (preview.value = {key: bar.item.key, days: delta(e), edge}), (e, moved) => {
        preview.value = undefined
        if (!moved) return props.editor ? void (selected.value = row.task.id) : open(row.task.id, el)
        const d = delta(e)
        if (!d) return
        const shift = byMinutes ? {days: 0, minutes: Math.round(d * DAY_MINUTES)} : {days: d, minutes: 0}
        emit('change', row.task.id, shiftTask(row.task, {...shift, edge}))
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
const shownEl = (id: string) => {
    const row = scroller.value?.querySelector<HTMLElement>(`[data-row][data-task="${CSS.escape(id)}"]`)
    return row?.querySelector<HTMLElement>('[data-bar]') ?? row?.querySelector<HTMLElement>('[data-title]') ?? undefined
}
async function openWhenDrawn(id: string) {
    await nextTick()
    requestAnimationFrame(() => {
        const el = shownEl(id)
        if (el) editing.value = {id, el}
    })
}
function create(task: Task) {
    emit('create', task)
    void openWhenDrawn(task.id)
}
const duplicate = (task: Task) => emit('create', {...task, id: crypto.randomUUID(), updatedAt: now()})
const remove = (task: Task) => {
    if (selected.value === task.id) selected.value = undefined
    emit('change', task.id, {deletedAt: now()})
}

// Reschedule: the whole task moved so its first day (its Do, else its Due) is the one picked.
const picking = shallowRef<{ task: Task, el: HTMLElement }>()
function reschedule(task: Task, to: CalendarDate) {
    const first = task.start ?? task.due
    if (first === undefined) return
    const by = to.compare(dayOf(first, task.timeZone, zone.value))
    if (by) emit('change', task.id, shiftTask(task, {days: by, minutes: 0, edge: 'start'}))
}

// The menu of the task right-clicked (its bar or its row); elsewhere, none.
const menuTask = shallowRef<Task>()
function pick(event: MouseEvent) {
    const id = (event.target as HTMLElement).closest<HTMLElement>('[data-row]')?.dataset.task
    menuTask.value = id === undefined || !props.editor ? undefined : props.document.tasks.find(t => t.id === id)
    if (!menuTask.value) event.stopPropagation()
    else selected.value = menuTask.value.id
}
const menu = computed((): ContextMenuItem[][] => {
    const task = menuTask.value
    if (!task) return []
    const titles = new Map(props.document.tasks.map(t => [t.id, t.title]))
    const setList = (listId: string | undefined) => emit('change', task.id, {listId})
    const waits = task.dependsOn ?? []
    const dated = task.start !== undefined || task.due !== undefined
    return [
        [{slot: 'swatches' as const, label: labels.value.color}],
        [
            {label: labels.value.edit, icon: 'i-lucide-pencil', onSelect: () => void openWhenDrawn(task.id)},
            {
                label: labels.value.reschedule,
                icon: 'i-lucide-calendar-clock',
                disabled: !dated,
                children: [
                    {label: labels.value.tomorrow, onSelect: () => reschedule(task, today.value.add({days: 1}))},
                    {label: labels.value.nextWeek, onSelect: () => reschedule(task, today.value.add({days: 7}))},
                    {label: labels.value.inTwoWeeks, onSelect: () => reschedule(task, today.value.add({days: 14}))},
                    {label: labels.value.pickDate, onSelect: () => void nextTick(() => {
                        const el = shownEl(task.id)
                        if (el) picking.value = {task, el}
                    })},
                ],
            },
            {label: labels.value.duplicate, icon: 'i-lucide-copy', kbds: ['meta', 'd'], onSelect: () => duplicate(task)},
            ...(props.copyLink ? [{label: labels.value.copyLink, icon: 'i-lucide-link', onSelect: () => props.copyLink!(task.id)}] : []),
            {
                label: labels.value.list,
                icon: 'i-lucide-list',
                children: [
                    {label: labels.value.noList, type: 'checkbox', checked: task.listId === undefined, onUpdateChecked: () => setList(undefined)},
                    ...lists.value.map(l => ({label: l.title, type: 'checkbox' as const, checked: task.listId === l.id, slot: 'list' as const, swatch: l.color, onUpdateChecked: () => setList(l.id)})),
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
        [{label: labels.value.delete, icon: 'i-lucide-trash-2', color: 'error', kbds: ['backspace'], onSelect: () => remove(task)}],
    ]
})

// The selected bar's keys: ⌘/Ctrl + D duplicates it, Backspace or Delete deletes it, Escape lets it go.
function key(e: KeyboardEvent) {
    const task = selected.value === undefined ? undefined : props.document.tasks.find(t => t.id === selected.value && !t.deletedAt)
    if (!task || !props.editor || (e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        duplicate(task)
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        remove(task)
    } else if (e.key === 'Escape') selected.value = undefined
}
</script>

<template>
  <div class="tk:flex tk:h-full tk:min-h-0 tk:flex-col">
    <div class="tk:flex tk:items-center tk:gap-2 tk:border-b tk:border-default tk:px-3 tk:py-1.5">
      <UButton size="sm" variant="outline" color="neutral" :label="labels.today" @click="toToday" />
      <span class="tk:grow" />
      <UToggleGroup
        :items="presetItems"
        size="sm"
        :model-value="preset"
        @update:model-value="(v: unknown) => typeof v === 'string' && v in ZOOM_PRESETS && zoomAt(ZOOM_PRESETS[v as ZoomPreset])"
      />
    </div>
    <UContextMenu :items="menu">
      <div
        ref="scroller"
        class="tk:relative tk:min-h-0 tk:flex-1 tk:overflow-auto tk:select-none tk:outline-none"
        tabindex="0"
        @scroll="scrolled"
        @keydown="key"
        @contextmenu.capture="pick"
        @pointerdown="selected = undefined"
      >
        <div ref="content" class="tk:relative tk:min-h-full" :style="{width: `${OUTLINE + width}px`, height: `${virtualizer.getTotalSize()}px`}">
          <div class="tk:sticky tk:top-0 tk:z-30 tk:flex tk:border-b tk:border-default tk:bg-default" :style="{height: `${HEADER}px`}">
            <div
              class="tk:sticky tk:start-0 tk:z-10 tk:flex tk:shrink-0 tk:items-end tk:gap-2 tk:whitespace-nowrap tk:border-e tk:border-default tk:bg-default tk:px-4 tk:pb-2 tk:text-sm tk:font-medium tk:text-highlighted"
              :style="{width: `${OUTLINE}px`}"
            >
              <span class="tk:flex-1">{{ labels.title }}</span>
              <span class="tk:w-20">{{ labels.duration }}</span>
              <span class="tk:w-32">{{ labels.fields.status }}</span>
            </div>
            <div class="tk:relative tk:shrink-0 tk:text-xs" :style="{width: `${width}px`}">
              <div
                v-for="t in header.major"
                :key="`M${t.day}`"
                class="tk:absolute tk:top-0 tk:h-1/2 tk:border-s tk:border-default tk:px-2 tk:pt-1.5 tk:text-muted"
                :style="{left: `${t.at * dw}px`, width: `${t.width * dw}px`}"
              >
                <span class="tk:sticky tk:inline-block tk:whitespace-nowrap" :style="{left: `${OUTLINE + 8}px`}">{{ t.label }}</span>
              </div>
              <div
                v-for="t in header.minor"
                :key="t.key"
                class="tk:absolute tk:bottom-0 tk:flex tk:h-1/2 tk:items-center tk:overflow-hidden tk:whitespace-nowrap"
                :class="unit === 'day' ? 'tk:justify-center' : 'tk:px-1.5 tk:border-s tk:border-default/60'"
                :style="{left: `${t.at * dw}px`, width: `${t.width * dw}px`}"
              >
                <span
                  v-if="unit === 'day' && t.width * dw >= 22"
                  class="tk:flex tk:items-baseline tk:gap-0.5 tk:rounded-full tk:px-1.5 tk:py-0.5 tk:tabular-nums"
                  :class="t.today ? 'tk:bg-primary tk:text-inverted' : 'tk:text-muted'"
                  :data-today="t.today || undefined"
                >
                  <span v-if="t.width * dw >= 34" class="tk:text-[10px]">{{ t.weekday }}</span>
                  <span class="tk:font-medium" :class="!t.today && 'tk:text-highlighted'">{{ t.label }}</span>
                </span>
                <span v-else-if="unit !== 'day' && t.width * dw >= 28" class="tk:text-muted">{{ t.label }}</span>
              </div>
            </div>
          </div>

          <div class="tk:pointer-events-none tk:absolute tk:inset-y-0" :style="{left: `${OUTLINE}px`, width: `${width}px`}">
            <div v-for="d in weekends" :key="`w${d}`" class="tk:absolute tk:inset-y-0 tk:bg-elevated/60" :style="{left: `${d * dw}px`, width: `${dw}px`}" />
            <div v-for="t in header.major" :key="`l${t.day}`" class="tk:absolute tk:inset-y-0 tk:border-s tk:border-default" :style="{left: `${t.at * dw}px`}" />
            <div class="tk:absolute tk:inset-y-0 tk:w-px tk:bg-error/70" :style="{left: `${nowX}px`}" />
          </div>
          <svg
            v-if="editor"
            class="tk:pointer-events-none tk:absolute tk:top-0 tk:overflow-visible"
            :style="{left: `${OUTLINE}px`}"
            :width="width"
            :height="virtualizer.getTotalSize()"
          >
            <defs>
              <marker id="tk-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0L8 4L0 8z" fill="context-stroke" />
              </marker>
            </defs>
            <path
              v-for="l in shownLinks"
              :key="l.key"
              :d="l.path"
              fill="none"
              stroke="currentColor"
              :stroke-width="l.strong ? 1.75 : 1.25"
              :class="l.strong ? 'tk:text-primary' : 'tk:text-muted tk:opacity-25'"
              marker-end="url(#tk-arrow)"
              data-link
            />
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
              <div data-row :data-task="row.task.id" class="tk:flex tk:size-full" @pointerenter="hovered = row.task.id" @pointerleave="hovered = undefined">
                <div
                  class="tk:sticky tk:start-0 tk:z-20 tk:flex tk:shrink-0 tk:items-center tk:border-e tk:border-default tk:bg-default tk:py-1 tk:pe-3"
                  :style="{width: `${OUTLINE}px`, paddingInlineStart: `${8 + row.depth * 20}px`}"
                >
                  <div
                    class="tk:flex tk:size-full tk:items-center tk:gap-2 tk:rounded-lg tk:px-2 tk:text-sm"
                    :class="row.parent ? 'tk:bg-elevated tk:group-hover:bg-accented/70' : 'tk:group-hover:bg-elevated/60'"
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
                    <TaskCheck v-else class="tk:mt-0" :task="row.task" :fields="fields" :disabled="!editor" @change="(patch: TaskPatch) => emit('change', row.task.id, patch)" />
                    <button
                      type="button"
                      data-title
                      class="tk:min-w-0 tk:flex-1 tk:truncate tk:text-start"
                      :class="[row.parent && 'tk:font-semibold', isOpen(row.task, fields) ? 'tk:text-highlighted' : 'tk:text-muted tk:line-through']"
                      @click="open(row.task.id, $event.currentTarget as HTMLElement)"
                    >{{ row.task.title || labels.newTask }}</button>
                    <span class="tk:w-20 tk:shrink-0 tk:text-muted tk:tabular-nums">{{ lengthText(row.length) }}</span>
                    <span class="tk:flex tk:w-32 tk:shrink-0 tk:items-center tk:gap-2" data-progress>
                      <template v-if="row.progress !== undefined">
                        <span class="tk:h-1.5 tk:flex-1 tk:overflow-hidden tk:rounded-full tk:bg-accented">
                          <span class="tk:block tk:h-full tk:rounded-full" :style="{width: `${row.progress}%`, backgroundColor: row.parent ? 'var(--ui-primary)' : color(row.task)}" />
                        </span>
                        <span class="tk:w-9 tk:text-end tk:text-xs tk:tabular-nums tk:text-muted">{{ Math.round(row.progress) }}%</span>
                      </template>
                    </span>
                  </div>
                </div>
                <!-- A closed task fades here, not in the outline, whose background hides what scrolls under it. -->
                <div class="tk:relative tk:shrink-0" :class="!isOpen(row.task, fields) && 'tk:opacity-60'" :style="{width: `${width}px`}">
                  <template v-if="row.summary">
                    <div
                      class="tk:absolute tk:top-1/2 tk:h-1 tk:-translate-y-1/2 tk:rounded-full tk:bg-accented"
                      :style="{left: `${row.summary.from * dw}px`, width: `${Math.max(4, (row.summary.to - row.summary.from) * dw)}px`}"
                      data-summary
                    />
                    <span
                      class="tk:pointer-events-none tk:absolute tk:inset-y-0 tk:flex tk:items-center tk:whitespace-nowrap tk:text-sm tk:text-muted"
                      :style="{left: `${row.summary.to * dw + 10}px`}"
                    >{{ row.task.title }}</span>
                  </template>
                  <template v-for="bar in row.bars" :key="bar.item.key">
                    <template v-if="bar.item.kind === 'span'">
                      <template v-for="b in [barOf(row, bar)]" :key="0">
                        <div
                          data-bar
                          :data-item="bar.item.key"
                          class="tk:absolute tk:inset-y-1.5 tk:flex tk:cursor-grab tk:items-center tk:gap-1.5 tk:overflow-hidden tk:rounded-lg tk:px-1.5 tk:shadow-xs"
                          :class="selected === row.task.id && 'tk:ring-2 tk:ring-(--ui-text-highlighted) tk:ring-offset-1 tk:ring-offset-(--ui-bg)'"
                          :style="{left: `${b.left}px`, width: `${b.px}px`, paddingInlineStart: `${6 + b.inset}px`, backgroundColor: b.fill, color: b.text}"
                          @pointerdown="barDown($event, row, bar, 'start')"
                          @dblclick="open(row.task.id, $event.currentTarget as HTMLElement)"
                        >
                          <PeopleStack v-if="b.peopleFit" :people="b.people" :size="22" />
                          <span v-if="b.fits" class="tk:min-w-0 tk:truncate tk:text-sm tk:font-medium">{{ b.title }}</span>
                          <span class="tk:absolute tk:inset-y-0 tk:end-0 tk:w-2 tk:cursor-ew-resize" data-stretch @pointerdown="barDown($event, row, bar, 'end')" />
                        </div>
                        <span
                          v-if="!b.fits"
                          class="tk:pointer-events-none tk:absolute tk:inset-y-0 tk:flex tk:items-center tk:whitespace-nowrap tk:text-sm tk:text-default"
                          :style="{left: `${b.left + b.px + 8}px`}"
                        >{{ b.title }}</span>
                      </template>
                    </template>
                    <template v-else>
                      <div
                        data-bar
                        :data-item="bar.item.key"
                        class="tk:absolute tk:top-0 tk:flex tk:h-full tk:w-5 tk:-translate-x-1/2 tk:cursor-grab tk:items-center tk:justify-center"
                        :style="{left: `${pointX(bar)}px`}"
                        @pointerdown="barDown($event, row, bar, 'start')"
                        @dblclick="open(row.task.id, $event.currentTarget as HTMLElement)"
                      >
                        <UIcon v-if="bar.item.kind === 'due'" name="i-lucide-flag" class="tk:size-4" :style="{color: color(row.task)}" />
                        <span
                          v-else
                          class="tk:size-3.5 tk:rotate-45 tk:rounded-[3px]"
                          :class="selected === row.task.id && 'tk:ring-2 tk:ring-(--ui-text-highlighted)'"
                          :style="{backgroundColor: color(row.task)}"
                        />
                      </div>
                      <span
                        class="tk:pointer-events-none tk:absolute tk:inset-y-0 tk:flex tk:items-center tk:whitespace-nowrap tk:text-sm tk:text-default"
                        :style="{left: `${pointX(bar) + 14}px`}"
                      >{{ row.task.title }}</span>
                    </template>
                  </template>
                  <span
                    v-for="(x, i) in row.dues"
                    :key="`due${i}`"
                    class="tk:pointer-events-none tk:absolute tk:inset-y-1 tk:w-0.5 tk:rounded tk:bg-error"
                    :style="{left: `${x * dw}px`}"
                  />
                  <template v-for="span in [extent(row)]" :key="0">
                    <span
                      v-if="span && editor && !row.summary"
                      class="tk:absolute tk:top-1/2 tk:size-2.5 tk:-translate-y-1/2 tk:cursor-crosshair tk:rounded-full tk:border-2 tk:border-primary tk:bg-default tk:opacity-0 tk:group-hover:opacity-100"
                      :style="{left: `${span.to * dw + 4}px`}"
                      data-link-from
                      @pointerdown="linkDown($event, row, item.index)"
                    />
                  </template>
                </div>
              </div>
            </template>
          </div>
          <div v-if="rows.length === 0" class="tk:sticky tk:start-0 tk:py-16 tk:text-center tk:text-sm tk:text-muted" :style="{width: `${OUTLINE}px`}">{{ labels.empty }}</div>
        </div>
      </div>
      <template #swatches>
        <div class="tk:flex tk:items-center tk:gap-2 tk:px-1 tk:py-1" data-swatches>
          <button
            v-for="c in PALETTE"
            :key="c"
            type="button"
            class="tk:size-5 tk:rounded-full tk:ring-offset-2 tk:ring-offset-(--ui-bg)"
            :class="menuTask?.color === c && 'tk:ring-2 tk:ring-(--ui-text-highlighted)'"
            :style="{backgroundColor: c}"
            :title="c"
            :data-swatch="c"
            @pointerup.stop="menuTask && emit('change', menuTask.id, {color: c})"
          />
          <button
            type="button"
            class="tk:flex tk:size-5 tk:items-center tk:justify-center tk:rounded-full tk:text-muted tk:hover:text-default"
            :title="labels.noColor"
            @pointerup.stop="menuTask && emit('change', menuTask.id, {color: undefined})"
          >
            <UIcon name="i-lucide-circle-slash" class="tk:size-4" />
          </button>
        </div>
      </template>
      <template #list-leading="{item}">
        <span class="tk:size-2.5 tk:shrink-0 tk:rounded-full" :style="{backgroundColor: (item as {swatch?: string}).swatch ?? 'var(--ui-primary)'}" />
      </template>
    </UContextMenu>
    <UPopover
      :open="!!picking"
      :reference="picking?.el"
      :content="{side: 'bottom', align: 'start', sideOffset: 6}"
      @update:open="(o: boolean) => !o && (picking = undefined)"
    >
      <template #content>
        <UCalendar
          v-if="picking"
          class="tk:p-2"
          :default-value="today"
          :week-starts-on="weekStartsOn"
          @update:model-value="(d: unknown) => { if (d && picking) reschedule(picking.task, d as CalendarDate); picking = undefined }"
        />
      </template>
    </UPopover>
    <UPopover
      :open="!!editingTask"
      :reference="editing?.el"
      :content="{side: 'bottom', align: 'start', sideOffset: 6}"
      @update:open="(o: boolean) => !o && (editing = undefined)"
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
            @create-option="(field: string, option: FieldOption) => emit('createOption', field, option)"
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
