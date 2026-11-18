<script setup lang="ts">
/**
 * Days in columns of hours (a week, or one day): their dates across the top, a row of what's all day or runs across
 * days beneath, then each day's timed tasks as blocks, packed side by side where they overlap, and a line at now.
 * Opens at 7 in the morning. Pointers on items and on empty hours go to the calendar.
 */
import {type CalendarDate, DateFormatter} from '@internationalized/date'
import UIcon from '@nuxt/ui/components/Icon.vue'
import {type Fields, isOpen, type List} from '@type32/tasks'
import {computed, onMounted, useTemplateRef} from 'vue'
import {type CalendarItem, layoutDay, layoutLanes, MIN_MINUTES} from '../calendar'
import {formatClock} from '../dates'
import {HOUR_PX, type Preview} from '../drag'

const props = defineProps<{
    days: CalendarDate[]
    items: CalendarItem[]
    today: CalendarDate
    /** Minutes into today, for the line at now. */
    now: number
    fields: Fields
    lists: Map<string, List>
    locale?: string
    preview?: Preview
}>()
const emit = defineEmits<{
    itemDown: [event: PointerEvent, item: CalendarItem, edge: 'start' | 'end']
    gridDown: [event: PointerEvent, day: CalendarDate]
    gridCreate: [event: MouseEvent, day: CalendarDate]
}>()

const LANE = 22
const PX = HOUR_PX / 60
const lanes = computed(() => layoutLanes(props.items.filter(i => i.allDay), props.days))
const laneCount = computed(() => lanes.value.reduce((n, l) => Math.max(n, l.lane + 1), 1))
const columns = computed(() => props.days.map(day => layoutDay(props.items.filter(i => !i.allDay && i.startDay.compare(day) === 0))))
const template = computed(() => ({gridTemplateColumns: `4.5rem repeat(${props.days.length}, minmax(0, 1fr))`}))

const locale = computed(() => props.locale ?? new Intl.DateTimeFormat().resolvedOptions().locale)
const weekday = computed(() => new DateFormatter(locale.value, {weekday: 'short', timeZone: 'UTC'}))
const color = (item: CalendarItem) => (item.task.listId !== undefined ? props.lists.get(item.task.listId)?.color : undefined)
const tint = (item: CalendarItem, amount: number) => `color-mix(in oklab, ${color(item) ?? 'var(--ui-primary)'} ${amount}%, transparent)`

/** A block's place and size, a drag's shift drawn on it while it lasts. */
function blockStyle(top: number, height: number, left: number, width: number, item: CalendarItem) {
    const p = props.preview
    const moving = p?.item?.key === item.key
    const grow = moving && p.edge === 'end' ? p.minutes : 0
    return {
        top: `${top * PX + 1}px`,
        height: `${Math.max(MIN_MINUTES, height + grow) * PX - 2}px`,
        insetInlineStart: `calc(${left}% + 1px)`,
        width: `calc(${width}% - 2px)`,
        ...(moving && p.edge === 'start' && {transform: `translate(${p.days * p.columnWidth}px, ${p.minutes * PX}px)`, zIndex: 10}),
        backgroundColor: tint(item, 22),
        borderInlineStartColor: color(item) ?? 'var(--ui-primary)',
    }
}

const scroller = useTemplateRef<HTMLElement>('scroller')
onMounted(() => scroller.value?.scrollTo({top: 7 * HOUR_PX}))
</script>

<template>
  <!-- One scroller with the dates and the all-day row stuck at its top: they're as wide as the hours under them,
       scrollbar or not. -->
  <div ref="scroller" class="tk:h-full tk:min-h-0 tk:overflow-y-auto tk:select-none">
    <div class="tk:sticky tk:top-0 tk:z-20 tk:bg-default">
    <div class="tk:grid tk:border-b tk:border-default" :style="template">
      <span />
      <div v-for="day in days" :key="day.toString()" class="tk:flex tk:items-baseline tk:gap-1.5 tk:px-2 tk:py-1.5 tk:text-sm">
        <span class="tk:text-xs tk:text-muted">{{ weekday.format(day.toDate('UTC')) }}</span>
        <span
          class="tk:inline-flex tk:size-6 tk:items-center tk:justify-center tk:rounded-full"
          :class="day.compare(today) === 0 ? 'tk:bg-primary tk:font-semibold tk:text-inverted' : 'tk:text-highlighted'"
        >{{ day.day }}</span>
      </div>
    </div>
    <div class="tk:grid tk:border-b tk:border-default" :style="template">
      <span />
      <div class="tk:relative" :style="{gridColumn: `span ${days.length}`, height: `${laneCount * LANE + 6}px`}">
        <div
          v-for="(day, i) in days"
          :key="day.toString()"
          :data-date="day.toString()"
          class="tk:absolute tk:inset-y-0 tk:border-s tk:border-default"
          :style="{left: `${i * 100 / days.length}%`, width: `${100 / days.length}%`}"
        />
        <div
          v-for="l in lanes"
          :key="l.item.key"
          :data-item="l.item.key"
          :data-task="l.item.task.id"
          class="tk:absolute tk:flex tk:h-5 tk:items-center tk:gap-1 tk:overflow-hidden tk:rounded tk:px-1.5 tk:text-xs tk:text-highlighted"
          :class="[!isOpen(l.item.task, fields) && 'tk:line-through tk:opacity-60', preview?.item?.key === l.item.key && 'tk:opacity-40']"
          :style="{
            left: `calc(${l.column * 100 / days.length}% + 2px)`,
            width: `calc(${l.span * 100 / days.length}% - 4px)`,
            top: `${3 + l.lane * LANE}px`,
            backgroundColor: tint(l.item, 22),
          }"
          @pointerdown="emit('itemDown', $event, l.item, 'start')"
        >
          <UIcon v-if="l.item.kind === 'due'" name="i-lucide-flag" class="tk:size-3 tk:shrink-0" />
          <span class="tk:truncate">{{ l.item.task.title }}</span>
          <span
            v-if="l.item.kind === 'span' && !l.item.timed"
            class="tk:absolute tk:inset-y-0 tk:end-0 tk:w-1.5 tk:cursor-ew-resize"
            @pointerdown.stop="emit('itemDown', $event, l.item, 'end')"
          />
        </div>
      </div>
    </div>
    </div>
      <div class="tk:grid" :style="template">
        <div class="tk:relative" :style="{height: `${24 * HOUR_PX}px`}">
          <span
            v-for="hour in 23"
            :key="hour"
            class="tk:absolute tk:end-2 tk:-translate-y-1/2 tk:whitespace-nowrap tk:text-[11px] tk:text-muted"
            :style="{top: `${hour * HOUR_PX}px`}"
          >{{ formatClock(hour * 60, locale) }}</span>
        </div>
        <div
          v-for="(day, i) in days"
          :key="day.toString()"
          :data-date="day.toString()"
          data-day-column
          class="tk:relative tk:border-s tk:border-default"
          :style="{height: `${24 * HOUR_PX}px`}"
          @pointerdown="emit('gridDown', $event, day)"
          @dblclick="emit('gridCreate', $event, day)"
        >
          <div v-for="hour in 23" :key="hour" class="tk:pointer-events-none tk:absolute tk:inset-x-0 tk:border-t tk:border-default" :style="{top: `${hour * HOUR_PX}px`}" />
          <div
            v-for="p in columns[i]"
            :key="p.item.key"
            :data-item="p.item.key"
            :data-task="p.item.task.id"
            class="tk:absolute tk:flex tk:flex-col tk:overflow-hidden tk:rounded tk:border-s-2 tk:px-1.5 tk:py-0.5 tk:text-xs tk:text-highlighted"
            :class="!isOpen(p.item.task, fields) && 'tk:line-through tk:opacity-60'"
            :style="blockStyle(p.top, p.height, p.left, p.width, p.item)"
            @pointerdown="emit('itemDown', $event, p.item, 'start')"
          >
            <span class="tk:flex tk:items-center tk:gap-1 tk:truncate tk:font-medium">
              <UIcon v-if="p.item.kind === 'due'" name="i-lucide-flag" class="tk:size-3 tk:shrink-0" />
              {{ p.item.task.title }}
            </span>
            <span class="tk:text-muted">{{ formatClock(p.item.startMin, locale) }}</span>
            <span
              v-if="p.item.kind === 'span'"
              class="tk:absolute tk:inset-x-0 tk:bottom-0 tk:h-1.5 tk:cursor-ns-resize"
              @pointerdown.stop="emit('itemDown', $event, p.item, 'end')"
            />
          </div>
          <div
            v-if="preview?.draft && preview.draft.day.compare(day) === 0"
            class="tk:pointer-events-none tk:absolute tk:inset-x-1 tk:rounded tk:border tk:border-primary tk:bg-primary/15"
            :style="{top: `${preview.draft.start * PX}px`, height: `${(preview.draft.end - preview.draft.start) * PX}px`}"
          />
          <div v-if="day.compare(today) === 0" class="tk:pointer-events-none tk:absolute tk:inset-x-0 tk:h-0.5 tk:bg-error" :style="{top: `${now * PX}px`}">
            <span class="tk:absolute tk:-start-1 tk:-top-1 tk:size-2.5 tk:rounded-full tk:bg-error" />
          </div>
        </div>
      </div>
  </div>
</template>
