/**
 * dsh-go — 对局状态仓库（宿主侧单例）
 *
 * UI（浏览器）与 agent 工具共享同一份状态：谁落子都会写进这里，
 * 另一方通过事件序号（seq）长轮询拿到增量。
 */

import { GoGame, BLACK, WHITE, EMPTY, colorName, coordName, opponent, influenceMap } from './engine.js'
import { chooseMove, getLevel, gradeMove, rankMoves, LEVELS } from './ai.js'
import { annotateMove, pickLessons, openingAdvice, summarize, lessonById, briefLine } from './teach.js'

const MAX_EVENTS = 400

export class GoStore {
  constructor() {
    this.listeners = new Set()
    this.reset({ size: 9 })
  }

  /* ---------------- 基础 ---------------- */

  reset({ size, difficulty, teaching, opponent: opp, humanColor, keepSettings = true } = {}) {
    const s = this.settings || {}
    this.settings = {
      size: size ?? s.size ?? 9,
      difficulty: difficulty ?? s.difficulty ?? 2,
      teaching: teaching ?? s.teaching ?? true,
      opponent: opp ?? s.opponent ?? 'agent', // 'agent' = 和鲸娘下, 'ai' = 和本机 AI 下
      humanColor: humanColor ?? s.humanColor ?? BLACK,
      showCoords: s.showCoords ?? true,
      showNumbers: s.showNumbers ?? false,
      lessons: s.lessons ?? true,
      hints: s.hints ?? true, // 半透明推荐棋子
    }
    this.game = new GoGame({ size: this.settings.size, komi: 7.5 })
    this.events = []
    this.seq = 0
    this.commentary = []
    this.lesson = null
    this.pendingFor = this.settings.humanColor === BLACK ? 'human' : this.other()
    this.result = null
    this.emit('new-game', { size: this.settings.size, settings: this.settings })
    if (this.pendingFor !== 'human') this.pendingFor = this.other()
    return this.snapshot()
  }

  other() {
    return this.settings.opponent === 'ai' ? 'ai' : 'agent'
  }

  on(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  emit(type, payload = {}) {
    this.seq++
    const ev = { seq: this.seq, type, at: Date.now(), ...payload }
    this.events.push(ev)
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS)
    for (const fn of this.listeners) {
      try {
        fn(ev)
      } catch {
        /* ignore */
      }
    }
    return ev
  }

  eventsSince(seq) {
    return this.events.filter((e) => e.seq > seq)
  }

  /* ---------------- 设置 ---------------- */

  setSettings(patch = {}) {
    const s = this.settings
    const restart =
      (patch.size !== undefined && Number(patch.size) !== s.size) ||
      (patch.humanColor !== undefined && Number(patch.humanColor) !== s.humanColor)
    for (const k of ['difficulty', 'teaching', 'opponent', 'showCoords', 'showNumbers', 'lessons', 'hints']) {
      if (patch[k] !== undefined) s[k] = patch[k]
    }
    if (patch.difficulty !== undefined) s.difficulty = Math.max(1, Math.min(5, Number(patch.difficulty) || 1))
    if (patch.size !== undefined) s.size = Number(patch.size)
    if (patch.humanColor !== undefined) s.humanColor = Number(patch.humanColor)
    if (restart) return this.reset({ keepSettings: true })
    this.emit('settings', { settings: { ...s } })
    return this.snapshot()
  }

  /* ---------------- 落子 ---------------- */

  /**
   * 人类玩家落子。
   * @returns {{ok:boolean, error?:string, ...}}
   */
  humanPlay(x, y) {
    if (this.game.finished) return { ok: false, error: '这盘棋已经结束了，点「新局」再来一盘吧。' }
    if (this.pendingFor !== 'human') {
      return { ok: false, error: this.pendingFor === 'agent' ? '轮到鲸娘了——先在对话里让她落子，或者切到「本机 AI」模式。' : '现在是 AI 的回合。' }
    }
    const color = this.settings.humanColor
    if (this.game.turn !== color) return { ok: false, error: `现在轮到${colorName(this.game.turn)}方。` }

    const before = this.game.clone()
    const res = this.game.play(x, y, color)
    if (!res.ok) return { ok: false, error: res.illegal }
    if (res.move) res.move.by = 'human'

    const commentary = this.settings.teaching ? annotateMove(before, x, y, color) : null
    const grade = this.settings.teaching ? safeGrade(before, x, y, color) : null

    if (commentary) this.recordCommentary('human', x, y, color, commentary, grade)
    this.emit('move', {
      by: 'human',
      x,
      y,
      color,
      coord: coordName(x, y, this.game.size),
      captured: res.captured.length,
      commentary,
      grade,
    })

    this.afterMove()
    return { ok: true, ...this.snapshot(), commentary, grade }
  }

  /** 鲸娘（agent）或本机 AI 落子 */
  machinePlay({ by = 'agent', x, y } = {}) {
    if (this.game.finished) return { ok: false, error: '对局已结束。' }
    const color = this.game.turn
    const human = this.settings.humanColor
    if (color === human) return { ok: false, error: '现在轮到主人落子，不能替你下。' }

    let px = x
    let py = y
    let reason = ''
    if (px === undefined || py === undefined) {
      const pick = chooseMove(this.game, this.settings.difficulty, { color })
      if (pick.pass) return this.pass(color, by, pick.reason)
      px = pick.x
      py = pick.y
      reason = pick.reason
    }

    const before = this.game.clone()
    const res = this.game.play(px, py, color)
    if (!res.ok) return { ok: false, error: res.illegal }
    if (res.move) res.move.by = by

    const commentary = this.settings.teaching ? annotateMove(before, px, py, color) : null
    const grade = this.settings.teaching ? safeGrade(before, px, py, color) : null
    if (commentary) this.recordCommentary(by, px, py, color, commentary, grade)
    this.emit('move', {
      by,
      x: px,
      y: py,
      color,
      coord: coordName(px, py, this.game.size),
      captured: res.captured.length,
      reason,
      commentary,
      grade,
    })
    this.afterMove()
    return { ok: true, reason, ...this.snapshot(), commentary, grade }
  }

  pass(color = this.game.turn, by = 'human', reason = '') {
    const res = this.game.pass(color)
    if (!res.ok) return { ok: false, error: res.illegal }
    if (res.move) res.move.by = by
    this.emit('pass', { by, color })
    this.afterMove()
    return { ok: true, ...this.snapshot() }
  }

  resign(color = this.settings.humanColor) {
    this.game.resign(color)
    this.result = summarize(this.game)
    this.pendingFor = null
    this.emit('resign', { color, result: this.result, summary: this.game.toJSON() })
    return { ok: true, result: this.result, ...this.snapshot() }
  }

  undo(steps = 2) {
    const n = this.game.undo(Math.max(1, steps))
    if (n === 0) return { ok: false, error: '没有可以悔的棋了。' }
    this.pendingFor = this.game.turn === this.settings.humanColor ? 'human' : this.other()
    this.emit('undo', { steps: n })
    return { ok: true, undone: n, ...this.snapshot() }
  }

  /** 一步落下之后：判断该谁走、是否终局、是否换知识点 */
  afterMove() {
    const g = this.game
    if (g.finished) {
      this.result = summarize(g)
      this.pendingFor = null
      this.emit('game-over', { result: this.result, summary: g.toJSON() })
      return
    }
    if (g.turn === this.settings.humanColor) {
      this.pendingFor = 'human'
      if (this.settings.teaching && this.settings.lessons && g.moves.length % 4 === 1) {
        this.lesson = pickLessons(Math.min(4, 1 + Math.floor(g.moves.length / 6)), 1, Date.now())[0] || null
        if (this.lesson) this.emit('lesson', { lesson: this.lesson })
      }
      return
    }
    // 轮到机器
    if (this.settings.opponent === 'ai') {
      this.pendingFor = 'ai'
      // 本机 AI 立刻应手（异步一拍，避免阻塞 HTTP 响应）
      setTimeout(() => {
        try {
          this.machinePlay({ by: 'ai' })
        } catch {
          /* ignore */
        }
      }, 30)
    } else {
      this.pendingFor = 'agent'
      this.emit('your-turn', { hint: '轮到鲸娘了，在对话里说一声，或者点面板上的「请鲸娘落子」。' })
    }
  }

  /** 给 agent 用：当前该谁走 */
  get waitingFor() {
    return this.pendingFor
  }

  /* ---------------- 快照 ---------------- */

  /** 记一条点评（含给「实时教练」用的一句话短评）。 */
  recordCommentary(by, x, y, color, commentary, grade) {
    const g = this.game
    this.commentary.unshift({
      seq: this.seq + 1,
      by,
      coord: coordName(x, y, g.size),
      color,
      tags: commentary.tags,
      text: commentary.text,
      danger: commentary.danger,
      grade: grade ? grade.grade : null,
      brief: briefLine(grade ? grade.grade : null, commentary.tags, commentary.danger, by),
      at: Date.now(),
    })
    this.commentary = this.commentary.slice(0, 40)
  }

  snapshot() {
    const g = this.game
    const base = g.toJSON()
    const size = g.size
    const st = this.settings

    // 合法点集合：只在轮到主人时计算，供界面画悬停虚影
    // 注意：不能留 undefined。快照会跨 JSON 边界送给 agent 工具，
    // 嵌套 undefined 会被「lossless JSON」校验判为非法输出（非主人回合时工具直接报错）。
    let legalSet = null
    if (!g.finished && this.pendingFor === 'human') {
      const key = size + ':' + g.moves.length
      if (this._legalKey !== key) {
        const arr = new Uint8Array(size * size)
        for (const [x, y] of g.legalMoves(st.humanColor)) arr[y * size + x] = 1
        this._legal = arr
        this._legalKey = key
      }
      legalSet = Array.from(this._legal)
    }

    // 势力图：仅在开关打开时计算，并按手数缓存
    let influence = null
    if (st.showInfluence) {
      const key = size + ':' + g.moves.length
      if (this._infKey !== key) {
        this._inf = Array.from(influenceMap(g))
        this._infKey = key
      }
      influence = this._inf
    }

    // 推荐落点：给棋盘上的半透明棋子用。启发式排序，毫秒级，按手数缓存。
    let hints = null
    if (!g.finished && this.pendingFor === 'human' && st.hints) {
      const key = size + ':' + g.moves.length + ':' + st.humanColor
      if (this._hintKey !== key) {
        const rk = safeRank(g, st.humanColor, 3)
        this._hint = rk.map((m, i) => ({
          x: m.x,
          y: m.y,
          rank: i + 1,
          coord: coordName(m.x, m.y, size),
          tag: i === 0 ? '推荐' : i === 1 ? '次选' : '备选',
        }))
        this._hintKey = key
      }
      hints = this._hint
    }

    /* 实时教练：一句「现在下哪儿」+ 一句「你刚才那手怎么样」 */
    const lastC = this.commentary[0] || null
    const coach = {
      brief: lastC ? lastC.brief || '' : g.moves.length === 0 ? '点「开始」，落下第一手。' : '',
      who: lastC ? (lastC.by === 'human' ? '你' : lastC.by === 'agent' ? '鲸娘' : 'AI') : '',
      coord: lastC ? lastC.coord : '',
      grade: lastC ? lastC.grade : null,
      danger: lastC ? lastC.danger || null : null,
      text: lastC ? lastC.text : g.moves.length === 0 ? openingAdvice(size) : '',
      suggest: hints && hints[0] ? hints[0].coord : null,
      suggestWhy: hints && hints[0] ? hintReason(g, hints[0].x, hints[0].y, size) : '',
    }

    return {
      ...base,
      settings: { ...st },
      pendingFor: this.pendingFor,
      levels: LEVELS.map((l) => ({ id: l.id, name: l.name, desc: l.desc })),
      commentary: this.commentary.slice(0, 12),
      lesson: this.lesson,
      result: this.result,
      level: getLevel(st.difficulty).name,
      advice: g.moves.length === 0 ? openingAdvice(size) : null,
      seq: this.seq,
      legalSet,
      influence,
      hints,
      coach,
      moveList: g.moves.map((m, i) => ({
        n: m.n || i + 1,
        x: m.x,
        y: m.y,
        pass: !!m.pass,
        color: m.color,
        by: m.by || null,
        coord: m.pass ? '停一手' : coordName(m.x, m.y, size),
      })),
    }
  }

  /** 给 agent 用的紧凑文本形势 */
  describe() {
    const g = this.game
    const sc = g.score()
    const lines = []
    lines.push(`棋盘 ${g.size}×${g.size}，共 ${g.moves.length} 手，贴目 ${g.komi}。`)
    lines.push(`黑提 ${g.captures[BLACK]} 子，白提 ${g.captures[WHITE]} 子。`)
    lines.push(`当前数子：黑 ${sc.black}，白 ${sc.white} → ${sc.result}（未终局时仅供参考）。`)
    if (g.finished) lines.push(`对局已结束：${this.result || sc.result}`)
    else lines.push(`现在轮到 ${colorName(g.turn)}方（${this.pendingFor === 'human' ? '主人' : this.pendingFor === 'agent' ? '鲸娘' : '本机 AI'}）。`)
    if (g.lastMove) {
      lines.push(`最后一手：${colorName(g.lastMove.color)} ${g.lastMove.pass ? '停一手' : coordName(g.lastMove.x, g.lastMove.y, g.size)}`)
    }
    const lv = getLevel(this.settings.difficulty)
    lines.push(`难度：${lv.name}（${this.settings.difficulty}/5）；教学：${this.settings.teaching ? '开' : '关'}；对手：${this.settings.opponent === 'ai' ? '本机 AI' : '鲸娘'}。`)
    return lines.join('\n')
  }

  /** 棋盘 ASCII 图，方便 agent「看」局面 */
  ascii({ markLast = true } = {}) {
    const g = this.game
    const size = g.size
    const last = g.lastMove
    const out = []
    const pad = String(size).length
    for (let y = 0; y < size; y++) {
      let row = String(size - y).padStart(pad, ' ') + ' '
      for (let x = 0; x < size; x++) {
        const v = g.get(x, y)
        let ch = v === BLACK ? 'X' : v === WHITE ? 'O' : '.'
        if (markLast && last && !last.pass && last.x === x && last.y === y) ch = v === BLACK ? 'x' : 'o'
        row += ch + ' '
      }
      out.push(row.trimEnd())
    }
    const letters = 'ABCDEFGHJKLMNOPQRSTUVWXYZ'.slice(0, size)
    out.push('  ' + letters.split('').join(' '))
    out.push(`（X=黑 O=白，小写=最后一手）`)
    return out.join('\n')
  }

  /** 找出所有只有 1 口气的己方棋块（提醒主人） */
  atariGroups(color) {
    const g = this.game
    const seen = new Set()
    const out = []
    for (let y = 0; y < g.size; y++) {
      for (let x = 0; x < g.size; x++) {
        if (g.get(x, y) !== color) continue
        const grp = g.group(x, y)
        if (seen.has(grp.stones[0])) continue
        for (const s of grp.stones) seen.add(s)
        if (grp.liberties.length === 1) {
          const sx = grp.stones[0] % g.size
          const sy = (grp.stones[0] - sx) / g.size
          out.push({
            size: grp.stones.length,
            at: coordName(sx, sy, g.size),
            liberty: coordName(grp.liberties[0] % g.size, Math.floor(grp.liberties[0] / g.size), g.size),
          })
        }
      }
    }
    return out
  }
}

function safeGrade(before, x, y, color) {
  try {
    return gradeMove(before, x, y, color)
  } catch {
    return null
  }
}

function safeRank(game, color, limit) {
  try {
    return rankMoves(game, color, limit)
  } catch {
    return []
  }
}

/** 给推荐落点配一句「为什么」，越短越好。 */
function hintReason(g, x, y, size) {
  const n = size
  const edge = Math.min(x, y, n - 1 - x, n - 1 - y) // 距边线的路数（0 = 一线）
  const line = edge + 1
  if (g.moves.length < n * 1.2) {
    if (line === 3 || line === 4) return '三四线，兼顾地盘和外势'
    if (line <= 2) return '太低，只适合守角'
    return '先站角，别急着往中间跑'
  }
  return '这一手实地和外势都不亏'
}

export const store = new GoStore()
