import vue from '@vitejs/plugin-vue'
import {defineConfig} from 'vite'

/**
 * What the consumer installs, so it has one of each: its Vue, its Nuxt UI (components imported by file), its
 * `@internationalized/date`, the format, and this package's own dependencies.
 */
const EXTERNAL = /^(vue|@nuxt\/ui|@nuxt\/kit|@internationalized\/date|@type32\/tasks|@tanstack\/vue-virtual)(\/|$)/

export default defineConfig({
    plugins: [vue()],
    build: {
        // The stylesheet is Tailwind's CLI's (`build`): the consumer imports it (`/style.css`), the components' code doesn't.
        lib: {entry: {index: 'src/index.ts', nuxt: 'src/nuxt.ts'}, formats: ['es']},
        rolldownOptions: {external: id => EXTERNAL.test(id)},
        // The consumer's build minifies.
        minify: false,
    },
})
