# @type32/tasks-ui-components

Vue components for [`@type32/tasks`](https://www.npmjs.com/package/@type32/tasks) documents, drawn with
[Nuxt UI](https://ui.nuxt.com): a list of reminders, a board, a calendar and a task editor so far; a timeline to come.
For Vue and Nuxt apps that use Nuxt UI 4. The components draw a document and report what the user did; writing the
document is yours.

```sh
npm install @type32/tasks-ui-components
```

`vue`, `@nuxt/ui`, `@internationalized/date` and `@type32/tasks` are peers: the components use your app's copies, so
your theme, your icons and your date values are theirs.

## Nuxt

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@nuxt/ui", "@type32/tasks-ui-components/nuxt"],
});
```

The module adds the stylesheet and has Nuxt build the package (its components import Nuxt UI's `.vue` files, which a
server render can't load from `node_modules` on its own).

## Vue

With Nuxt UI's Vite plugin set up (`@nuxt/ui/vite`, `@nuxt/ui/vue-plugin`), import the stylesheet after your own:

```ts
import "./main.css"; // @import "tailwindcss"; @import "@nuxt/ui";
import "@type32/tasks-ui-components/style.css";
```

## The list

```vue
<script setup lang="ts">
import { parse, type List, type Task } from "@type32/tasks";
import { applyPatch, type Patch, TaskList, type TaskPatch } from "@type32/tasks-ui-components";
import { shallowRef } from "vue";

const doc = shallowRef(parse(text, "yaml"));
const now = () => new Date().toISOString();

function change(id: string, patch: TaskPatch) {
  doc.value = { ...doc.value, tasks: doc.value.tasks.map((t) => (t.id === id ? applyPatch(t, patch, now()) : t)) };
}
const create = (task: Task) => (doc.value = { ...doc.value, tasks: [...doc.value.tasks, task] });
</script>

<template>
  <TaskList :document="doc" :view="doc.views![0]!" @change="change" @create="create" />
</template>
```

`TaskList` shows a view of the document (the format's `views`): Today, Upcoming, Anytime and Done, or the view's
`groupBy`; subtasks under their parent; the lists in a column beside (`showLists`), where lists are added, renamed,
coloured and deleted. Only the rows on screen are drawn, so thousands of tasks scroll as a few do.

| Prop | |
| --- | --- |
| `document`, `view` | What to draw. |
| `timeZone` | The viewer's IANA zone, which decides what's today. Default: the system's. |
| `locale`, `weekStartsOn` | Dates' language; the calendar's first day (0 is Sunday). |
| `labels` | Your translations of the components' strings (`defaultLabels` has them all, in English). |

| Event | |
| --- | --- |
| `change(id, patch)` | A task changed: apply the patch with `applyPatch`, which removes keys set to `undefined` and stamps `updatedAt`. Deleting is a patch too (`deletedAt`), as the format wants. |
| `create(task)` | A new task, with its id. |
| `changeList(id, patch)`, `createList(list)` | The same for lists. |

The `notes` slot (`{task, text, update}`) draws a task's notes in its editor: a textarea by default, your own
Markdown editor if you have one. `TaskEditor` is the editor alone, with the same events for one task.

The changes the components make are exported, for code of your own: `toggleDone` (a repeating task moves to its next
occurrence), `withStart` (a span keeps its length), `withDue`, `withRepeat`, `withValue`.

Hold a date from `@internationalized/date` in a `shallowRef`: `ref` types it as a plain object without its private
fields.

## The board

`TaskBoard` takes the list's props and events. Its columns are the view's `groupBy` (the status when it has none):
every option of a select or multiSelect, every list, or a star's and a boolean's two; empty ones too. A card dragged
to another column reports a `change` (`moveToGroup`: into a done status it's completed as the checkbox does; a
multiSelect swaps the one value for the other); while the view doesn't sort, `move(id, before)` reports where it went
in the document's order (`moveTask`). A card opens its editor in a popover; each column has New task at its foot.

Columns that are options or lists are added, renamed, coloured and deleted on the board: `changeOption(field,
option, patch)` and `createOption(field, option)` (apply them with `withOption`; renaming a built-in status adds an
option of its id with a title, and a new status takes one of the field's categories, so other apps know what it
means), `changeList` and `createList`.

## The calendar

`TaskCalendar` takes the same props: a month, a week or a day (the view's `scale`), a small month and the lists
beside it. Every occurrence of a repeating task is drawn (the format's `occurrences`), at the viewer's time
(`timeZone`: a meeting in Berlin is at 4 in New York, or 5 the week the clocks change in one city and not the other).
Spans are blocks in a day's hours, or bars across days when they're dates or run past midnight; a moment is drawn at
its start, a todo at its due.

A click opens a task's editor beside it; a drag moves it (by days, and by minutes in a day's hours) or stretches its
end (`shiftTask`: a date stays a date, a duration stays a duration); a drag on empty hours, or a double click, draws a
new task. A moved occurrence of a repeating task is reported as `moveOccurrence(item, shift)`, for you to ask: that
one (`detachOccurrence`: the series skips it, a task of its own takes it) or the series (`shiftTask`). Switching
scale or a list off reports `changeView` (`scale`, `listIds`). The day and week packing follow the
[Nuxt UI calendar template](https://github.com/nuxt-ui-templates/calendar) (MIT, © 2025 Nuxt UI Templates).

## Styling

The components' classes carry the prefix `tk:` (`tk:flex`), compiled into `style.css` against Nuxt UI's design tokens
(`--ui-primary`, `--ui-bg-elevated`, `--ui-radius`…). Your primary colour, radius and dark mode reach them through
those variables. The sheet has no preflight and sets nothing on `:root`, and its classes can't clash with your own.

## Development

| Script              | Does                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------- |
| `bun run build`     | Code with Vite (`dist/*.js`), the stylesheet with Tailwind's CLI, types with `vue-tsc` |
| `bun run typecheck` | `vue-tsc`                                                                              |
| `bun run test`      | Vitest: the list's rows, the changes                                                   |

Templates import Nuxt UI's components by file (`import UButton from "@nuxt/ui/components/Button.vue"`), never by
auto-import or global registration, so the compiled code works in any consumer.
