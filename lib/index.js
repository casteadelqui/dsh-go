/**
 * dsh-go — 宿主半侧
 *
 * 只注册自己的东西，不 import 任何 @deepseek-ai 的运行期值
 * （profile 的 node_modules 里解析不到它们）。
 *
 * 提供两件事：
 *   1) /dsh-go 下的 HTTP 服务：独立页面、界面脚本、棋盘素材、REST API
 *   2) go_* 一组 agent 工具：让鲸娘能看局面、落子、点评、教学
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { store } from './store.js'
import { LEVELS, getLevel, chooseMove, rankMoves, gradeMove } from './ai.js'
import { BLACK, WHITE, colorName, coordName, parseCoord } from './engine.js'
import { LESSONS, lessonById, pickLessons, openingAdvice, summarize, annotateMove } from './teach.js'

export const name = 'dsh-go-mode'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const PREFIX = '/dsh-go'

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
}

/* ------------------------------------------------------------------ *
 * HTTP 小工具
 * ------------------------------------------------------------------ */

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.end(body)
}

function sendJson(res, obj, status = 200) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': MIME['.json'] })
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > 1e6) req.destroy()
    })
    req.on('end', () => {
      if (!data) return resolve({})
      try {
        resolve(JSON.parse(data))
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

/** 带 mtime 检查的静态文件读取（方便开发时改完即时生效） */
const fileCache = new Map()
function readStatic(absPath) {
  try {
    const st = fs.statSync(absPath)
    const hit = fileCache.get(absPath)
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.buf
    const buf = fs.readFileSync(absPath)
    fileCache.set(absPath, { mtime: st.mtimeMs, size: st.size, buf })
    return buf
  } catch {
    return null
  }
}

const HTML_SHELL = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>围棋模式 · dsh-go</title>
<style>
  html,body{margin:0;height:100%;background:#1c1a17;color:#e8e2d6;
    font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
  #dshgo-root{height:100%}
</style>
</head>
<body>
<div id="dshgo-root"></div>
<script src="${PREFIX}/app.js"></script>
</body>
</html>`

/* ------------------------------------------------------------------ *
 * REST 处理
 * ------------------------------------------------------------------ */

async function handleApi(req, res, sub) {
  const url = new URL(req.url, 'http://127.0.0.1')

  if (sub === '/api/state' && req.method === 'GET') {
    return sendJson(res, { ok: true, state: store.snapshot() })
  }

  if (sub === '/api/wait' && req.method === 'GET') {
    const since = Number(url.searchParams.get('since') || 0)
    const timeout = Math.max(0, Math.min(60000, Number(url.searchParams.get('timeout') || 20000)))
    const pending = store.eventsSince(since)
    if (pending.length > 0 || timeout === 0) {
      return sendJson(res, { ok: true, seq: store.seq, events: pending, state: store.snapshot() })
    }
    let done = false
    const off = store.on((ev) => {
      if (done) return
      done = true
      off()
      clearTimeout(timer)
      sendJson(res, { ok: true, seq: store.seq, events: [ev], state: store.snapshot() })
    })
    const timer = setTimeout(() => {
      if (done) return
      done = true
      off()
      sendJson(res, { ok: true, seq: store.seq, events: [], state: store.snapshot() })
    }, timeout)
    return
  }

  if (req.method !== 'POST') return sendJson(res, { ok: false, error: '方法不允许' }, 405)
  const body = await readBody(req)

  switch (sub) {
    case '/api/new':
      store.reset(body || {})
      store.emit('focus', { reason: 'new-game' })
      return sendJson(res, { ok: true, message: '新的一局开始了', state: store.snapshot() })

    case '/api/settings':
      store.setSettings(body || {})
      return sendJson(res, { ok: true, state: store.snapshot() })

    case '/api/play': {
      const r = store.humanPlay(Number(body.x), Number(body.y))
      if (!r.ok) return sendJson(res, { ok: false, error: r.error, state: store.snapshot() }, 200)
      return sendJson(res, { ok: true, commentary: r.commentary, grade: r.grade, state: store.snapshot() })
    }

    case '/api/pass': {
      const r = store.pass(store.settings.humanColor, 'human')
      if (!r.ok) return sendJson(res, { ok: false, error: r.error, state: store.snapshot() })
      return sendJson(res, { ok: true, message: '你停了一手', state: store.snapshot() })
    }

    case '/api/resign': {
      const r = store.resign(store.settings.humanColor)
      return sendJson(res, { ok: true, message: r.result, state: store.snapshot() })
    }

    case '/api/undo': {
      const r = store.undo(Number(body.steps) || 2)
      if (!r.ok) return sendJson(res, { ok: false, error: r.error, state: store.snapshot() })
      return sendJson(res, { ok: true, message: `悔了 ${r.undone} 手`, state: store.snapshot() })
    }

    case '/api/hint': {
      if (store.game.finished) return sendJson(res, { ok: false, error: '对局已结束。', state: store.snapshot() })
      const color = store.settings.humanColor
      if (store.game.turn !== color) return sendJson(res, { ok: false, error: '现在不是主人的回合。', state: store.snapshot() })
      const pick = chooseMove(store.game, store.settings.difficulty, { color, seed: Date.now() })
      if (pick.pass) return sendJson(res, { ok: true, message: '这局已经没什么可下的了，建议停一手收官。', state: store.snapshot() })
      const coord = coordName(pick.x, pick.y, store.game.size)
      const note = { seq: store.seq + 1, by: 'hint', coord, color, tags: ['支招'], text: `建议下在 ${coord}：${pick.reason}`, at: Date.now() }
      store.commentary.unshift(note)
      store.commentary = store.commentary.slice(0, 40)
      const ev = store.emit('hint', { x: pick.x, y: pick.y, coord, reason: pick.reason })
      return sendJson(res, {
        ok: true,
        message: `支招：${coord} —— ${pick.reason}`,
        hint: { x: pick.x, y: pick.y, coord, reason: pick.reason },
        state: store.snapshot(),
      })
    }

    default:
      return sendJson(res, { ok: false, error: '未知接口 ' + sub }, 404)
  }
}

/* ------------------------------------------------------------------ *
 * 落子/教学：给 agent 工具复用的公共逻辑
 * ------------------------------------------------------------------ */

function renderState(extra) {
  return {
    content: [{ type: 'text', text: extra }],
    structuredContent: { state: store.snapshot() },
  }
}

function textOf(s) {
  return { content: [{ type: 'text', text: s }] }
}

/* ------------------------------------------------------------------ *
 * 插件主体
 * ------------------------------------------------------------------ */

export function apply(root, rawConfig) {
  const config = rawConfig || {}
  const log = (...a) => {
    const logger = safeLogger(root)
    if (logger) logger.info('[dsh-go]', ...a)
  }

  /* ---------------- HTTP ---------------- */
  root.inject(['webServer'], (ctx) => {
    const handler = async (req, res) => {
      try {
        const raw = req.url || '/'
        const q = raw.indexOf('?')
        let p = q >= 0 ? raw.slice(0, q) : raw
        if (p.startsWith(PREFIX)) p = p.slice(PREFIX.length)
        if (p === '' || p === '/') p = '/app'

        if (p === '/app' || p === '/app/') {
          return send(res, 200, HTML_SHELL, { 'Content-Type': MIME['.html'] })
        }
        if (p.startsWith('/api/')) {
          return await handleApi(req, res, p)
        }
        if (p.startsWith('/assets/')) {
          const rel = p.slice('/assets/'.length).replace(/\.\./g, '')
          const abs = path.join(ROOT, 'assets', rel)
          const buf = readStatic(abs)
          if (!buf) return send(res, 404, 'not found')
          const ext = path.extname(abs).toLowerCase()
          return send(res, 200, buf, {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Cache-Control': 'public, max-age=86400',
          })
        }
        if (p === '/app.js') {
          const buf = readStatic(path.join(HERE, 'ui.js'))
          if (!buf) return send(res, 500, 'ui.js missing', { 'Content-Type': 'text/plain; charset=utf-8' })
          return send(res, 200, buf, { 'Content-Type': MIME['.js'] })
        }
        if (p === '/client.js') {
          // 只为自检/调试暴露浏览器半侧；DSH 自己走 dsh.client 声明加载
          const buf = readStatic(path.join(HERE, 'client.js'))
          if (!buf) return send(res, 404, 'not found')
          return send(res, 200, buf, { 'Content-Type': MIME['.js'] })
        }
        if (p === '/selftest' || p === '/selftest/') {
          const buf = readStatic(path.join(ROOT, 'assets', 'selftest.html'))
          if (!buf) return send(res, 404, 'not found')
          return send(res, 200, buf, { 'Content-Type': MIME['.html'] })
        }
        if (p === '/health') {
          return sendJson(res, { ok: true, moves: store.game.moves.length, size: store.game.size })
        }
        return send(res, 404, 'not found')
      } catch (err) {
        try {
          sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
        } catch {
          /* ignore */
        }
      }
    }
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler }), 'dsh-go: http routes')
    log('http routes registered at', PREFIX)
  })

  /* ---------------- agent 工具 ---------------- */
  root.inject(['tools'], (ctx) => {
    const disposers = []
    for (const def of buildTools()) {
      try {
        disposers.push(ctx.tools.register(def))
      } catch (err) {
        log('tool register failed:', def.name, String(err && err.message))
      }
    }
    ctx.effect(
      () => () => {
        for (const d of disposers) {
          try {
            typeof d === 'function' && d()
          } catch {
            /* ignore */
          }
        }
      },
      'dsh-go: tools',
    )
    log('tools registered:', buildTools().map((t) => t.name).join(', '))
  })
}

function safeLogger(ctx) {
  const l = ctx && ctx.logger
  if (l && typeof l.info === 'function') return l
  return null
}

/* ------------------------------------------------------------------ *
 * 工具定义
 * ------------------------------------------------------------------ */

const OUTPUT = {
  schema: {
    type: 'object',
    properties: {
      content: { type: 'array', items: {} },
      structuredContent: {},
    },
    required: ['content'],
    additionalProperties: false,
  },
  render: (_args, value) => {
    const blocks = value && value.content ? value.content : []
    return blocks.map((b) => ({ type: 'text', text: b.text || String(b) }))
  },
}

function ok(text, structured) {
  return { content: [{ type: 'text', text }], structuredContent: structured }
}

function buildTools() {
  return [
    {
      name: 'go_state',
      description:
        '查看围棋模式的当前局面：棋盘 ASCII 图、该谁落子、提子数、形势判断、难度与教学开关。' +
        '在主人提到围棋、或者你准备落子之前先用这个工具。',
      parameters: {
        type: 'object',
        properties: {
          ascii: { type: 'boolean', description: '是否附上棋盘 ASCII 图（默认 true）' },
        },
      },
      output: OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args) {
        const withAscii = args.ascii !== false
        const head = store.describe()
        const board = withAscii ? '\n\n```\n' + store.ascii() + '\n```' : ''
        const wait = store.waitingFor
        const tail =
          wait === 'human'
            ? '\n\n现在等主人落子。'
            : wait === 'agent'
              ? '\n\n轮到你了：调用 go_play 落下你的一手（可以用坐标，例如 D4；也可以不传坐标让引擎替你选一个你认为最好的点）。'
              : wait === 'ai'
                ? '\n\n本机 AI 正在应手。'
                : '\n\n这一局已经结束。'
        return ok(head + board + tail, store.snapshot())
      },
    },
    {
      name: 'go_play',
      description:
        '在围棋盘上替鲸娘落一手。可以不传坐标——引擎会按当前难度替你想一个最好的点；' +
        '也可以传 coord（如 "D4"）或 x/y（0 起，左上为原点）指定你想下的位置。' +
        '只有轮到鲸娘时才允许落子。' +
        '**落子之后，对话里只用一两句短话（每句不超过 20 字）点评主人刚才那一手，别写长分析。**',
      parameters: {
        type: 'object',
        properties: {
          coord: { type: 'string', description: '围棋坐标，如 D4 / Q16（列 A-T 跳过 I，行从下往上 1-19）' },
          x: { type: 'number', description: '横坐标，0 起（与 coord 二选一）' },
          y: { type: 'number', description: '纵坐标，0 起，自上往下（与 coord 二选一）' },
          comment: { type: 'string', description: '你这一手的用意，会显示在主人的面板上' },
        },
      },
      output: OUTPUT,
      async execute(args) {
        if (store.game.finished) return ok('这一局已经结束了。调用 go_new_game 可以开新局。', store.snapshot())
        if (store.game.turn === store.settings.humanColor) {
          return ok('现在轮到主人落子，还不能替你下。可以先用 go_hint 给主人支招。', store.snapshot())
        }
        let x
        let y
        if (typeof args.coord === 'string' && args.coord.trim()) {
          const p = parseCoord(args.coord, store.game.size)
          if (!p) return ok(`看不懂坐标「${args.coord}」。请用 D4 这样的形式，或者不传坐标让引擎替你选。`, store.snapshot())
          x = p[0]
          y = p[1]
        } else if (typeof args.x === 'number' && typeof args.y === 'number') {
          x = Math.round(args.x)
          y = Math.round(args.y)
        }
        const r = store.machinePlay({ by: 'agent', x, y })
        if (!r.ok) return ok('落子失败：' + r.error, store.snapshot())
        const mv = store.game.lastMove
        const coord = coordName(mv.x, mv.y, store.game.size)
        const lines = [`你在 ${coord} 落子了（${colorName(mv.color)}）。`]
        if (mv.captured.length) lines.push(`提掉对方 ${mv.captured.length} 子。`)
        if (args.comment) lines.push(`你的说明：${args.comment}`)
        if (r.commentary && r.commentary.tags && r.commentary.tags.length) lines.push(`引擎标注：${r.commentary.tags.join('、')}`)
        const sc = store.game.score()
        lines.push(`当前数子：黑 ${sc.black} / 白 ${sc.white}。`)
        if (store.game.finished) lines.push(`对局结束：${store.result || sc.result}`)
        else lines.push(`现在轮到主人了。`)
        return ok(lines.join('\n'), { move: { x: mv.x, y: mv.y, coord }, state: store.snapshot() })
      },
    },
    {
      name: 'go_new_game',
      description:
        '开一局新的围棋。**主人说「开始」「来一局」「开局」「下围棋」「围棋模式」时就用这个开局**，参数没说的别问，直接用当前设置开。' +
        '可以指定棋盘大小、AI 难度（1-5）、是否开启教学、对手是人还是本机 AI、主人执黑还是执白。',
      parameters: {
        type: 'object',
        properties: {
          size: { type: 'number', description: '棋盘路数：9 / 13 / 19' },
          difficulty: { type: 'number', description: '难度 1-5（1 入门 2 初级 3 中级 4 高级 5 大师）' },
          teaching: { type: 'boolean', description: '是否开启教学（每手点评 + 知识点卡片）' },
          opponent: { type: 'string', description: '"agent" = 和鲸娘下；"ai" = 和本机引擎下' },
          humanColor: { type: 'number', description: '主人执子：1=黑（先手）2=白（后手）' },
        },
      },
      output: OUTPUT,
      async execute(args) {
        store.reset({
          size: args.size,
          difficulty: args.difficulty,
          teaching: args.teaching,
          opponent: args.opponent,
          humanColor: args.humanColor,
        })
        store.emit('focus', { reason: 'agent-new-game' })
        const s = store.settings
        const lv = getLevel(s.difficulty)
        return ok(
          `新局已开：${s.size} 路，难度「${lv.name}」，教学${s.teaching ? '开启' : '关闭'}，` +
            `对手是${s.opponent === 'ai' ? '本机 AI' : '鲸娘'}，主人执${s.humanColor === BLACK ? '黑' : '白'}。\n` +
            openingAdvice(s.size) +
            (store.waitingFor === 'agent' ? '\n\n主人执白，所以轮到你先落子——用 go_play 下第一手。' : '\n\n等主人落子。'),
          store.snapshot(),
        )
      },
    },
    {
      name: 'go_settings',
      description: '调整围棋模式的难度 / 教学开关 / 对手 / 显示选项，不影响正在进行的棋局（除非改棋盘大小或执子）。',
      parameters: {
        type: 'object',
        properties: {
          difficulty: { type: 'number', description: '难度 1-5' },
          teaching: { type: 'boolean', description: '教学开关' },
          opponent: { type: 'string', description: '"agent" 或 "ai"' },
          showCoords: { type: 'boolean', description: '棋盘是否显示坐标' },
          showNumbers: { type: 'boolean', description: '棋子上是否显示手数' },
          showInfluence: { type: 'boolean', description: '是否叠加形势判断的势力图' },
          lessons: { type: 'boolean', description: '是否推送围棋知识点卡片' },
        },
      },
      output: OUTPUT,
      async execute(args) {
        store.setSettings(args || {})
        const s = store.settings
        return ok(
          `设置已更新：${s.size} 路，难度「${getLevel(s.difficulty).name}」，教学${s.teaching ? '开' : '关'}，` +
            `对手${s.opponent === 'ai' ? '本机 AI' : '鲸娘'}。`,
          store.snapshot(),
        )
      },
    },
    {
      name: 'go_hint',
      description: '给主人支招：算出当前最值得下的一手并说明理由。轮到主人时用。',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'number', description: '给几个候选点，默认 3' },
        },
      },
      output: OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args) {
        const g = store.game
        if (g.finished) return ok('对局已结束。', store.snapshot())
        const color = g.turn
        const n = Math.max(1, Math.min(5, Number(args.count) || 3))
        const ranked = rankMoves(g, color, n)
        if (ranked.length === 0) return ok('没有合法的落点了，只能停一手。', store.snapshot())
        const lines = [`给${colorName(color)}方的建议（难度参考：${getLevel(store.settings.difficulty).name}）：`]
        ranked.forEach((m, i) => {
          const coord = coordName(m.x, m.y, g.size)
          const before = g.clone()
          const res = before.play(m.x, m.y, color)
          const bits = []
          if (res.ok && res.captured.length) bits.push(`提 ${res.captured.length} 子`)
          const probe = g.clone()
          probe.play(m.x, m.y, color)
          for (const [nx, ny] of probe.neighbors(m.x, m.y)) {
            if (probe.get(nx, ny) !== (color === BLACK ? WHITE : BLACK)) continue
            const grp = probe.group(nx, ny)
            if (grp.liberties.length === 1) bits.push(`打吃 ${grp.stones.length} 子`)
          }
          lines.push(`${i + 1}. ${coord}${bits.length ? '（' + bits.join('，') + '）' : ''}`)
        })
        return ok(lines.join('\n') + '\n\n' + store.ascii(), store.snapshot())
      },
    },
    {
      name: 'go_review',
      description:
        '复盘：分析主人刚下的那一手（或指定的某一手）好在哪里、问题在哪里，并给出更好的选择。' +
        '教学模式开启时，每手棋之后调用它给主人讲解，效果最好。',
      parameters: {
        type: 'object',
        properties: {
          coord: { type: 'string', description: '要复盘的坐标，如 D4；不传则分析最后一手' },
        },
      },
      output: OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args) {
        const g = store.game
        if (g.moves.length === 0) return ok('还没落子，没什么可复盘的。', store.snapshot())
        let target = g.lastMove
        if (args.coord) {
          const p = parseCoord(args.coord, g.size)
          if (!p) return ok(`看不懂坐标「${args.coord}」。`, store.snapshot())
          target = [...g.moves].reverse().find((m) => m.x === p[0] && m.y === p[1])
          if (!target) return ok(`棋谱里没有 ${args.coord} 这一手。`, store.snapshot())
        }
        if (target.pass) return ok('这一手是停一手（虚手）。', store.snapshot())

        // 重建落子前的局面
        const idx = g.moves.indexOf(target)
        const replay = store.game.clone()
        replay.undo(g.moves.length - idx)
        const before = replay
        const an = annotateMove(before, target.x, target.y, target.color)
        const gr = gradeMove(before, target.x, target.y, target.color)
        const coord = coordName(target.x, target.y, g.size)
        const lines = [`【复盘】${colorName(target.color)}方第 ${target.n} 手 ${coord}`]
        lines.push(`引擎标注：${(an.tags || []).join('、') || '无明显特征'}`)
        lines.push(`分析：${an.text}`)
        if (an.danger) lines.push(`⚠ 风险：${an.danger}`)
        if (gr) {
          lines.push(`评价：${gr.grade}（本手 ${gr.score.toFixed(1)} 分，最佳 ${gr.bestScore.toFixed(1)} 分）`)
          lines.push(`更好的选择：${coordName(gr.best.x, gr.best.y, g.size)}`)
        }
        if (an.shape) lines.push(`棋形：${an.shape}`)
        lines.push('')
        lines.push(store.ascii())
        return ok(lines.join('\n'), { review: { coord, ...an, grade: gr && gr.grade }, state: store.snapshot() })
      },
    },
    {
      name: 'go_teach',
      description:
        '围棋教学：列出所有知识点，或讲解某一个知识点（气、提子、劫、眼、征子、布局、官子…），' +
        '也可以按难度随机抽几张。主人问「围棋怎么下」「什么是劫」这类问题时用这个工具。',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: '知识点 id 或标题关键词，如 "ko" / "劫" / "眼"；不传则按难度抽 3 张' },
          level: { type: 'number', description: '知识深度 1-4，默认 2' },
          list: { type: 'boolean', description: 'true 则只列出全部知识点清单' },
        },
      },
      output: OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args) {
        if (args.list) {
          const lines = LESSONS.map((l) => `- [${l.id}] ${l.title}（深度 ${l.level}）`)
          return ok('围棋知识点清单：\n' + lines.join('\n'), { lessons: LESSONS.map((l) => ({ id: l.id, title: l.title, level: l.level })) })
        }
        if (args.topic) {
          const key = String(args.topic).toLowerCase()
          const hit =
            lessonById(args.topic) ||
            LESSONS.find((l) => l.title.toLowerCase().includes(key)) ||
            LESSONS.find((l) => l.id.includes(key)) ||
            LESSONS.find((l) => l.body.toLowerCase().includes(key))
          if (!hit) {
            return ok(
              `没找到「${args.topic}」这个知识点。可用清单：\n` + LESSONS.map((l) => `- ${l.id}：${l.title}`).join('\n'),
              { lessons: LESSONS.map((l) => ({ id: l.id, title: l.title })) },
            )
          }
          store.lesson = hit
          store.emit('lesson', { lesson: hit })
          return ok(`【${hit.title}】\n${hit.body}\n\n💡 ${hit.tip}`, { lesson: hit, state: store.snapshot() })
        }
        const lv = Math.max(1, Math.min(4, Number(args.level) || 2))
        const picks = pickLessons(lv, 3, Date.now())
        store.lesson = picks[0]
        store.emit('lesson', { lesson: picks[0] })
        return ok(
          picks.map((l) => `【${l.title}】\n${l.body}\n💡 ${l.tip}`).join('\n\n'),
          { lessons: picks, state: store.snapshot() },
        )
      },
    },
    {
      name: 'go_undo',
      description: '悔棋。默认退两手（你和鲸娘各一手），让主人重新下。',
      parameters: {
        type: 'object',
        properties: { steps: { type: 'number', description: '退几手，默认 2' } },
      },
      output: OUTPUT,
      async execute(args) {
        const r = store.undo(Number(args.steps) || 2)
        if (!r.ok) return ok(r.error, store.snapshot())
        return ok(`退了 ${r.undone} 手。现在轮到${store.waitingFor === 'human' ? '主人' : '鲸娘'}了。\n\n` + store.ascii(), store.snapshot())
      },
    },
    {
      name: 'go_pass',
      description: '停一手（虚手）。双方连续停一手，对局就以数子结束。',
      parameters: { type: 'object', properties: {} },
      output: OUTPUT,
      async execute() {
        const color = store.game.turn
        const r = store.pass(color, color === store.settings.humanColor ? 'human' : 'agent')
        if (!r.ok) return ok(r.error, store.snapshot())
        const over = store.game.finished
        return ok(
          (color === store.settings.humanColor ? '主人' : '鲸娘') +
            '停了一手。' +
            (over ? `\n双方连续停手，对局结束：${store.result}` : '') +
            '\n\n' +
            store.ascii(),
          store.snapshot(),
        )
      },
    },
    {
      name: 'go_resign',
      description: '认输，结束当前对局。',
      parameters: {
        type: 'object',
        properties: { who: { type: 'string', description: '"human" 主人认输（默认）或 "agent" 鲸娘认输' } },
      },
      output: OUTPUT,
      async execute(args) {
        const who = args.who === 'agent' ? 'agent' : 'human'
        const color = who === 'human' ? store.settings.humanColor : store.settings.humanColor === BLACK ? WHITE : BLACK
        const r = store.resign(color)
        return ok(`${who === 'human' ? '主人' : '鲸娘'}认输。${r.result}\n\n${summarize(store.game)}`, store.snapshot())
      },
    },
    {
      name: 'go_wait_user_move',
      description:
        '等主人落子（长轮询）。**对局循环就靠它**：主人落子后它立刻返回，你接着用 go_play 应手，' +
        '然后再次调用它等下一手 —— 这样一整局都是实时的，主人不用复制任何提示词。' +
        '最多等 timeout 秒（默认 180，上限 300），超时返回「还没落子」，说明主人暂时走开了，' +
        '这一轮可以收尾，等他下次开口再接着循环。',
      parameters: {
        type: 'object',
        properties: { timeout: { type: 'number', description: '最多等多少秒，默认 180，上限 300' } },
      },
      output: OUTPUT,
      async execute(args, exec) {
        const ms = Math.max(1, Math.min(300, Number(args.timeout) || 180)) * 1000
        const since = store.seq
        const r = await waitForEvent(since, ms, exec && exec.signal, (ev) =>
          ev.type === 'move' && ev.by === 'human' ? true : ev.type === 'resign' || ev.type === 'pass' ? true : false,
        )
        if (!r) return ok('等了一会儿，主人还没落子（可能在想棋或者走开了）。这一轮就到这里，别继续空转；主人下次说话时再接着进对局循环。\n\n' + store.ascii(), store.snapshot())
        const mv = store.game.lastMove
        const where = mv ? (mv.pass ? '停一手' : coordName(mv.x, mv.y, store.game.size)) : '？'
        return ok(`主人落子了：${where}。\n\n${store.ascii()}\n\n${store.describe()}`, store.snapshot())
      },
    },
  ]
}

function waitForEvent(since, ms, signal, match) {
  return new Promise((resolve) => {
    let done = false
    const finish = (v) => {
      if (done) return
      done = true
      off()
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
      resolve(v)
    }
    const off = store.on((ev) => {
      if (ev.seq > since && match(ev)) finish(ev)
    })
    const timer = setTimeout(() => finish(null), ms)
    const onAbort = () => finish(null)
    if (signal) {
      if (signal.aborted) return finish(null)
      signal.addEventListener('abort', onAbort, { once: true })
    }
    // 竞态兜底：注册前事件就来了
    if (store.seq > since) {
      const ev = store.events.find((e) => e.seq > since && match(e))
      if (ev) finish(ev)
    }
  })
}
