import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/main'
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/preload'
    }
  },
  renderer: {
    root: 'src/renderer',
    /* 生产环境 loadFile(file://)；必须用相对路径，否则 /assets/* 无法加载导致白屏 */
    base: './',
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    /* outDir 相对 electron-vite 项目根（本目录），勿用 ../ — 否则产物会落到上级目录，打包进不了 app */
    build: {
      outDir: 'dist'
    },
    plugins: [react()]
  }
})
