<script setup lang="ts">
/** A task's value for one field, by the field's type; emptied, `undefined`. */
import type {CalendarDate} from '@internationalized/date'
import UInput from '@nuxt/ui/components/Input.vue'
import UInputNumber from '@nuxt/ui/components/InputNumber.vue'
import USelectMenu from '@nuxt/ui/components/SelectMenu.vue'
import USwitch from '@nuxt/ui/components/Switch.vue'
import type {FieldValue, ResolvedField, TaskDocument} from '@type32/tasks'
import {computed} from 'vue'
import {optionTitle} from '../fieldText'
import {useLabels} from '../labels'
import DatePicker from './DatePicker.vue'

const props = defineProps<{
    field: ResolvedField
    value?: FieldValue
    document: TaskDocument
    today: CalendarDate
    locale?: string
    weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6
}>()
const emit = defineEmits<{ update: [value: FieldValue | undefined] }>()
const labels = useLabels(() => undefined)

const items = computed(() => props.field.options
    .filter(o => !o.deleted || o.id === props.value || (Array.isArray(props.value) && props.value.includes(o.id)))
    .map(o => ({label: optionTitle(props.document, props.field, o, labels.value), value: o.id})))
const text = (v: string | undefined) => emit('update', v ? v : undefined)
</script>

<template>
  <UInput
    v-if="field.type === 'text' || field.type === 'url'"
    :model-value="typeof value === 'string' ? value : ''"
    :type="field.type === 'url' ? 'url' : 'text'"
    size="sm"
    variant="soft"
    @update:model-value="text(String($event))"
  />
  <UInputNumber
    v-else-if="field.type === 'number'"
    :model-value="typeof value === 'number' ? value : undefined"
    :min="field.min"
    :max="field.max"
    size="sm"
    variant="soft"
    @update:model-value="emit('update', typeof $event === 'number' && Number.isFinite($event) ? $event : undefined)"
  />
  <USwitch v-else-if="field.type === 'boolean'" :model-value="value === true" @update:model-value="emit('update', $event ? true : undefined)" />
  <DatePicker
    v-else-if="field.type === 'date'"
    :model-value="typeof value === 'string' ? value : undefined"
    :label="labels.none"
    icon="i-lucide-calendar"
    allow-time
    :today="today"
    :locale="locale"
    :week-starts-on="weekStartsOn"
    @update:model-value="emit('update', $event)"
  />
  <USelectMenu
    v-else
    :model-value="value as any"
    :items="items"
    value-key="value"
    :multiple="field.type === 'multiSelect'"
    :create-item="field.open"
    size="sm"
    variant="soft"
    :placeholder="labels.none"
    class="tk:min-w-40"
    @update:model-value="emit('update', ($event as unknown as FieldValue | undefined) ?? undefined)"
    @create="emit('update', field.type === 'multiSelect' ? [...(Array.isArray(value) ? value : []), $event] : $event)"
  />
</template>
