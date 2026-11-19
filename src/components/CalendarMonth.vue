<script setup lang="ts">
/**
 * Six weeks of days, each week a row of lanes: a span across its days, anything else in its day; what doesn't fit a
 * cell is counted at its foot (a click shows that day). Pointers on items and days go to the calendar.
 */
import {type CalendarDate, DateFormatter} from '@internationalized/date'
import UIcon from '@nuxt/ui/components/Icon.vue'
import {type Fields, isOpen, type List} from '@type32/tasks'
import {computed, ref, useTemplateRef} from 'vue'
import {type CalendarItem, layoutLanes} from '../calendar'
import {formatClock} from '../dates'
import type {Preview} from '../drag'
import {useResizeObserver} from '../observe'
import {taskColor} from '../people'

const props = defineProps<{
    weeks: CalendarDate[][]
    items: CalendarItem[]
    month: number
    today: CalendarDate
    fields: Fields
    lists: Map<string, List>
    locale?: string
    preview?: Preview
}>()
const emit = defineEmits<{
    itemDown: [event: PointerEvent, item: CalendarItem, edge: 'start' | 'end']
    dayOpen: [day: CalendarDate]
    dayCreate: [day: CalendarDate]
}>()

const HEADER = 26
const LANE = 22
const grid = useTemplateRef<HTMLElement>('grid')
const rowHeight = ref(120)
useResizeObserver(grid, (box) => (rowHeight.value = box.height / 6))
/** Lanes a cell has room for, a line kept for "+N" when some don't fit. */
const room = computed(() => Math.max(0, Math.floor((rowHeight.value - HEADER - 18) / LANE)))

const rows = computed(() => props.weeks.map((days) => {
    const laned = layoutLanes(props.items, days)
    const shown = laned.filter(l => l.lane < room.value)
    const hidden = days.map((_, column) => laned.filter(l => l.lane >= room.value && column >= l.column && column < l.column + l.span).length)
    return {days, shown, hidden}
}))

const weekday = computed(() => new DateFormatter(props.locale ?? new Intl.DateTimeFormat().resolvedOptions().locale, {weekday: 'short', timeZone: 'UTC'}))
/** Shifted by the drag over it: the days a dragged item would take. */
function previewed(day: CalendarDate) {
    const p = props.preview
    if (!p?.item) return false
    const start = p.edge === 'start' ? p.item.startDay.add({days: p.days}) : p.item.startDay
    const end = p.item.endDay.add({days: p.days})
    return day.compare(start) >= 0 && day.compare(end) <= 0
}
const color = (item: CalendarItem) => taskColor(item.task, props.lists)
</script>

<template>
  <div class="tk:flex tk:h-full tk:min-h-0 tk:flex-col">
    <div class="tk:grid tk:grid-cols-7 tk:border-b tk:border-default">
      <div v-for="day in weeks[0]" :key="day.toString()" class="tk:px-2 tk:py-1.5 tk:text-xs tk:font-medium tk:text-muted">
        {{ weekday.format(day.toDate('UTC')) }}
      </div>
    </div>
    <div ref="grid" class="tk:grid tk:min-h-0 tk:flex-1 tk:grid-rows-6">
      <div v-for="row in rows" :key="row.days[0]!.toString()" class="tk:relative tk:grid tk:min-h-0 tk:grid-cols-7 tk:border-b tk:border-default">
        <div
          v-for="(day, column) in row.days"
          :key="day.toString()"
          :data-date="day.toString()"
          class="tk:relative tk:border-e tk:border-default tk:last:border-e-0"
          :class="[day.month !== month && 'tk:bg-elevated/40', previewed(day) && 'tk:bg-primary/10']"
          @dblclick="emit('dayCreate', day)"
        >
          <span
            class="tk:m-1 tk:inline-flex tk:size-6 tk:items-center tk:justify-center tk:rounded-full tk:text-xs"
            :class="day.compare(today) === 0 ? 'tk:bg-primary tk:font-semibold tk:text-inverted' : day.month === month ? 'tk:text-default' : 'tk:text-dimmed'"
          >{{ day.day }}</span>
          <button
            v-if="row.hidden[column]"
            type="button"
            class="tk:absolute tk:inset-x-1 tk:bottom-0.5 tk:truncate tk:rounded tk:px-1 tk:text-start tk:text-xs tk:text-muted tk:hover:bg-elevated"
            @click="emit('dayOpen', day)"
          >
            +{{ row.hidden[column] }}
          </button>
        </div>
        <div
          v-for="l in row.shown"
          :key="l.item.key"
          :data-item="l.item.key"
          :data-task="l.item.task.id"
          class="tk:group tk:absolute tk:flex tk:h-5 tk:cursor-default tk:items-center tk:gap-1 tk:overflow-hidden tk:rounded tk:px-1.5 tk:text-xs tk:select-none"
          :class="[
            l.item.allDay ? 'tk:text-highlighted' : 'tk:text-default tk:hover:bg-elevated',
            !isOpen(l.item.task, fields) && 'tk:line-through tk:opacity-60',
            preview?.item?.key === l.item.key && 'tk:opacity-40',
          ]"
          :style="{
            left: `calc(${l.column * 100 / 7}% + 2px)`,
            width: `calc(${l.span * 100 / 7}% - 4px)`,
            top: `${HEADER + 4 + l.lane * LANE}px`,
            ...(l.item.allDay && {backgroundColor: `color-mix(in oklab, ${color(l.item) ?? 'var(--ui-primary)'} 22%, transparent)`}),
          }"
          @pointerdown="emit('itemDown', $event, l.item, 'start')"
        >
          <UIcon v-if="l.item.kind === 'due'" name="i-lucide-flag" class="tk:size-3 tk:shrink-0" />
          <span v-else-if="!l.item.allDay" class="tk:size-2 tk:shrink-0 tk:rounded-full tk:bg-primary" :style="color(l.item) && {backgroundColor: color(l.item)}" />
          <span v-if="l.item.timed && l.item.startDay.compare(row.days[l.column]!) === 0" class="tk:shrink-0 tk:text-muted">
            {{ formatClock(l.item.startMin, locale) }}
          </span>
          <span class="tk:truncate">{{ l.item.task.title }}</span>
          <span
            v-if="l.item.allDay && l.item.kind === 'span' && !l.item.timed"
            class="tk:absolute tk:inset-y-0 tk:end-0 tk:w-1.5 tk:cursor-ew-resize"
            @pointerdown.stop="emit('itemDown', $event, l.item, 'end')"
          />
        </div>
      </div>
    </div>
  </div>
</template>
