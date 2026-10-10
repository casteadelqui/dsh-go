/**
 * dsh-go — 围棋规则引擎（纯 JS，零依赖）
 *
 * 棋盘用 Uint8Array 存储：0=空 1=黑 2=白。
 * 规则：中国规则（数子 / 面积计算），贴目默认 7.5。
 * 实现：提子、气、禁入点（自杀禁手）、简单劫（ko）、停一手、认输。
 */

export const EMPTY = 0
export const BLACK = 1
export const WHITE = 2

export function opponent(color) {
  return color === BLACK ? WHITE : BLACK
}

export function colorName(color) {
  return color === BLACK ? '黑' : color === WHITE ? '白' : '空'
}

/** 棋盘坐标列字母（跳过 I，围棋惯例） */
const COL_LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ'

export function coordName(x, y, size) {
  return COL_LETTERS[x] + String(size - y)
}

export function starPoints(size) {
  if (size === 9) return [[2, 2], [6, 2], [4, 4], [2, 6], [6, 6]]
  if (size === 13) return [[3, 3], [9, 3], [6, 6], [3, 9], [9, 9]]
  if (size === 19) {
    return [
      [3, 3], [9, 3], [15, 3],
      [3, 9], [9, 9], [15, 9],
      [3, 15], [9, 15], [15, 15],
    ]
  }
  // 其它尺寸：按比例放四个星位
  const a = Math.max(2, Math.round(size / 4) - 1)
  const b = size - 1 - a
  const m = Math.floor(size / 2)
  const pts = [[a, a], [b, a], [a, b], [b, b]]
  if (size % 2 === 1) pts.push([m, m])
  return pts
}

export class GoGame {
  /**
   * @param {object} opts
   * @param {number} opts.size  9 | 13 | 19
   * @param {number} opts.komi  贴目（中国规则下白方补偿）
   */
  constructor({ size = 19, komi = 7.5 } = {}) {
    this.size = size
    this.komi = komi
    this.grid = new Uint8Array(size * size)
    this.turn = BLACK
    this.captures = { [BLACK]: 0, [WHITE]: 0 } // 各方提掉的对方子数
    this.moves = [] // {color, x, y, pass, captured:[], at}
    this.koPoint = -1
    this.koColor = 0 // 劫争禁手针对哪一方
    this.consecutivePasses = 0
    this.resigned = 0
    this.history = [] // 快照栈，用于悔棋
    this.occupied = 0
    this._snapshot()
    this.history.pop() // 初始局面不作为悔棋点
  }

  clone() {
    const g = Object.create(GoGame.prototype)
    g.size = this.size
    g.komi = this.komi
    g.grid = this.grid.slice()
    g.turn = this.turn
    g.captures = { [BLACK]: this.captures[BLACK], [WHITE]: this.captures[WHITE] }
    g.moves = this.moves.slice()
    g.koPoint = this.koPoint
    g.koColor = this.koColor
    g.consecutivePasses = this.consecutivePasses
    g.resigned = this.resigned
    // 快照对象一旦入栈就不再被修改，浅拷贝整个数组即可安全共享
    // （go_review 依赖 clone 后 undo 回到某一手之前；留空数组会让 undo 变成空操作）
    g.history = this.history.slice()
    g.occupied = this.occupied
    return g
  }

  get finished() {
    return this.resigned !== 0 || this.consecutivePasses >= 2
  }

  idx(x, y) {
    return y * this.size + x
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.size && y < this.size
  }

  get(x, y) {
    return this.inBounds(x, y) ? this.grid[this.idx(x, y)] : -1
  }

  set(x, y, v) {
    this.grid[this.idx(x, y)] = v
  }

  neighbors(x, y) {
    const out = []
    if (x > 0) out.push([x - 1, y])
    if (x < this.size - 1) out.push([x + 1, y])
    if (y > 0) out.push([x, y - 1])
    if (y < this.size - 1) out.push([x, y + 1])
    return out
  }

  /** 收集 (x,y) 所在棋串：返回 {stones:number[], liberties:number[]} */
  group(x, y) {
    const color = this.get(x, y)
    if (color <= 0) return { stones: [], liberties: [], color: EMPTY }
    const size = this.size
    const seen = new Uint8Array(size * size)
    const stones = []
    const libs = new Set()
    const stack = [this.idx(x, y)]
    seen[stack[0]] = 1
    while (stack.length) {
      const i = stack.pop()
      stones.push(i)
      const cx = i % size
      const cy = (i - cx) / size
      for (const [nx, ny] of this.neighbors(cx, cy)) {
        const ni = this.idx(nx, ny)
        const v = this.grid[ni]
        if (v === EMPTY) libs.add(ni)
        else if (v === color && !seen[ni]) {
          seen[ni] = 1
          stack.push(ni)
        }
      }
    }
    return { stones, liberties: [...libs], color }
  }

  libertyCount(x, y) {
    return this.group(x, y).liberties.length
  }

  /** 该点落下 color 后会不会提掉对方子（用于教学提示） */
  wouldCapture(x, y, color) {
    const opp = opponent(color)
    const captured = new Set()
    for (const [nx, ny] of this.neighbors(x, y)) {
      if (this.get(nx, ny) !== opp) continue
      const g = this.group(nx, ny)
      if (g.liberties.length === 1 && g.liberties[0] === this.idx(x, y)) {
        for (const s of g.stones) captured.add(s)
      }
    }
    return [...captured]
  }

  /** 检查一手棋是否合法；返回 null 表示合法，否则返回中文原因 */
  checkIllegal(x, y, color) {
    if (!this.inBounds(x, y)) return '这一手落在棋盘外面了。'
    if (this.get(x, y) !== EMPTY) return '这个交叉点已经有子了。'
    if (this.koPoint === this.idx(x, y) && this.koColor === color) {
      return '这里是「劫」，按规则不能立刻回提，得先在别处找一手劫材。'
    }
    if (this.wouldCapture(x, y, color).length > 0) return null
    // 没有提子 → 需检查自杀
    const probe = this.grid.slice()
    const i = this.idx(x, y)
    this.grid[i] = color
    const g = this.group(x, y)
    this.grid = probe
    if (g.liberties.length === 0) return '这一手会让自己的棋变成没气的死子（自杀），规则不允许。'
    return null
  }

  isLegal(x, y, color) {
    return this.checkIllegal(x, y, color) === null
  }

  legalMoves(color) {
    const out = []
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.grid[this.idx(x, y)] !== EMPTY) continue
        if (this.isLegal(x, y, color)) out.push([x, y])
      }
    }
    return out
  }

  _snapshot() {
    this.history.push({
      grid: this.grid.slice(),
      turn: this.turn,
      captures: { [BLACK]: this.captures[BLACK], [WHITE]: this.captures[WHITE] },
      moves: this.moves.length,
      koPoint: this.koPoint,
      koColor: this.koColor,
      consecutivePasses: this.consecutivePasses,
      resigned: this.resigned,
      occupied: this.occupied,
    })
  }

  /**
   * 落子。返回 {ok, captured:number[], illegal?:string, move?}
   */
  play(x, y, color = this.turn) {
    if (this.finished) return { ok: false, illegal: '对局已经结束了，开一局新的吧。' }
    if (color !== this.turn) return { ok: false, illegal: '还没轮到这一方落子。' }
    const illegal = this.checkIllegal(x, y, color)
    if (illegal) return { ok: false, illegal }

    this._snapshot()

    const i = this.idx(x, y)
    this.grid[i] = color
    this.occupied++
    const opp = opponent(color)

    const capturedSet = new Set()
    for (const [nx, ny] of this.neighbors(x, y)) {
      if (this.get(nx, ny) !== opp) continue
      const g = this.group(nx, ny)
      if (g.liberties.length === 0) for (const s of g.stones) capturedSet.add(s)
    }
    for (const s of capturedSet) {
      this.grid[s] = EMPTY
      this.occupied--
    }
    const captured = [...capturedSet]

    // 简单劫：恰好提一子，且落下的这颗子自身是「单子一气」
    let ko = -1
    let koColor = 0
    if (captured.length === 1) {
      const own = this.group(x, y)
      if (own.stones.length === 1 && own.liberties.length === 1) {
        ko = captured[0]
        koColor = opp
      }
    }
    this.koPoint = ko
    this.koColor = koColor

    this.captures[color] += captured.length
    this.consecutivePasses = 0
    const move = { n: this.moves.length + 1, color, x, y, pass: false, captured, at: Date.now() }
    this.moves.push(move)
    this.turn = opp
    return { ok: true, captured, move }
  }

  playCoord(name, color = this.turn) {
    const p = parseCoord(name, this.size)
    if (!p) return { ok: false, illegal: `看不懂坐标「${name}」，请写成 D4 / Q16 / pass 这样的形式。` }
    return this.play(p[0], p[1], color)
  }

  pass(color = this.turn) {
    if (this.finished) return { ok: false, illegal: '对局已经结束了。' }
    if (color !== this.turn) return { ok: false, illegal: '还没轮到这一方。' }
    this._snapshot()
    this.consecutivePasses++
    const move = { n: this.moves.length + 1, color, x: -1, y: -1, pass: true, captured: [], at: Date.now() }
    this.moves.push(move)
    this.turn = opponent(color)
    return { ok: true, move }
  }

  resign(color = this.turn) {
    this._snapshot()
    this.resigned = color
    return { ok: true }
  }

  undo(steps = 1) {
    let done = 0
    while (steps-- > 0 && this.history.length > 0) {
      const s = this.history.pop()
      this.grid = s.grid
      this.turn = s.turn
      this.captures = s.captures
      this.moves = this.moves.slice(0, s.moves)
      this.koPoint = s.koPoint
      this.koColor = s.koColor
      this.consecutivePasses = s.consecutivePasses
      this.resigned = s.resigned
      this.occupied = s.occupied
      done++
    }
    return done
  }

  /** 最后一手的位置，用于画标记 */
  get lastMove() {
    return this.moves.length ? this.moves[this.moves.length - 1] : null
  }

  /** 中国规则数子：子 + 该色独占的空点 */
  score() {
    const size = this.size
    const seen = new Uint8Array(size * size)
    let black = 0
    let white = 0
    // 落子数
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] === BLACK) black++
      else if (this.grid[i] === WHITE) white++
    }
    // 空区归属
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = this.idx(x, y)
        if (this.grid[i] !== EMPTY || seen[i]) continue
        const region = []
        const borders = new Set()
        const stack = [i]
        seen[i] = 1
        while (stack.length) {
          const j = stack.pop()
          region.push(j)
          const jx = j % size
          const jy = (j - jx) / size
          for (const [nx, ny] of this.neighbors(jx, jy)) {
            const ni = this.idx(nx, ny)
            const v = this.grid[ni]
            if (v === EMPTY) {
              if (!seen[ni]) {
                seen[ni] = 1
                stack.push(ni)
              }
            } else borders.add(v)
          }
        }
        if (borders.size === 1) {
          if (borders.has(BLACK)) black += region.length
          else white += region.length
        }
        // 双方共界的空点（公气 / 单官）不计入任何一方
      }
    }
    white += this.komi
    return {
      black,
      white,
      komi: this.komi,
      diff: black - white,
      result:
        this.resigned === BLACK
          ? '白中盘胜'
          : this.resigned === WHITE
            ? '黑中盘胜'
            : black > white
              ? `黑胜 ${(black - white).toFixed(1)} 子`
              : white > black
                ? `白胜 ${(white - black).toFixed(1)} 子`
                : '和棋',
    }
  }

  /** 形势粗判，用于教学：只数「确定的地」 */
  estimate() {
    return this.score()
  }

  toJSON({ includeGrid = true } = {}) {
    const sc = this.score()
    return {
      size: this.size,
      komi: this.komi,
      turn: this.turn,
      turnName: this.finished ? null : colorName(this.turn),
      finished: this.finished,
      resigned: this.resigned,
      consecutivePasses: this.consecutivePasses,
      captures: { black: this.captures[BLACK], white: this.captures[WHITE] },
      moveCount: this.moves.length,
      lastMove: this.lastMove
        ? {
            ...this.lastMove,
            coord: this.lastMove.pass ? '停一手' : coordName(this.lastMove.x, this.lastMove.y, this.size),
          }
        : null,
      score: sc,
      grid: includeGrid ? Array.from(this.grid) : undefined,
      starPoints: starPoints(this.size),
    }
  }
}

export function parseCoord(name, size) {
  if (typeof name !== 'string') return null
  const s = name.trim().toUpperCase()
  if (!s || s === 'PASS' || s === '停' || s === '停一手') return null
  const m = /^([A-HJ-Z])\s*(\d{1,2})$/.exec(s)
  if (!m) return null
  const x = COL_LETTERS.indexOf(m[1])
  const num = parseInt(m[2], 10)
  if (x < 0 || num < 1 || num > size) return null
  return [x, size - num]
}

/**
 * 变化图/形势的简易「影响力」估计 —— 教学时用来判断某手棋的价值。
 * 对每个空点，看它最近的棋子距离，产生一个 -1..1 的影响力场（黑为正）。
 */
export function influenceMap(game) {
  const n = game.size
  const inf = new Float32Array(n * n)
  const pts = []
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = game.get(x, y)
      if (v !== EMPTY) pts.push([x, y, v === BLACK ? 1 : -1])
    }
  }
  if (pts.length === 0) return inf
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (game.get(x, y) !== EMPTY) {
        inf[game.idx(x, y)] = game.get(x, y) === BLACK ? 1 : -1
        continue
      }
      let sum = 0
      for (const [px, py, sign] of pts) {
        const d = Math.hypot(x - px, y - py)
        sum += (sign * Math.exp(-d / 2.6)) / (1 + d * 0.35)
      }
      inf[game.idx(x, y)] = Math.max(-1, Math.min(1, sum))
    }
  }
  return inf
}
