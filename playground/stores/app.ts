// src/stores/app.ts
 // @ts-ignore
import { defineStore } from '@marwajs/core'

// Create a global store with state, getters, and actions
export const useAppStore = defineStore('marwaStore', {
  state: () => ({
    env: 'development',
    version: '0.1.0',
    count: 0
  }),

  getters: {
    double: (s) => s.count * 2
  },

  actions: {
    increment() {
      this.count++    // `this` is the store proxy
    },
    toggleEnv() {
      this.env = this.env === 'development' ? 'production' : 'development'
    }
  }
})
