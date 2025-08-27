// src/logger.ts
import { definePlugin, type AppInstance } from '@marwajs/core'

export const LoggerPlugin = definePlugin({
  name: 'logger',

  provides: {
    logger: {
      info: (...args: any[]) => console.log('[logger:info]', ...args),
      warn: (...args: any[]) => console.warn('[logger:warn]', ...args),
      error: (...args: any[]) => console.error('[logger:error]', ...args),
    }
  },

  setup(app: AppInstance) {
    const logger = app.inject<any>('logger')

    // App init
    app.hooks.onInit.on(() => {
      logger?.info('App initialized with LoggerPlugin')
    })

    // Component mount/unmount
    app.hooks.onComponentMount.on(({ name, scope }) => {
      logger?.info(`Component mounted`, name, scope)
    })
    app.hooks.onComponentUnmount.on(({ name }) => {
      logger?.warn(`Component unmounted`, name)
    })
  }
})
