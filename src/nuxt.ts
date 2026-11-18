import {defineNuxtModule} from '@nuxt/kit'

/** `modules: ['@nuxt/ui', '@type32/tasks-ui-components/nuxt']`: the components' stylesheet, and their code built by Nuxt. */
export default defineNuxtModule({
    meta: {name: '@type32/tasks-ui-components'},
    setup(_, nuxt) {
        // They import Nuxt UI's `.vue` files, which a server render can't load from `node_modules` as they are.
        nuxt.options.build.transpile.push('@type32/tasks-ui-components')
        nuxt.options.css.push('@type32/tasks-ui-components/style.css')
    },
})
