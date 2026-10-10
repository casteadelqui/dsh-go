#!/usr/bin/env node
/**
 * 把 lib/client.js 同步成 assets/client.js。
 *
 * 为什么要一份副本：
 *   DSH 自己按 package.json 的 `exports["./client"]` 去加载 lib/client.js；
 *   而插件内置的自检页（assets/selftest.html）只能通过宿主半侧那条
 *   已经存在的 `/dsh-go/assets/*` 静态路由取文件，取不到 lib/ 下的东西。
 *   副本让「浏览器半侧自检」在插件不改动宿主路由的情况下也能跑。
 *
 * 一致性由 .dsh-tmp/test-go.mjs 里的字节比对断言保证；改完 lib/client.js 请跑一次本脚本。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const src = path.join(root, 'lib', 'client.js')
const dst = path.join(root, 'assets', 'client.js')

const banner = '/* 自动生成：请勿直接编辑，改 lib/client.js 后跑 tools/sync-assets.mjs */\n'
const body = banner + fs.readFileSync(src, 'utf8')
fs.writeFileSync(dst, body)
console.log('synced lib/client.js -> assets/client.js (' + Buffer.byteLength(body) + ' bytes)')
