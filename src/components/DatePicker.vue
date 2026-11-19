<script setup lang="ts">
/**
 * A task time as a button that opens a calendar: `2026-11-18`, or with `allowTime` `2026-11-18T09:30` too. Picking a
 * day keeps the time of day; Clear removes it (`undefined`).
 */
import {type CalendarDate, type DateValue, Time, toCalendarDate} from '@internationalized/date'
import UButton from '@nuxt/ui/components/Button.vue'
import UCalendar from '@nuxt/ui/components/Calendar.vue'
import UInputTime from '@nuxt/ui/components/InputTime.vue'
import UPopover from '@nuxt/ui/components/Popover.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import {computed} from 'vue'
import {formatTime, fromDateValue, toDateValue} from '../dates'
import {useLabels} from '../labels'

const props = defineProps<{
    modelValue?: string
    /** Before the date on the button (`Do`), and alone while there's none. */
    label: string
    icon: string
    allowTime?: boolean
    today: CalendarDate
    locale?: string
    /** 0 is Sunday. */
    weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6
    /** Drawn as a problem (an overdue due). */
    late?: boolean
    /** What the date means, on hover. */
    tip?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string | undefined] }>()
const labels = useLabels(() => undefined)

const value = computed(() => (props.modelValue === undefined ? undefined : toDateValue(props.modelValue)))
const day = computed(() => value.value && toCalendarDate(value.value))
const time = computed(() => (value.value && 'hour' in value.value ? new Time(value.value.hour, value.value.minute) : undefined))

function pick(picked: DateValue | undefined) {
    if (!picked) return
    const date = toCalendarDate(picked)
    const current = value.value
    emit('update:modelValue', fromDateValue(current && 'hour' in current ? current.set({year: date.year, month: date.month, day: date.day}) : date))
}

function setTime(next: Time | undefined) {
    if (!next) return
    const date = (day.value ?? props.today).toString()
    emit('update:modelValue', `${date}T${String(next.hour).padStart(2, '0')}:${String(next.minute).padStart(2, '0')}`)
}

const toggleTime = () => (time.value
    ? emit('update:modelValue', (day.value ?? props.today).toString())
    : setTime(new Time(9, 0)))
</script>

<template>
  <UPopover>
    <UTooltip :text="tip" :disabled="!tip">
      <UButton
        :icon="icon"
        size="sm"
        variant="ghost"
        :color="late ? 'error' : 'neutral'"
        :class="modelValue === undefined && 'tk:text-muted'"
      >
        {{ modelValue === undefined ? label : `${label} ${formatTime(modelValue, locale, today)}` }}
      </UButton>
    </UTooltip>
    <template #content>
      <div class="tk:flex tk:flex-col tk:gap-2 tk:p-2">
        <UCalendar :model-value="day" :week-starts-on="weekStartsOn" @update:model-value="pick($event as DateValue | undefined)" />
        <div class="tk:flex tk:items-center tk:gap-2">
          <UInputTime v-if="allowTime && time" :model-value="time" size="sm" @update:model-value="setTime($event as Time | undefined)" />
          <UButton v-if="allowTime" size="xs" variant="ghost" color="neutral" @click="toggleTime">
            {{ time ? labels.removeTime : labels.addTime }}
          </UButton>
          <UButton v-if="modelValue !== undefined" size="xs" variant="ghost" color="neutral" class="tk:ms-auto" @click="emit('update:modelValue', undefined)">
            {{ labels.clear }}
          </UButton>
        </div>
      </div>
    </template>
  </UPopover>
</template>
