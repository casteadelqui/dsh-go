/**
 * dsh-go — 教学模式内容（纯 JS，零依赖）
 *
 * 两部分：
 *  1) LESSONS —— 围棋基础知识卡，第一次玩按顺序刷，之后随机复习。
 *  2) annotateMove() —— 对某一手棋做规则层面的点评（提子/打吃/自杀/劫/连接/分断/眼…）。
 */

import { BLACK, WHITE, EMPTY, opponent, colorName, coordName, GoGame } from './engine.js'

export const LESSONS = [
  {
    id: 'basics-board',
    title: '棋盘与落子',
    level: 1,
    body: '棋盘是 19×19 的交叉点（初学用 9×9 更容易上手）。棋子下在**交叉点**上，不是格子里。黑先白后，一人一手，落子无悔——下了就不能挪。',
    tip: '横坐标 A–T（跳过 I），纵坐标从下往上 1–19。',
  },
  {
    id: 'basics-liberty',
    title: '气：棋子的命',
    level: 1,
    body: '一颗子上下左右紧挨着的**空点**就是它的「气」。一颗子最多 4 口气，边上的子 3 口，角上的子 2 口。**没有气的棋子就被提掉**——这是围棋唯一的核心规则。',
    tip: '连在一起的同色棋子共享气，算作一整块。',
  },
  {
    id: 'basics-capture',
    title: '提子',
    level: 1,
    body: '当你落子后，对方某块棋的**气变成 0**，就把它整块从棋盘上拿走，放进你的「提子」里。注意是整块一起提，不是一颗。',
    tip: '被提掉的子所在的交叉点又变回空点，可以再下。',
  },
  {
    id: 'basics-suicide',
    title: '禁入点（不能自杀）',
    level: 1,
    body: '如果一手棋落下后**自己**立刻没气，而这一手又没有提到对方的子，那这手棋是不允许下的，叫「禁入点」。',
    tip: '但如果这一手能提到对方的子，就不算自杀——那是提子。',
  },
  {
    id: 'basics-ko',
    title: '劫',
    level: 2,
    body: '如果双方可以互相提一颗子、没完没了，规则规定：**被提之后不能立刻回提**，必须先在别处下一手（叫「找劫材」），对方应了之后才能回来提。',
    tip: '劫是围棋里最容易下错的地方，多看两步再动手。',
  },
  {
    id: 'basics-eye',
    title: '眼与活棋',
    level: 2,
    body: '被自己棋子完全围住的空点叫「眼」。**一块棋有两个真眼就永远杀不死**——对方无法同时填掉两个眼（填进去自己会没气）。',
    tip: '所以做活的关键不是「多」，而是「做出两个分开的眼」。',
  },
  {
    id: 'basics-false-eye',
    title: '假眼',
    level: 3,
    body: '看着像眼，其实对方可以随时填掉（或者填掉后你被迫自紧一气）的眼叫「假眼」。判断标准：围住这个眼的棋子是不是**完整连成一块**。',
    tip: '一块棋由一个真眼 + 一个假眼构成，是死棋。',
  },
  {
    id: 'basics-atari',
    title: '打吃（叫吃）',
    level: 2,
    body: '把对方一块棋的气打到只剩 1 口，叫「打吃」。对方必须马上处理：逃跑（长气）、反吃（打吃你）、或者弃子。',
    tip: '打吃之前先想：对方会不会跑掉，跑掉之后我亏不亏？',
  },
  {
    id: 'basics-connect',
    title: '连接与分断',
    level: 2,
    body: '把自己的棋连成一块，气多、不容易被吃；把对方的棋切开，它就变成两块弱棋。「**连、断**」是围棋最基础的两个动作。',
    tip: '看到对方两块棋的接缝，那里通常就是要点。',
  },
  {
    id: 'basics-ladder',
    title: '征子（征吃）',
    level: 3,
    body: '对方一块棋只有 2 口气，你一路打吃、它一路跑，最后被逼到边上吃掉——这叫「征子」。征子的前提是**逃跑路线上没有对方的接应子**。',
    tip: '下征子之前，一定要顺着逃跑路线看一遍有没有对方的伏兵。',
  },
  {
    id: 'basics-net',
    title: '枷吃（网）',
    level: 3,
    body: '不直接打吃，而是用一手棋把对方的出路**罩住**，让它跑也跑不掉、气也不够，这叫枷吃。比征子更稳，因为它不怕对方接应。',
    tip: '对方逃跑方向越明确，枷吃越有效。',
  },
  {
    id: 'basics-double-atari',
    title: '双打吃',
    level: 3,
    body: '一手棋同时打吃对方**两块**棋。对方只能救一块，你必得一块——这是初学者最容易吃到子的手段。',
    tip: '找对方两块棋「共同的气」，那里往往就是双打吃的点。',
  },
  {
    id: 'basics-opening',
    title: '布局：金角银边草肚皮',
    level: 3,
    body: '棋盘上**角**最容易围空（两面靠边），**边**次之，**中腹**最难。所以开局先占角，再守边或挂角，最后才考虑中腹。',
    tip: '三线偏实地，四线偏外势，开局一般走在三、四线。',
  },
  {
    id: 'basics-star',
    title: '常见占角点：星、小目、三三',
    level: 3,
    body: '**星位**（4-4）取势、速度快；**小目**（3-4）重实地、变化多；**三三**（3-3）直接拿走角地。开局先占四个角，是几百年的共识。',
    tip: '9 路棋盘上的星位就是 (2,2)、(6,2)、(4,4) 这几个点。',
  },
  {
    id: 'basics-influence',
    title: '厚势与薄棋',
    level: 4,
    body: '连成一片、没有弱点的棋叫「厚」，它的价值在于**影响力**，能用来攻击对方；零散、气紧、没做活的棋叫「薄」，随时可能被攻击。',
    tip: '厚势不要直接围空，要用来逼对方、换实地。',
  },
  {
    id: 'basics-yose',
    title: '官子：最后的收束',
    level: 4,
    body: '中盘结束后，双方把边界一点点确定下来，这个过程叫「官子」。官子比的是**谁先手、谁的价值大**：先收大的，再收小的。',
    tip: '业余低段常常在官子上输掉十几目，别小看它。',
  },
  {
    id: 'basics-scoring',
    title: '怎么算胜负',
    level: 4,
    body: '本插件用**中国规则（数子）**：终局时把自己颜色围住的空点 + 自己的活子数出来，多者胜。白棋因为后手，要额外补 7.5 目（贴目）。',
    tip: '两边都停一手，或者点「认输」，对局就结束了。',
  },
  {
    id: 'basics-etiquette',
    title: '对局礼仪',
    level: 1,
    body: '落子无悔、不干扰对手、结束后一起复盘。输棋是最好的老师——每一盘输掉的棋里，都藏着你还没学会的那一手。',
    tip: '复盘比多下十盘更有用，这也是鲸娘陪主人下棋的意义。',
  },
]

export function lessonById(id) {
  return LESSONS.find((l) => l.id === id) || null
}

export function pickLessons(level = 1, count = 3, seed = Date.now()) {
  const pool = LESSONS.filter((l) => l.level <= level)
  if (pool.length === 0) return []
  let s = seed >>> 0
  const rand = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296)
  const arr = pool.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr.slice(0, count)
}

/* ------------------------------------------------------------------ *
 * 落子点评
 * ------------------------------------------------------------------ */

/**
 * 分析一手棋，返回教学点评。
 * @param {GoGame} before  落子前的局面（这一手尚未落）
 * @param {number} x
 * @param {number} y
 * @param {number} color
 * @returns {{tags:string[], text:string, danger:string|null, shape:string|null}}
 */
export function annotateMove(before, x, y, color) {
  const size = before.size
  const opp = opponent(color)
  const coord = coordName(x, y, size)
  const tags = []
  const notes = []

  const probe = before.clone()
  const res = probe.play(x, y, color)
  if (!res.ok) {
    return { tags: ['非法'], text: res.illegal || '这一手不合法。', danger: res.illegal || null, shape: null }
  }

  // --- 提子 ---
  if (res.captured.length > 0) {
    tags.push('提子')
    notes.push(`第 ${coord} 手提掉对方 ${res.captured.length} 子`)
    if (res.captured.length >= 3) notes.push('这是一次可观的收获')
  }

  // --- 落子前的战术背景 ---
  let rescued = 0
  let savedStones = 0
  for (const [nx, ny] of before.neighbors(x, y)) {
    if (before.get(nx, ny) !== color) continue
    const g = before.group(nx, ny)
    if (g.liberties.length === 1 && g.liberties[0] === before.idx(x, y)) {
      rescued++
      savedStones += g.stones.length
    }
  }
  if (rescued > 0) {
    tags.push('接回')
    notes.push(`接回了被打吃的 ${savedStones} 子，长出一口气`)
  }

  let newAtari = 0
  let atariStones = 0
  const atariTargets = []
  for (const [nx, ny] of probe.neighbors(x, y)) {
    if (probe.get(nx, ny) !== opp) continue
    const g = probe.group(nx, ny)
    if (g.liberties.length === 1) {
      newAtari++
      atariStones += g.stones.length
      atariTargets.push([nx, ny, g.stones.length])
    }
  }
  if (newAtari >= 2) {
    tags.push('双打吃')
    notes.push(`一手同时打吃对方 ${newAtari} 块棋，对方只能救一块——这是好手`)
  } else if (newAtari === 1) {
    tags.push('打吃')
    notes.push(`打吃对方 ${atariStones} 子，逼对方应对`)
  }

  // --- 自身安全 ---
  const own = probe.group(x, y)
  let danger = null
  if (own.liberties.length === 1) {
    tags.push('危险')
    danger = `第 ${coord} 点落下后自己只剩 1 口气，对方只要再下一手就能把你提掉。`
    notes.push('⚠️ 这一手把自己送进了打吃')
  } else if (own.liberties.length === 2 && own.stones.length >= 2) {
    notes.push('这块棋只有 2 口气，注意随时可能被攻击')
  } else if (own.liberties.length >= 4 && own.stones.length >= 3) {
    tags.push('安全')
  }

  // --- 连接 / 分断 ---
  let ownAdj = 0
  let oppAdj = 0
  for (const [nx, ny] of before.neighbors(x, y)) {
    const v = before.get(nx, ny)
    if (v === color) ownAdj++
    else if (v === opp) oppAdj++
  }
  if (ownAdj >= 2) {
    tags.push('连接')
    notes.push('把两边自己的棋连成了一块，气更长、更不容易被吃')
  }
  if (ownAdj >= 1 && oppAdj >= 1) {
    tags.push('切断')
    notes.push('同时贴着对方和自己——这一手有「切断」的意味')
  }

  // --- 劫 ---
  if (res.captured.length === 1 && own.stones.length === 1 && own.liberties.length === 1) {
    tags.push('劫')
    notes.push('形成了劫争：对方不能立刻回提，得先去找劫材')
  }
  if (before.koPoint === before.idx(x, y)) {
    tags.push('劫争')
  }

  // --- 眼 / 做活 ---
  const size2 = size
  let eyeLike = 0
  for (const [nx, ny] of before.neighbors(x, y)) {
    if (before.get(nx, ny) !== EMPTY) continue
    let surrounded = true
    for (const [ax, ay] of before.neighbors(nx, ny)) {
      if (ax === x && ay === y) continue
      if (before.get(ax, ay) !== color) {
        surrounded = false
        break
      }
    }
    if (surrounded) eyeLike++
  }
  if (eyeLike > 0 && before.moves.length > size2 * 1.5) {
    tags.push('做眼')
    notes.push('这一手帮助围出了眼位，是求活的方向')
  }

  // --- 位置 / 布局 ---
  const line = Math.min(x, y, size - 1 - x, size - 1 - y) + 1
  if (before.moves.length < size * 2) {
    if (line === 1) {
      tags.push('位置偏低')
      danger = danger || '第一线的棋几乎围不到空，开局尽量走三线、四线。'
      notes.push('走在第一线，价值很低')
    } else if (line === 3 || line === 4) {
      tags.push('好点')
      notes.push(line === 3 ? '三线：兼顾实地的好位置' : '四线：取外势的好位置')
    } else if (line >= 6) {
      tags.push('偏中腹')
      notes.push('开局走在高位，容易落空，除非是要围大模样')
    }
  }

  // --- 贴身 / 无理 ---
  if (oppAdj > 0 && own.liberties.length <= 2) {
    notes.push('贴身战的棋要算清气的长短，别急着动手')
  }

  let shape = null
  if (ownAdj === 1 && line >= 2) shape = '长（延伸）'
  else if (ownAdj === 0 && Math.abs(x - y) >= 2 && line >= 3 && line <= 4) shape = '拆（展开）'

  const head = `第 ${coord} 点`
  const text = notes.length > 0 ? `${head}：${notes.join('；')}。` : `${head}：稳当的一手，暂时没有明显得失。`

  return { tags, text, danger, shape }
}

/** 开局建议：空盘时给主人一个起步方案 */
export function openingAdvice(size) {
  if (size === 9) {
    return '9 路棋盘：先占 (2,2)、(6,6) 这两个角，再去抢 (4,4) 这个中心星位。9 路重战斗，别怕打起来。'
  }
  if (size === 13) {
    return '13 路棋盘：先占四个角的星位（3,3）(9,3)(3,9)(9,9)，再往边上拆。比 9 路有布局空间，又不至于像 19 路那么漫长。'
  }
  return '19 路棋盘：先占四个角的星位（D4/Q4/D16/Q16），再挂角或守角。记住「金角银边草肚皮」——角和边比中腹值钱。'
}

/** 终局总结 */
export function summarize(game) {
  const sc = game.score()
  const lines = []
  lines.push(`共下 ${game.moves.length} 手，黑提 ${game.captures[BLACK]} 子，白提 ${game.captures[WHITE]} 子。`)
  lines.push(`数子结果：黑 ${sc.black}，白 ${sc.white}（含贴目 ${sc.komi}），${sc.result}。`)
  if (game.moves.length < game.size * 1.2) {
    lines.push('这盘结束得比较早，下次可以多下几手再收官，能学到更多。')
  }
  const blunders = game.moves.filter((m) => m.captured && m.captured.length >= 4)
  if (blunders.length) lines.push(`本局出现过 ${blunders.length} 次大提子，注意别让整块棋只剩一口气。`)
  return lines.join('\n')
}

/* ------------------------------------------------------------------ *
 * 一句话短评：给棋盘旁边那块「实时教练」用，越短越精辟
 * ------------------------------------------------------------------ */

/**
 * 把手棋的评级、标签、危险压成一句 ≤ 20 字的短评。
 * @param {string|null} grade 好棋 / 可行 / 稍缓 / 值得商榷 / 失误
 * @param {string[]} tags annotateMove 给的标签
 * @param {string|null} danger 危险提示
 * @param {'human'|'agent'|'ai'} by 谁下的
 */
export function briefLine(grade, tags = [], danger, by = 'human') {
  const has = (t) => tags.indexOf(t) >= 0
  const mine = by === 'human'
  if (danger) return '⚠ ' + String(danger).replace(/[。！]/g, '').slice(0, 16)
  if (has('提子')) return mine ? '吃子成功，接着补断' : '你这块被吃了，注意气'
  if (has('双打吃')) return mine ? '双打吃！两边必得一边' : '被双打吃了，先救大的'
  if (has('打吃')) return mine ? '打吃，对方必须应' : '你被打了，先长或接'
  if (has('接回')) return '接回来了，稳'
  if (has('做眼')) return '做眼，这块基本活了'
  if (has('连接')) return '连成一块，气更长'
  if (has('切断')) return mine ? '切断对方，有得打' : '被切断了，两头要照顾'
  if (has('劫')) return '开劫了，记得留劫材'
  if (has('位置偏低')) return '太低了，往里收一路'
  if (has('偏中腹')) return '飘了，先顾角边'
  if (grade === '好棋') return '好棋，位置很正'
  if (grade === '失误') return mine ? '这手亏了，被抢先' : '对方这手占了便宜'
  if (grade === '值得商榷') return mine ? '有点缓，被抢了先手' : '对方稍慢，你可以抢'
  if (grade === '稍缓') return mine ? '还行，稍慢半拍' : '对方稳了一手'
  return mine ? '还行，稳住节奏' : '对方跟着你走'
}

