/**
 * dsh-go — 五档难度围棋 AI（纯 JS，零依赖）
 *
 * 低难度 = 启发式 + 随机性；高难度 = 启发式候选 + 轻量蒙特卡洛模拟（light playout）。
 * 目标不是下得多强，而是「像个人」——让主人有得下、有得学。
 */

import { BLACK, WHITE, EMPTY, opponent, influenceMap, GoGame } from './engine.js'

export const LEVELS = [
  {
    id: 1,
    key: 'beginner',
    name: '入门',
    desc: '刚学会规则的水平：会吃子、会逃跑，但经常下出随手棋。适合第一次摸棋。',
    playouts: 0,
    temperature: 0.85,
    blunder: 0.35,
  },
  {
    id: 2,
    key: 'easy',
    name: '初级',
    desc: '知道要连接、要抢大场，偶尔会看漏。适合刚学完基础规则。',
    playouts: 0,
    temperature: 0.45,
    blunder: 0.16,
  },
  {
    id: 3,
    key: 'medium',
    name: '中级',
    desc: '会做眼、会算征子，开始有全局观。是「开始能学到东西」的档位。',
    playouts: 120,
    temperature: 0.2,
    blunder: 0.06,
  },
  {
    id: 4,
    key: 'hard',
    name: '高级',
    desc: '会判断厚薄与方向，官子也收得干净。要认真下才赢得了。',
    playouts: 420,
    temperature: 0.08,
    blunder: 0.02,
  },
  {
    id: 5,
    key: 'master',
    name: '大师',
    desc: '全力应战，不再有明显失误。想赢它得先学会数气与做活。',
    playouts: 1100,
    temperature: 0,
    blunder: 0,
  },
]

export function getLevel(id) {
  return LEVELS.find((l) => l.id === Number(id)) || LEVELS[2]
}

/* ------------------------------------------------------------------ *
 * 快速模拟内核（与 GoGame 分开，避免对象分配开销）
 * ------------------------------------------------------------------ */

function makeRng(seed) {
  let s = seed >>> 0 || 0x9e3779b9
  return function rng() {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/** 计算 (x,y) 所在棋串的气数，并把棋串写进 out（返回长度） */
function collectGroup(g, size, x, y, stamp, out) {
  const color = g[y * size + x]
  let n = 0
  let libs = 0
  const stack = [y * size + x]
  stamp[y * size + x] = 1
  while (stack.length) {
    const i = stack.pop()
    out[n++] = i
    const cx = i % size
    const cy = (i - cx) / size
    for (let k = 0; k < 4; k++) {
      const nx = cx + N4[k][0]
      const ny = cy + N4[k][1]
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue
      const ni = ny * size + nx
      const v = g[ni]
      if (v === EMPTY) {
        if (stamp[ni] !== 2) {
          stamp[ni] = 2
          libs++
        }
      } else if (v === color && stamp[ni] !== 1) {
        stamp[ni] = 1
        stack.push(ni)
      }
    }
  }
  return { count: n, libs }
}

/** 该点是否是自己/对方的真眼（简化判定：四正全是己方 + 至少三斜是己方） */
function isTrueEye(g, size, x, y, color) {
  for (let k = 0; k < 4; k++) {
    const nx = x + N4[k][0]
    const ny = y + N4[k][1]
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue
    if (g[ny * size + nx] !== color) return false
  }
  let diagOwn = 0
  let diagTotal = 0
  for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const nx = x + dx
    const ny = y + dy
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue
    diagTotal++
    if (g[ny * size + nx] === color) diagOwn++
  }
  if (diagTotal === 0) return true
  return diagOwn >= Math.ceil(diagTotal * 0.75)
}

/** 在 g 上尝试落子；成功返回提子数，失败返回 -1（不改动 g） */
function tryPlay(g, size, x, y, color, scratch, stamp) {
  const i = y * size + x
  if (g[i] !== EMPTY) return -1
  g[i] = color
  const opp = color === BLACK ? WHITE : BLACK
  let captured = 0
  const capturedList = []
  for (let k = 0; k < 4; k++) {
    const nx = x + N4[k][0]
    const ny = y + N4[k][1]
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue
    const ni = ny * size + nx
    if (g[ni] !== opp) continue
    stamp.fill(0)
    // 复用 stamp 作为访问标记；用 2 表示「已计入气」
    const r = collectGroup(g, size, nx, ny, stamp, scratch)
    if (r.libs === 0) {
      for (let j = 0; j < r.count; j++) {
        g[scratch[j]] = EMPTY
        capturedList.push(scratch[j])
        captured++
      }
    }
  }
  if (captured === 0) {
    stamp.fill(0)
    const r = collectGroup(g, size, x, y, stamp, scratch)
    if (r.libs === 0) {
      g[i] = EMPTY
      return -1
    }
  }
  return captured
}

/** 数子（中国规则）：子 + 独占空点 */
function areaScore(g, size, komi) {
  const seen = new Uint8Array(size * size)
  let b = 0
  let w = 0
  for (let i = 0; i < g.length; i++) {
    if (g[i] === BLACK) b++
    else if (g[i] === WHITE) w++
  }
  const stack = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      if (g[i] !== EMPTY || seen[i]) continue
      stack.length = 0
      stack.push(i)
      seen[i] = 1
      let region = 0
      let touchesB = false
      let touchesW = false
      while (stack.length) {
        const j = stack.pop()
        region++
        const jx = j % size
        const jy = (j - jx) / size
        for (let k = 0; k < 4; k++) {
          const nx = jx + N4[k][0]
          const ny = jy + N4[k][1]
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue
          const ni = ny * size + nx
          const v = g[ni]
          if (v === EMPTY) {
            if (!seen[ni]) {
              seen[ni] = 1
              stack.push(ni)
            }
          } else if (v === BLACK) touchesB = true
          else touchesW = true
        }
      }
      if (touchesB && !touchesW) b += region
      else if (touchesW && !touchesB) w += region
    }
  }
  return b - (w + komi)
}

/**
 * 一次轻量随机模拟；返回黑减白的目差。
 */
function playout(grid, size, toMove, komi, rng, maxMoves) {
  const g = grid.slice()
  let color = toMove
  let passes = 0
  let moves = 0
  const scratch = new Int32Array(size * size)
  const stamp = new Uint8Array(size * size)
  const cap = maxMoves || size * size * 2
  while (passes < 2 && moves < cap) {
    const cands = []
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x
        if (g[i] !== EMPTY) continue
        if (isTrueEye(g, size, x, y, color)) continue
        cands.push(i)
      }
    }
    if (cands.length === 0) break
    let played = false
    // 先试有战术意义的点（打吃/提子），提高模拟质量
    const tactical = []
    for (const i of cands) {
      const x = i % size
      const y = (i - x) / size
      let gain = 0
      const opp = color === BLACK ? WHITE : BLACK
      for (let k = 0; k < 4; k++) {
        const nx = x + N4[k][0]
        const ny = y + N4[k][1]
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue
        const ni = ny * size + nx
        if (g[ni] !== opp) continue
        stamp.fill(0)
        const r = collectGroup(g, size, nx, ny, stamp, scratch)
        if (r.libs === 1) gain += r.count
      }
      if (gain > 0) tactical.push([i, gain])
    }
    let pick = -1
    if (tactical.length > 0 && rng() < 0.85) {
      tactical.sort((a, b) => b[1] - a[1])
      pick = tactical[0][0]
    } else {
      pick = cands[(rng() * cands.length) | 0]
    }
    const px = pick % size
    const py = (pick - px) / size
    const before = g.slice()
    const cap = tryPlay(g, size, px, py, color, scratch, stamp)
    if (cap < 0) {
      // 非法（自杀）→ 换个随机的，再不行就停一手
      let ok = false
      for (let tries = 0; tries < 8 && !ok; tries++) {
        const alt = cands[(rng() * cands.length) | 0]
        const ax = alt % size
        const ay = (alt - ax) / size
        const c2 = tryPlay(g, size, ax, ay, color, scratch, stamp)
        if (c2 >= 0) ok = true
      }
      if (!ok) {
        // 复原并停一手
        for (let i = 0; i < g.length; i++) g[i] = before[i]
        passes++
        color = color === BLACK ? WHITE : BLACK
        moves++
        continue
      }
    }
    passes = 0
    color = color === BLACK ? WHITE : BLACK
    moves++
  }
  return areaScore(g, size, komi)
}

/* ------------------------------------------------------------------ *
 * 候选与启发式
 * ------------------------------------------------------------------ */

function candidates(game, color) {
  const size = game.size
  const out = []
  const n = game.occupied
  const early = game.moves.length < size * 1.2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (game.get(x, y) !== EMPTY) continue
      if (game.koPoint === game.idx(x, y) && game.koColor === color) continue
      let near = false
      const rr = n === 0 ? 0 : 2
      for (let dy = -rr; dy <= rr && !near; dy++) {
        for (let dx = -rr; dx <= rr; dx++) {
          if (dx === 0 && dy === 0) continue
          const v = game.get(x + dx, y + dy)
          if (v === BLACK || v === WHITE) {
            near = true
            break
          }
        }
      }
      if (n === 0) near = true
      if (!near && !early) continue
      out.push([x, y])
    }
  }
  if (out.length === 0) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) if (game.get(x, y) === EMPTY) out.push([x, y])
    }
  }
  return out
}

function lineOf(x, y, size) {
  return Math.min(x, y, size - 1 - x, size - 1 - y) + 1
}

/** 单点启发式评分，越大越好 */
function heuristic(game, x, y, color) {
  const size = game.size
  let s = 0
  const opp = opponent(color)
  const mineBefore = game.group(x, y) // 空的，占位

  // 1) 落子后的即时效果（在副本上算，保证准确）
  const probe = game.clone()
  const res = probe.play(x, y, color)
  if (!res.ok) return -Infinity
  const captured = res.captured.length
  s += captured * 14

  // 2) 救回自己被叫吃的棋
  for (const [nx, ny] of game.neighbors(x, y)) {
    if (game.get(nx, ny) !== color) continue
    const g = game.group(nx, ny)
    if (g.liberties.length === 1 && g.liberties[0] === game.idx(x, y)) {
      s += g.stones.length * 9
      if (g.stones.length >= 3) s += 6 // 大龙逃生更值钱
    } else if (g.liberties.length === 2) {
      s += g.stones.length * 2.2
    }
  }

  // 3) 打吃对方
  for (const [nx, ny] of probe.neighbors(x, y)) {
    if (probe.get(nx, ny) !== opp) continue
    const g = probe.group(nx, ny)
    if (g.liberties.length === 1) s += g.stones.length * 6
    else if (g.liberties.length === 2) s += g.stones.length * 1.6
  }

  // 4) 自身安全：落下后自己这串的气
  const own = probe.group(x, y)
  if (own.liberties.length === 1) s -= 9 + own.stones.length * 3
  else if (own.liberties.length === 2) s -= 1.5
  else s += Math.min(own.liberties.length, 6) * 1.1

  // 5) 连回 / 断开
  let ownAdj = 0
  let oppAdj = 0
  let emptyAdj = 0
  for (const [nx, ny] of game.neighbors(x, y)) {
    const v = game.get(nx, ny)
    if (v === color) ownAdj++
    else if (v === opp) oppAdj++
    else emptyAdj++
  }
  s += ownAdj * 2.0
  s += oppAdj * 1.4 // 贴身接触有价值（但不如连接）
  if (ownAdj > 0 && oppAdj > 0) s += 3.5 // 切断/接触战要点

  // 6) 影响力：往自己势大的方向走，往对方势大的方向打入
  if (game.moves.length > 6) {
    const inf = game.__inf || (game.__inf = influenceMap(game))
    const v = inf[game.idx(x, y)]
    s += v * (color === BLACK ? 2.6 : -2.6)
  }

  // 7) 布局阶段的位置偏好：三线四线最好，一二线差
  const ln = lineOf(x, y, size)
  if (game.moves.length < size * 2.2) {
    if (ln === 1) s -= 7
    else if (ln === 2) s -= 3
    else if (ln === 3) s += 3.6
    else if (ln === 4) s += 3.2
    else if (ln === 5) s += 0.6
  } else {
    if (ln === 1) s -= 1.2
  }

  // 8) 别去填自己的真眼
  const g0 = game.grid
  if (isTrueEye(g0, size, x, y, color)) s -= 60
  if (isTrueEye(g0, size, x, y, opp)) s += 1.2

  // 9) 收官阶段：偏向实际围空
  if (game.moves.length > size * size * 0.45) {
    const before = game.estimate()
    const after = probe.estimate()
    const delta = color === BLACK ? after.diff - before.diff : before.diff - after.diff
    s += delta * 1.6
  }

  // 10) 微小的随机扰动，避免每局一模一样
  s += ((x * 73856093) ^ (y * 19349663)) % 7 * 0.05

  return s
}

function rankMoves(game, color, limit = 12) {
  const cands = candidates(game, color)
  const scored = []
  for (const [x, y] of cands) {
    const v = heuristic(game, x, y, color)
    if (v === -Infinity) continue
    scored.push({ x, y, h: v })
  }
  scored.sort((a, b) => b.h - a.h)
  return scored.slice(0, limit)
}

/* ------------------------------------------------------------------ *
 * 对外接口
 * ------------------------------------------------------------------ */

/**
 * 让 AI 选一手棋。
 * @returns {{pass:boolean, x?:number, y?:number, reason:string, candidates:object[]}}
 */
export function chooseMove(game, levelId, opts = {}) {
  const level = getLevel(levelId)
  const color = opts.color || game.turn
  const seed = opts.seed || (Date.now() ^ (game.moves.length * 2654435761)) >>> 0
  const rng = makeRng(seed)
  const size = game.size

  const ranked = rankMoves(game, color, 14)
  if (ranked.length === 0) {
    return { pass: true, reason: '没有合法的落子了，只能停一手。', candidates: [] }
  }

  let best = ranked[0]
  let reason = ''

  // ---- 纯启发式档位（入门 / 初级）----
  if (level.playouts === 0) {
    const poolSize = level.temperature > 0.6 ? Math.min(8, ranked.length) : Math.min(4, ranked.length)
    let pick = 0
    // 按温度在前几名里抽签（越靠前概率越大）
    const r = rng()
    let acc = 0
    for (let i = 0; i < poolSize; i++) {
      const wgt = Math.pow(1 - level.temperature * (i / (poolSize + 1)), 3)
      acc += wgt
      if (r < acc) {
        pick = i
        break
      }
      pick = i
    }
    best = ranked[pick]
    // 偶尔故意下差一点（入门档的随手棋）
    if (rng() < level.blunder && ranked.length > 2) {
      best = ranked[Math.min(ranked.length - 1, 2 + ((rng() * 3) | 0))]
      reason = '随手棋'
    }
  } else {
    // ---- 带模拟的档位 ----
    const scale = size >= 19 ? 0.35 : size >= 13 ? 0.6 : 1
    const budget = Math.max(24, Math.round(level.playouts * scale))
    const pool = ranked.slice(0, Math.min(10, ranked.length))
    const wins = new Float64Array(pool.length)
    const winsB = new Float64Array(pool.length)
    const sims = new Float64Array(pool.length)
    for (let t = 0; t < budget; t++) {
      const i = t % pool.length
      const c = pool[i]
      const probe = game.clone()
      const r = probe.play(c.x, c.y, color)
      if (!r.ok) continue
      const diff = playout(probe.grid, size, probe.turn, game.komi, rng)
      sims[i]++
      // 归一化到 -1..1（1 目 ≈ 1/40 优势）
      const norm = Math.tanh(diff / 40)
      if (color === BLACK) winsB[i] += norm
      else winsB[i] -= norm
      wins[i] += color === BLACK ? norm : -norm
    }
    let bestIdx = 0
    let bestVal = -Infinity
    for (let i = 0; i < pool.length; i++) {
      if (sims[i] === 0) continue
      // 启发式先验 + 模拟胜率，权重按模拟次数收缩
      const prior = Math.tanh(c_prior(pool[i].h) / 6)
      const wr = wins[i] / sims[i]
      const conf = sims[i] / (sims[i] + 18)
      const val = wr * conf + prior * (1 - conf) * 0.5
      if (val > bestVal) {
        bestVal = val
        bestIdx = i
      }
    }
    best = pool[bestIdx]
  }

  // 判断是不是该停一手（终局：棋盘上只剩自己的眼和对方的活棋）
  const openPoints = game.legalMoves(color).filter(([x, y]) => {
    if (isTrueEye(game.grid, size, x, y, color)) return false
    if (isTrueEye(game.grid, size, x, y, opponent(color))) return false
    return true
  })
  if (openPoints.length === 0 && game.moves.length > size * 1.5) {
    return { pass: true, reason: '棋盘上没有值得下的地方了，停一手收官。', candidates: ranked }
  }

  return {
    pass: false,
    x: best.x,
    y: best.y,
    reason: reason || describeChoice(game, best, color, level),
    candidates: ranked.slice(0, 5),
    score: rankMoves(game, color, 1)[0]?.h ?? 0,
  }
}

function c_prior(h) {
  return Math.max(-20, Math.min(20, h))
}

function describeChoice(game, best, color, level) {
  const probe = game.clone()
  const r = probe.play(best.x, best.y, color)
  const bits = []
  if (r.ok && r.captured.length) bits.push(`提掉 ${r.captured.length} 子`)
  const opp = opponent(color)
  for (const [nx, ny] of game.neighbors(best.x, best.y)) {
    if (game.get(nx, ny) !== color) continue
    const g = game.group(nx, ny)
    if (g.liberties.length === 1) bits.push('接回被打吃的棋')
  }
  for (const [nx, ny] of probe.neighbors(best.x, best.y)) {
    if (probe.get(nx, ny) !== opp) continue
    const g = probe.group(nx, ny)
    if (g.liberties.length === 1) bits.push(`打吃对方 ${g.stones.length} 子`)
  }
  const ln = lineOf(best.x, best.y, game.size)
  if (bits.length === 0) {
    if (game.moves.length < game.size * 2) bits.push(ln === 3 ? '占三线，兼顾实地与外势' : ln === 4 ? '占四线，取外势' : '抢占大场')
    else bits.push('稳健的一手')
  }
  return bits.join('，')
}

/**
 * 教学用：给一手棋打分。
 * @returns {{grade:string, score:number, bestScore:number, comment:string}}
 */
export function gradeMove(before, x, y, color) {
  const ranked = rankMoves(before, color, 8)
  if (ranked.length === 0) return { grade: '—', score: 0, bestScore: 0, comment: '没有可比较的候选点。' }
  const bestScore = ranked[0].h
  const same = ranked.find((m) => m.x === x && m.y === y)
  const score = same ? same.h : heuristic(before, x, y, color)
  const gap = bestScore - score
  let grade
  if (same && ranked.indexOf(same) === 0) grade = '好棋'
  else if (gap < 2.5) grade = '可行'
  else if (gap < 7) grade = '稍缓'
  else if (gap < 16) grade = '值得商榷'
  else grade = '失误'
  const bestPt = `${ranked[0].x},${ranked[0].y}`
  const comment = `AI 认为更好的点是第 ${bestPt} 点（评分 ${bestScore.toFixed(1)}），这一手评分 ${score.toFixed(1)}。`
  return { grade, score, bestScore, gap, comment, best: ranked[0] }
}

export { playout, areaScore, isTrueEye, rankMoves }
