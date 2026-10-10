/**
 * dsh-go — 围棋模式界面（纯 DOM + Canvas，零依赖）
 *
 * 这份脚本有两个入口：
 *   1) DSH 会话里的「围棋」标签页：由 lib/client.js 动态插入并调用 __DSH_GO_APP__.mount(el, opts)
 *   2) 独立页面 /dsh-go/app：脚本自己挂到 #dshgo-root 上，方便用浏览器直接调试/截图
 *
 * 棋盘素材：@sabaki/shudan（MIT）的实木棋盘纹理，见 assets/board.jpg。
 */
;(function () {
  'use strict'

  var NS = 'dsh-go'
  var STAR = 'ABCDEFGHJKLMNOPQRSTUVWXYZ'

  /**
   * 解析服务地址。
   *
   * 关键：DSH 桌面端的会话页面跑在自定义协议 `dsh-app://app` 上，
   * shell 只把 `/`、`/index.html`、`/assets/*` 交给本地 dist，
   * **其余路径一律连同上行 cookie 转发给本地宿主 HTTP 服务**。
   * 所以这里必须返回「根相对路径」`/dsh-go`，它在两种宿主下都成立：
   *   - `http://127.0.0.1:19387/...`（独立页面 / 浏览器直连）：同源请求
   *   - `dsh-app://app/...`（桌面端会话页）：经 shell 转发，且自带鉴权 cookie
   * 反过来，写死 `http://127.0.0.1:19387/dsh-go` 在桌面端会变成**跨源**请求，
   * 被浏览器的同源策略挡掉（表现就是「连不上围棋服务」）。
   */
  function resolveBase() {
    try {
      var q = new URLSearchParams(location.search || '').get('dshgoBase')
      if (q) return String(q).replace(/\/$/, '')
      if (window.__DSH_GO__ && window.__DSH_GO__.base) return String(window.__DSH_GO__.base).replace(/\/$/, '')
      var proto = location.protocol
      if (proto === 'http:' || proto === 'https:' || proto === 'dsh-app:') return '/dsh-go'
    } catch (e) {}
    // file:// 之类走不了相对路径的场景，退回本地宿主
    return 'http://127.0.0.1:19387/dsh-go'
  }

  var BASE = resolveBase()

  /* ------------------------------------------------------------------ *
   * 样式
   * ------------------------------------------------------------------ */

  var CSS = [
    '.dshgo-root{--go-ink:#e8e2d6;--go-ink-dim:#a99f8f;--go-bg:#1c1a17;--go-card:#26231f;--go-line:#3a352e;--go-accent:#c98a3c;--go-accent-2:#6fb3a8;',
    'box-sizing:border-box;display:flex;flex-direction:row;justify-content:center;align-items:flex-start;gap:16px;width:100%;height:100%;min-height:0;padding:16px;',
    'background:var(--go-bg);color:var(--go-ink);font-family:var(--ds-font-family-body,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif);font-size:13px;overflow:hidden;}',
    '.dshgo-root *{box-sizing:border-box}',
    '.dshgo-left{display:flex;flex-direction:column;gap:10px;flex:0 0 auto;min-width:0}',
    '.dshgo-stage{position:relative;border-radius:10px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.5)}',
    '.dshgo-stage canvas{display:block;border-radius:10px;cursor:pointer;touch-action:manipulation}',
    '.dshgo-status{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--go-card);border:1px solid var(--go-line);border-radius:8px;padding:7px 11px}',
    '.dshgo-turn{display:inline-flex;align-items:center;gap:7px;font-weight:600}',
    '.dshgo-dot{width:13px;height:13px;border-radius:50%;display:inline-block;border:1px solid rgba(0,0,0,.5);flex:none}',
    '.dshgo-dot.b{background:radial-gradient(circle at 34% 30%,#5a5a5a,#0a0a0a 72%)}',
    '.dshgo-dot.w{background:radial-gradient(circle at 34% 30%,#fff,#c9c9c9 78%)}',
    '.dshgo-status .dshgo-meta{margin-left:auto;display:flex;gap:12px;color:var(--go-ink-dim);font-variant-numeric:tabular-nums}',
    '.dshgo-quick{display:flex;gap:7px;flex-wrap:wrap}',
    '.dshgo-btn{appearance:none;border:1px solid var(--go-line);background:#2e2a25;color:var(--go-ink);border-radius:7px;padding:6px 12px;font:inherit;font-size:12.5px;cursor:pointer;transition:background .15s,border-color .15s,transform .06s}',
    '.dshgo-btn:hover:not(:disabled){background:#3a342c;border-color:#4d453a}',
    '.dshgo-btn:active:not(:disabled){transform:translateY(1px)}',
    '.dshgo-btn:disabled{opacity:.42;cursor:default}',
    '.dshgo-btn.primary{background:linear-gradient(180deg,#d99a45,#b8792a);border-color:#8d5c1d;color:#241a0c;font-weight:700}',
    '.dshgo-btn.primary:hover:not(:disabled){background:linear-gradient(180deg,#e6a850,#c4832f)}',
    '.dshgo-btn.ghost{background:transparent}',
    '.dshgo-right{flex:0 1 430px;min-width:230px;max-width:430px;display:flex;flex-direction:column;gap:11px;overflow-y:auto;overscroll-behavior:contain;padding-right:2px;max-height:100%}',
    '.dshgo-card{background:var(--go-card);border:1px solid var(--go-line);border-radius:9px;padding:11px 12px;flex:none}',
    '.dshgo-card h4{margin:0 0 9px;font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:var(--go-ink-dim);font-weight:700}',
    '.dshgo-row{display:flex;align-items:center;gap:9px;margin:7px 0}',
    '.dshgo-row>label{flex:0 0 62px;color:var(--go-ink-dim);font-size:12px}',
    '.dshgo-seg{display:flex;gap:4px;flex-wrap:wrap;flex:1}',
    '.dshgo-seg button{appearance:none;border:1px solid var(--go-line);background:#211e1a;color:var(--go-ink-dim);border-radius:6px;padding:4px 9px;font:inherit;font-size:12px;cursor:pointer;transition:all .15s}',
    '.dshgo-seg button:hover{color:var(--go-ink);border-color:#4d453a}',
    '.dshgo-seg button.on{background:var(--go-accent);border-color:var(--go-accent);color:#241a0c;font-weight:700}',
    '.dshgo-switch{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;margin:7px 0}',
    '.dshgo-switch input{appearance:none;width:36px;height:20px;border-radius:11px;background:#3a352e;position:relative;cursor:pointer;transition:background .18s;flex:none;margin:0;border:0}',
    '.dshgo-switch input::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#d8d2c6;transition:transform .18s}',
    '.dshgo-switch input:checked{background:var(--go-accent)}',
    '.dshgo-switch input:checked::after{transform:translateX(16px);background:#fff}',
    '.dshgo-hint{color:var(--go-ink-dim);font-size:11.5px;line-height:1.55;margin-top:6px}',
    '.dshgo-cmt{border-left:3px solid var(--go-line);padding:2px 0 2px 9px;margin:9px 0;font-size:12.3px;line-height:1.6}',
    '.dshgo-cmt:first-child{margin-top:0}',
    '.dshgo-cmt .h{display:flex;align-items:center;gap:7px;margin-bottom:3px;flex-wrap:wrap}',
    '.dshgo-cmt .coord{font-weight:700;font-variant-numeric:tabular-nums}',
    '.dshgo-tag{font-size:10.5px;padding:1px 6px;border-radius:20px;background:#3a352e;color:var(--go-ink-dim);white-space:nowrap}',
    '.dshgo-tag.bad{background:#5a2a24;color:#ffb9ab}',
    '.dshgo-tag.good{background:#24463f;color:#9fe0d2}',
    '.dshgo-cmt .txt{color:#cfc7b8}',
    '.dshgo-cmt .warn{color:#ffb9ab;margin-top:3px}',
    '.dshgo-lesson h5{margin:0 0 6px;font-size:13.5px;color:var(--go-accent)}',
    '.dshgo-lesson p{margin:0;line-height:1.75;color:#cfc7b8;font-size:12.5px}',
    '.dshgo-lesson .tip{margin-top:8px;padding:7px 9px;background:#211e1a;border-radius:6px;color:var(--go-ink-dim);font-size:11.5px;line-height:1.6}',
    '.dshgo-empty{color:var(--go-ink-dim);font-size:12px;line-height:1.7}',
    '.dshgo-cta{background:linear-gradient(135deg,#2a3f3a,#26332f);border:1px solid #3f6259;border-radius:9px;padding:10px 12px;flex:none}',
    '.dshgo-cta b{display:block;color:#9fe0d2;margin-bottom:5px;font-size:12.5px}',
    '.dshgo-cta .dshgo-btn{margin-top:8px}',
    '.dshgo-toast{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);background:rgba(20,18,15,.94);border:1px solid var(--go-line);color:#ffd9a8;padding:7px 14px;border-radius:20px;font-size:12.5px;pointer-events:none;opacity:0;transition:opacity .22s;max-width:90%;text-align:center}',
    '.dshgo-toast.on{opacity:1}',
    '.dshgo-score{display:grid;grid-template-columns:1fr auto;gap:3px 10px;font-variant-numeric:tabular-nums;font-size:12.3px;line-height:1.7}',
    '.dshgo-score .k{color:var(--go-ink-dim)}',
    '.dshgo-coach{background:linear-gradient(135deg,#33291b,#2a2318);border:1px solid #5a4423;border-radius:9px;padding:11px 12px;flex:none}',
    '.dshgo-coach .lead{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}',
    '.dshgo-coach .big{font-size:20px;font-weight:800;color:#ffcf87;letter-spacing:.03em;font-variant-numeric:tabular-nums}',
    '.dshgo-coach .now{font-size:13.5px;font-weight:700;color:#ffe6bf;line-height:1.5}',
    '.dshgo-coach .sub{margin-top:8px;padding-top:8px;border-top:1px dashed #4a3a22;color:#cdbfa6;font-size:12.3px;line-height:1.6}',
    '.dshgo-coach .why{color:var(--go-ink-dim);font-size:11.5px;margin-top:4px}',
    '.dshgo-coach .tag{font-size:10.5px;padding:1px 6px;border-radius:20px;background:#4a3a22;color:#ffcf87;white-space:nowrap}',
    '.dshgo-start{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:13px;background:rgba(14,12,9,.74);border-radius:10px;text-align:center;padding:20px}',
    '.dshgo-start .t{font-size:23px;font-weight:800;color:#ffe0ae;letter-spacing:.08em}',
    '.dshgo-start .s{color:#d5c9b4;font-size:12.5px;line-height:1.75;max-width:330px}',
    '.dshgo-start .go{appearance:none;border:0;border-radius:12px;padding:13px 44px;font:inherit;font-size:19px;font-weight:800;letter-spacing:.2em;color:#241a0c;cursor:pointer;background:linear-gradient(180deg,#f0b45c,#c98a3c);box-shadow:0 6px 20px rgba(201,138,60,.42)}',
    '.dshgo-start .go:hover{background:linear-gradient(180deg,#ffc66f,#d89a45)}',
    '.dshgo-start .go:active{transform:translateY(1px)}',
    '.dshgo-legend{display:flex;align-items:center;gap:8px;color:var(--go-ink-dim);font-size:11.5px;margin-top:2px}',
    '.dshgo-legend i{width:15px;height:15px;border-radius:50%;display:inline-block;flex:none;opacity:.45}',
    '.dshgo-legend i.b{background:radial-gradient(circle at 34% 30%,#5a5a5a,#0a0a0a 72%);border:1.5px dashed #ffcf87}',
    '@media (max-width:820px){.dshgo-root{flex-direction:column;overflow-y:auto}.dshgo-right{max-width:none;overflow:visible;width:100%}.dshgo-left{align-items:center}}',
  ].join('')

  function injectCss() {
    var id = NS + '/app.css'
    if (typeof document === 'undefined') return
    if (document.querySelector('style[data-plugin-css="' + id + '"]')) return
    var el = document.createElement('style')
    el.setAttribute('data-plugin', NS)
    el.setAttribute('data-plugin-css', id)
    el.textContent = CSS
    document.head.appendChild(el)
  }

  /* ------------------------------------------------------------------ *
   * 工具
   * ------------------------------------------------------------------ */

  function el(tag, cls, text) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    return e
  }

  function api(path, body) {
    var opt = { headers: { 'Content-Type': 'application/json' } }
    if (body !== undefined) {
      opt.method = 'POST'
      opt.body = JSON.stringify(body)
    }
    return fetch(BASE + path, opt).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok && j && j.error) throw new Error(j.error)
        return j
      })
    })
  }

  function coordName(x, y, size) {
    return STAR[x] + String(size - y)
  }

  /* ------------------------------------------------------------------ *
   * 主应用
   * ------------------------------------------------------------------ */

  function GoApp(root, opts) {
    this.root = root
    this.opts = opts || {}
    this.state = null
    this.hover = null
    this.seq = 0
    this.boardImg = null
    this.boardReady = false
    this.influence = null
    this.lastPlaced = null
    this.stopped = false
    this.build()
    this.load()
    this.loop()
  }

  GoApp.prototype.build = function () {
    var self = this
    this.root.classList.add('dshgo-root')
    this.root.innerHTML = ''

    /* --- 左侧：棋盘 --- */
    var left = el('div', 'dshgo-left')
    this.statusEl = el('div', 'dshgo-status')
    left.appendChild(this.statusEl)

    var stage = el('div', 'dshgo-stage')
    this.canvas = document.createElement('canvas')
    this.canvas.setAttribute('aria-label', '围棋棋盘')
    stage.appendChild(this.canvas)
    this.toastEl = el('div', 'dshgo-toast')
    stage.appendChild(this.toastEl)

    /* 「开始」遮罩：一盘未开时挡在棋盘上，点一下就开下 */
    this.startEl = el('div', 'dshgo-start')
    this.startEl.appendChild(el('div', 't', '围棋模式'))
    var startSub = el('div', 's')
    startSub.textContent = '右边选好路数、难度和对手，点「开始」。'
    this.startEl.appendChild(startSub)
    var startBtn = el('button', 'go', '开 始')
    startBtn.type = 'button'
    startBtn.addEventListener('click', function () {
      self.startDismissed = true
      self.startEl.style.display = 'none'
      self.post('/api/new', {})
    })
    this.startEl.appendChild(startBtn)
    stage.appendChild(this.startEl)
    left.appendChild(stage)
    this.stage = stage

    var quick = el('div', 'dshgo-quick')
    this.btnNew = this.mkBtn('新局', function () {
      self.post('/api/new', {})
    })
    this.btnUndo = this.mkBtn('悔棋', function () {
      self.post('/api/undo', { steps: 2 })
    })
    this.btnPass = this.mkBtn('停一手', function () {
      self.post('/api/pass', {})
    })
    this.btnResign = this.mkBtn('认输', function () {
      if (window.confirm('确定要认输吗？')) self.post('/api/resign', {})
    })
    this.btnHint = this.mkBtn('给我支招', function () {
      self.post('/api/hint', {})
    })
    quick.appendChild(this.btnNew)
    quick.appendChild(this.btnUndo)
    quick.appendChild(this.btnPass)
    quick.appendChild(this.btnResign)
    quick.appendChild(this.btnHint)
    left.appendChild(quick)
    this.root.appendChild(left)
    this.left = left

    /* --- 右侧：面板 --- */
    var right = el('div', 'dshgo-right')

    // 实时教练（最上面，一眼就看到）
    this.coachEl = el('div', 'dshgo-coach')
    right.appendChild(this.coachEl)

    // 轮到鲸娘
    this.ctaEl = el('div', 'dshgo-cta')
    right.appendChild(this.ctaEl)

    // 设置
    var set = el('div', 'dshgo-card')
    set.appendChild(el('h4', null, '对局设置'))

    set.appendChild(
      this.mkRow(
        '棋盘',
        [9, 13, 19].map(function (n) {
          return { label: n + ' 路', value: n }
        }),
        'size'
      )
    )
    set.appendChild(
      this.mkRow(
        '难度',
        (this.state && this.state.levels ? this.state.levels : DEFAULT_LEVELS).map(function (l) {
          return { label: l.name, value: l.id, title: l.desc }
        }),
        'difficulty'
      )
    )
    set.appendChild(
      this.mkRow(
        '对手',
        [
          { label: '鲸娘', value: 'agent', title: '和鲸娘下：你落子后，在对话里让鲸娘应手，她会一边下一边讲。' },
          { label: '本机 AI', value: 'ai', title: '和本机引擎下：落子立刻应手，不用等对话。' },
        ],
        'opponent'
      )
    )
    set.appendChild(
      this.mkRow(
        '执子',
        [
          { label: '黑（先手）', value: 1 },
          { label: '白（后手）', value: 2 },
        ],
        'humanColor'
      )
    )
    set.appendChild(this.mkSwitch('开启教学', 'teaching'))
    set.appendChild(this.mkSwitch('知识点卡片', 'lessons'))
    set.appendChild(this.mkSwitch('推荐落点', 'hints'))
    set.appendChild(this.mkSwitch('显示坐标', 'showCoords'))
    set.appendChild(this.mkSwitch('显示手数', 'showNumbers'))
    set.appendChild(this.mkSwitch('形势判断', 'showInfluence'))
    right.appendChild(set)

    // 教学点评
    var cmt = el('div', 'dshgo-card')
    cmt.appendChild(el('h4', null, '教学点评'))
    this.cmtBody = el('div')
    cmt.appendChild(this.cmtBody)
    right.appendChild(cmt)

    // 知识点
    var les = el('div', 'dshgo-card')
    les.appendChild(el('h4', null, '围棋小课堂'))
    this.lessonBody = el('div')
    les.appendChild(this.lessonBody)
    right.appendChild(les)

    // 形势
    var score = el('div', 'dshgo-card')
    score.appendChild(el('h4', null, '形势判断'))
    this.scoreBody = el('div', 'dshgo-score')
    score.appendChild(this.scoreBody)
    right.appendChild(score)

    this.root.appendChild(right)
    this.right = right

    /* --- 事件 --- */
    this.canvas.addEventListener('mousemove', function (e) {
      var p = self.pick(e)
      var changed = (p && (!self.hover || self.hover[0] !== p[0] || self.hover[1] !== p[1])) || (!p && self.hover)
      self.hover = p
      if (changed) self.draw()
    })
    this.canvas.addEventListener('mouseleave', function () {
      self.hover = null
      self.draw()
    })
    this.canvas.addEventListener('click', function (e) {
      var p = self.pick(e)
      if (!p) return
      self.play(p[0], p[1])
    })

    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function () { self.layout() }) : null
    if (this.ro) {
      this.ro.observe(this.root)
      this.ro.observe(this.left)
    }
    window.addEventListener('resize', this.onWinResize = function () { self.layout() })

    // 棋盘纹理
    var img = new Image()
    img.onload = function () {
      self.boardImg = img
      self.boardReady = true
      self.draw()
    }
    img.onerror = function () {
      self.boardReady = true
      self.draw()
    }
    img.src = BASE + '/assets/board.jpg'
  }

  var DEFAULT_LEVELS = [
    { id: 1, name: '入门' },
    { id: 2, name: '初级' },
    { id: 3, name: '中级' },
    { id: 4, name: '高级' },
    { id: 5, name: '大师' },
  ]
  GoApp.prototype.mkBtn = function (label, fn) {
    var b = el('button', 'dshgo-btn', label)
    b.type = 'button'
    b.addEventListener('click', fn)
    return b
  }

  GoApp.prototype.mkRow = function (label, options, key) {
    var self = this
    var row = el('div', 'dshgo-row')
    row.appendChild(el('label', null, label))
    var seg = el('div', 'dshgo-seg')
    options.forEach(function (o) {
      var b = el('button', null, o.label)
      b.type = 'button'
      if (o.title) b.title = o.title
      b.dataset.key = key
      b.dataset.value = String(o.value)
      b.addEventListener('click', function () {
        var v = o.value
        var body = {}
        body[key] = v
        self.post('/api/settings', body)
      })
      seg.appendChild(b)
    })
    row.appendChild(seg)
    this._rows = this._rows || []
    this._rows.push({ key: key, el: seg })
    return row
  }

  GoApp.prototype.mkSwitch = function (label, key) {
    var self = this
    var wrap = el('label', 'dshgo-switch')
    var input = document.createElement('input')
    input.type = 'checkbox'
    input.dataset.key = key
    input.addEventListener('change', function () {
      var body = {}
      body[key] = input.checked
      self.post('/api/settings', body)
    })
    wrap.appendChild(input)
    wrap.appendChild(el('span', null, label))
    this._switches = this._switches || []
    this._switches.push(input)
    return wrap
  }

  /* ---------------- 布局与绘制 ---------------- */

  GoApp.prototype.layout = function () {
    if (!this.state) return
    var size = this.state.size
    var rootW = this.root.clientWidth || this.root.offsetWidth || 900
    var rightW = this.right ? Math.round(this.right.getBoundingClientRect().width) || 430 : 430
    // 横向：整行居中，棋盘吃掉右侧面板之外的全部宽度（减掉 padding 32 + gap 16）
    var availW = Math.max(260, rootW - rightW - 48)
    // 纵向：状态条 + 棋盘 + 快捷按钮要塞进视口
    var availH = Math.max(260, (window.innerHeight || 800) - 170)
    var px = Math.floor(Math.min(availW, availH, 860))
    px = Math.max(260, px)
    var dpr = window.devicePixelRatio || 1
    this.cssPx = px
    this.canvas.style.width = px + 'px'
    this.canvas.style.height = px + 'px'
    this.canvas.width = Math.round(px * dpr)
    this.canvas.height = Math.round(px * dpr)
    this.ctx = this.canvas.getContext('2d')
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this._size = size
    this.cell = px / (size + 1)
    this.origin = this.cell
    this.draw()
  }

  GoApp.prototype.px = function (x) {
    return this.origin + x * this.cell
  }
  GoApp.prototype.py = function (y) {
    return this.origin + y * this.cell
  }

  GoApp.prototype.pick = function (ev) {
    if (!this.state || this.state.finished) return null
    var r = this.canvas.getBoundingClientRect()
    var mx = ev.clientX - r.left
    var my = ev.clientY - r.top
    var x = Math.round((mx - this.origin) / this.cell)
    var y = Math.round((my - this.origin) / this.cell)
    var size = this.state.size
    if (x < 0 || y < 0 || x >= size || y >= size) return null
    if (Math.hypot(mx - this.px(x), my - this.py(y)) > this.cell * 0.62) return null
    return [x, y]
  }

  GoApp.prototype.draw = function () {
    var st = this.state
    if (!st || !this.ctx) return
    var ctx = this.ctx
    var size = st.size
    var px = this.cssPx
    var cell = this.cell
    var r = cell * 0.468

    ctx.clearRect(0, 0, px, px)

    /* 棋盘底 */
    ctx.save()
    ctx.beginPath()
    roundRect(ctx, 0, 0, px, px, 10)
    ctx.clip()
    if (this.boardReady && this.boardImg) {
      ctx.drawImage(this.boardImg, 0, 0, px, px)
    } else {
      ctx.fillStyle = '#e3ac57'
      ctx.fillRect(0, 0, px, px)
    }
    // 轻微暗角
    var vg = ctx.createRadialGradient(px / 2, px / 2, px * 0.3, px / 2, px / 2, px * 0.78)
    vg.addColorStop(0, 'rgba(255,225,170,0.10)')
    vg.addColorStop(1, 'rgba(60,30,0,0.22)')
    ctx.fillStyle = vg
    ctx.fillRect(0, 0, px, px)
    ctx.restore()

    /* 形势判断叠层 */
    if (st.settings && st.settings.showInfluence && this.influence) {
      ctx.save()
      for (var i = 0; i < this.influence.length; i++) {
        var v = this.influence[i]
        if (Math.abs(v) < 0.12) continue
        var ix = i % size
        var iy = (i - ix) / size
        if (st.grid[i] !== 0) continue
        ctx.fillStyle = v > 0 ? 'rgba(20,20,20,' + Math.min(0.36, Math.abs(v) * 0.42) + ')' : 'rgba(255,255,255,' + Math.min(0.42, Math.abs(v) * 0.5) + ')'
        ctx.fillRect(this.px(ix) - cell / 2, this.py(iy) - cell / 2, cell, cell)
      }
      ctx.restore()
    }

    /* 网格 */
    ctx.save()
    ctx.strokeStyle = 'rgba(52,28,6,0.82)'
    ctx.lineWidth = Math.max(1, cell * 0.036)
    ctx.lineCap = 'round'
    ctx.beginPath()
    for (var k = 0; k < size; k++) {
      ctx.moveTo(this.px(0), this.py(k))
      ctx.lineTo(this.px(size - 1), this.py(k))
      ctx.moveTo(this.px(k), this.py(0))
      ctx.lineTo(this.px(k), this.py(size - 1))
    }
    ctx.stroke()
    // 外框稍粗
    ctx.lineWidth = Math.max(1.4, cell * 0.058)
    ctx.strokeRect(this.px(0), this.py(0), cell * (size - 1), cell * (size - 1))
    ctx.restore()

    /* 星位 */
    ctx.save()
    ctx.fillStyle = 'rgba(52,28,6,0.9)'
    ;(st.starPoints || []).forEach(function (p) {
      ctx.beginPath()
      ctx.arc(this.px(p[0]), this.py(p[1]), Math.max(1.6, cell * 0.085), 0, Math.PI * 2)
      ctx.fill()
    }, this)
    ctx.restore()

    /* 坐标 */
    if (st.settings && st.settings.showCoords) {
      ctx.save()
      ctx.fillStyle = 'rgba(70,40,10,0.72)'
      ctx.font = '600 ' + Math.max(8, cell * 0.33).toFixed(1) + 'px ui-monospace,Menlo,monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (var c = 0; c < size; c++) {
        ctx.fillText(STAR[c], this.px(c), cell * 0.42)
        ctx.fillText(STAR[c], this.px(c), px - cell * 0.42)
        ctx.fillText(String(size - c), cell * 0.42, this.py(c))
        ctx.fillText(String(size - c), px - cell * 0.42, this.py(c))
      }
      ctx.restore()
    }

    /* 棋子 */
    var last = st.lastMove
    var numAt = null
    if (st.settings && st.settings.showNumbers && st.moveList) {
      numAt = {}
      for (var mi = 0; mi < st.moveList.length; mi++) {
        var mv = st.moveList[mi]
        if (mv && mv.pass !== true && typeof mv.x === 'number') numAt[mv.y * size + mv.x] = mv.n || mi + 1
      }
    }
    for (var yy = 0; yy < size; yy++) {
      for (var xx = 0; xx < size; xx++) {
        var v = st.grid[yy * size + xx]
        if (!v) continue
        var lbl = numAt ? numAt[yy * size + xx] : undefined
        this.stone(ctx, xx, yy, v, r, 1, lbl)
      }
    }

    /* 最后一手标记 */
    if (last && !last.pass && !(st.settings && st.settings.showNumbers)) {
      var lx = this.px(last.x)
      var ly = this.py(last.y)
      ctx.save()
      ctx.beginPath()
      ctx.arc(lx, ly, Math.max(2, r * 0.26), 0, Math.PI * 2)
      ctx.fillStyle = last.color === 1 ? 'rgba(255,255,255,0.94)' : 'rgba(20,20,20,0.9)'
      ctx.fill()
      ctx.restore()
    }

    /* 半透明推荐棋子（教练指出「下这儿」） */
    if (st.hints && st.hints.length && !st.finished) {
      var hcol = st.settings ? st.settings.humanColor : 1
      for (var hi = st.hints.length - 1; hi >= 0; hi--) {
        var hp = st.hints[hi]
        if (st.grid[hp.y * size + hp.x] !== 0) continue
        var gx = this.px(hp.x)
        var gy = this.py(hp.y)
        var ga = hi === 0 ? 0.5 : hi === 1 ? 0.33 : 0.22
        ctx.save()
        ctx.globalAlpha = ga
        ctx.beginPath()
        ctx.arc(gx, gy, r, 0, Math.PI * 2)
        var grd = ctx.createRadialGradient(gx - r * 0.32, gy - r * 0.34, r * 0.12, gx, gy, r)
        if (hcol === 2) {
          grd.addColorStop(0, '#ffffff')
          grd.addColorStop(1, '#c2c2c2')
        } else {
          grd.addColorStop(0, '#6e6e6e')
          grd.addColorStop(1, '#0a0a0a')
        }
        ctx.fillStyle = grd
        ctx.fill()
        ctx.restore()
        if (hi === 0) {
          ctx.save()
          ctx.setLineDash([Math.max(2, r * 0.34), Math.max(2, r * 0.26)])
          ctx.lineWidth = Math.max(1.4, r * 0.17)
          ctx.strokeStyle = 'rgba(255,207,135,0.95)'
          ctx.beginPath()
          ctx.arc(gx, gy, r * 0.95, 0, Math.PI * 2)
          ctx.stroke()
          ctx.restore()
        }
        ctx.save()
        ctx.globalAlpha = 0.6 + ga * 0.6
        ctx.fillStyle = hcol === 2 ? 'rgba(24,24,24,0.92)' : 'rgba(255,255,255,0.95)'
        ctx.font = '700 ' + Math.max(8, r * 0.86).toFixed(1) + 'px ui-monospace,Menlo,monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(hp.rank), gx, gy + r * 0.04)
        ctx.restore()
      }
    }

    /* 悬停虚影 */
    if (this.hover && !st.finished && st.grid[this.hover[1] * size + this.hover[0]] === 0) {
      var hc = st.settings ? st.settings.humanColor : 1
      var legal = st.legalSet ? st.legalSet[this.hover[1] * size + this.hover[0]] !== 0 : true
      this.stone(ctx, this.hover[0], this.hover[1], legal ? hc : 3, r, legal ? 0.42 : 0.2)
    }
  }

  GoApp.prototype.stone = function (ctx, x, y, color, r, alpha, label) {
    var cx = this.px(x)
    var cy = this.py(y)
    ctx.save()
    ctx.globalAlpha = alpha
    // 阴影
    ctx.beginPath()
    ctx.ellipse(cx + r * 0.09, cy + r * 0.12, r * 0.97, r * 0.92, 0, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0,0,0,0.28)'
    ctx.fill()
    // 棋子本体
    var g = ctx.createRadialGradient(cx - r * 0.34, cy - r * 0.38, r * 0.12, cx, cy, r * 1.06)
    if (color === 1) {
      g.addColorStop(0, '#6e6e6e')
      g.addColorStop(0.35, '#2c2c2c')
      g.addColorStop(1, '#050505')
    } else if (color === 2) {
      g.addColorStop(0, '#ffffff')
      g.addColorStop(0.42, '#f2f1ec')
      g.addColorStop(1, '#c2c0ba')
    } else {
      g.addColorStop(0, 'rgba(255,120,120,0.85)')
      g.addColorStop(1, 'rgba(180,40,40,0.7)')
    }
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = g
    ctx.fill()
    ctx.lineWidth = Math.max(0.7, r * 0.05)
    ctx.strokeStyle = color === 1 ? 'rgba(0,0,0,0.85)' : 'rgba(150,148,142,0.9)'
    ctx.stroke()
    // 高光
    if (color !== 3) {
      ctx.beginPath()
      ctx.ellipse(cx - r * 0.3, cy - r * 0.36, r * 0.32, r * 0.2, -0.7, 0, Math.PI * 2)
      ctx.fillStyle = color === 1 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.95)'
      ctx.fill()
    }
    // 手数
    if (label !== undefined && label !== null && color !== 3) {
      ctx.font = '600 ' + Math.max(7, Math.round(r * 0.92)) + 'px -apple-system,"Segoe UI","Microsoft YaHei",sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = color === 1 ? 'rgba(255,255,255,0.92)' : 'rgba(24,24,24,0.9)'
      ctx.fillText(String(label), cx, cy + r * 0.04)
    }
    ctx.restore()
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  /* ---------------- 状态同步 ---------------- */

  GoApp.prototype.load = function (attempt) {
    var self = this
    var n = attempt || 0
    api('/api/state')
      .then(function (r) {
        if (r && r.state) self.setState(r.state)
      })
      .catch(function (e) {
        // 宿主可能正在重启，先悄悄重试几次再报错
        if (n < 3) {
          setTimeout(function () { self.load(n + 1) }, 400 * (n + 1))
          return
        }
        self.toast('连不上围棋服务：' + e.message + '（' + BASE + '）')
      })
  }

  GoApp.prototype.loop = function () {
    var self = this
    function tick() {
      if (self.stopped) return
      api('/api/wait?since=' + self.seq + '&timeout=20000')
        .then(function (r) {
          if (r && r.state) self.setState(r.state)
          setTimeout(tick, 60)
        })
        .catch(function () {
          setTimeout(tick, 2000)
        })
    }
    setTimeout(tick, 120)
  }

  GoApp.prototype.setState = function (st) {
    var first = !this.state
    this.state = st
    this.seq = st.seq
    if (st.moveList) this.moveList = st.moveList
    if (first || (this._size !== st.size)) {
      this.layout()
    } else {
      this.draw()
    }
    this.renderStatus()
    this.renderPanel()
    if (st.influence) this.influence = st.influence
  }

  GoApp.prototype.renderStatus = function () {
    var st = this.state
    var s = st.settings
    this.statusEl.innerHTML = ''
    var turn = el('span', 'dshgo-turn')
    if (st.finished) {
      turn.appendChild(el('span', null, '对局结束'))
    } else {
      turn.appendChild(el('span', 'dshgo-dot ' + (st.turn === 1 ? 'b' : 'w')))
      var who = st.pendingFor === 'human' ? '轮到主人' : st.pendingFor === 'agent' ? '轮到鲸娘' : '轮到本机 AI'
      turn.appendChild(el('span', null, who + '（' + (st.turn === 1 ? '黑' : '白') + '）'))
    }
    this.statusEl.appendChild(turn)
    var meta = el('div', 'dshgo-meta')
    meta.appendChild(el('span', null, '第 ' + st.moveCount + ' 手'))
    meta.appendChild(el('span', null, '提子 黑' + st.captures.black + ' / 白' + st.captures.white))
    meta.appendChild(el('span', null, st.level))
    this.statusEl.appendChild(meta)
    this.btnUndo.disabled = st.moveCount === 0
    this.btnPass.disabled = st.finished || st.pendingFor !== 'human'
    this.btnResign.disabled = st.finished
    this.btnHint.disabled = st.finished || st.pendingFor !== 'human'
    // 同步控件
    ;(this._rows || []).forEach(function (row) {
      var want = String(st.settings[row.key])
      Array.prototype.forEach.call(row.el.children, function (b) {
        b.classList.toggle('on', b.dataset.value === want)
      })
    })
    ;(this._switches || []).forEach(function (input) {
      input.checked = !!st.settings[input.dataset.key]
    })
  }

  GoApp.prototype.renderPanel = function () {
    var st = this.state

    /* 「开始」遮罩：一盘未开、且没被手动关掉时挡在棋盘上 */
    if (this.startEl) {
      var showStart = !st.finished && st.moveCount === 0 && !this.startDismissed
      this.startEl.style.display = showStart ? '' : 'none'
    }

    /* 实时教练 */
    this.coachEl.innerHTML = ''
    var co = st.coach || {}
    var lead = el('div', 'lead')
    if (st.finished) {
      lead.appendChild(el('div', 'now', '对局结束'))
    } else if (st.pendingFor === 'human' && co.suggest) {
      lead.appendChild(el('div', 'big', co.suggest))
      lead.appendChild(el('span', 'tag', '推荐'))
      lead.appendChild(el('div', 'now', '下这里'))
    } else if (st.pendingFor === 'agent') {
      lead.appendChild(el('div', 'now', '等鲸娘落子…'))
    } else if (st.pendingFor === 'human') {
      lead.appendChild(el('div', 'now', '轮到你了，点棋盘落子'))
    } else {
      lead.appendChild(el('div', 'now', '本机 AI 思考中…'))
    }
    this.coachEl.appendChild(lead)
    if (co.suggestWhy && st.pendingFor === 'human' && !st.finished) {
      this.coachEl.appendChild(el('div', 'why', '💡 ' + co.suggestWhy))
    }
    if (co.brief) {
      var sub = el('div', 'sub')
      sub.textContent = (co.who && co.coord ? co.who + ' ' + co.coord + '　' : '') + co.brief
      this.coachEl.appendChild(sub)
    } else if (st.finished && st.result) {
      this.coachEl.appendChild(el('div', 'sub', String(st.result).split('\n')[0]))
    }

    /* CTA */
    this.ctaEl.innerHTML = ''
    if (st.pendingFor === 'agent' && !st.finished) {
      this.ctaEl.style.display = ''
      this.ctaEl.appendChild(el('b', null, '轮到鲸娘了'))
      var lastTxt = st.lastMove ? (st.lastMove.pass ? '停一手' : coordName(st.lastMove.x, st.lastMove.y, st.size)) : '开局'
      var d = el('div', 'dshgo-hint', '你刚下了 ' + lastTxt + '。点下面的按钮，鲸娘就会在棋盘上应手并给你讲解。')
      this.ctaEl.appendChild(d)
      var self = this
      var b = el('button', 'dshgo-btn primary', '请鲸娘落子 →')
      b.type = 'button'
      b.addEventListener('click', function () {
        self.askAgent()
      })
      this.ctaEl.appendChild(b)
    } else {
      this.ctaEl.style.display = 'none'
    }

    /* 点评 */
    this.cmtBody.innerHTML = ''
    if (!st.settings.teaching) {
      this.cmtBody.appendChild(el('div', 'dshgo-empty', '教学已关闭。打开「开启教学」后，每一手都会有规则讲解和好坏评价。'))
    } else if (!st.commentary || st.commentary.length === 0) {
      var e0 = el('div', 'dshgo-empty')
      e0.textContent = st.advice || '落子之后，这里会显示这一手的得失分析。'
      this.cmtBody.appendChild(e0)
    } else {
      st.commentary.slice(0, 3).forEach(function (c) {
        var box = el('div', 'dshgo-cmt')
        var h = el('div', 'h')
        var who = c.by === 'human' ? '主人' : c.by === 'agent' ? '鲸娘' : 'AI'
        h.appendChild(el('span', 'coord', who + ' · ' + c.coord))
        if (c.grade) {
          var cls = c.grade === '好棋' ? 'good' : c.grade === '失误' || c.grade === '值得商榷' ? 'bad' : ''
          h.appendChild(el('span', 'dshgo-tag ' + cls, c.grade))
        }
        box.appendChild(h)
        box.appendChild(el('div', 'txt', c.brief || c.text))
        if (c.danger) box.appendChild(el('div', 'warn', '⚠ ' + c.danger))
        this.cmtBody.appendChild(box)
      }, this)
    }

    /* 知识点 */
    this.lessonBody.innerHTML = ''
    if (st.lesson && st.settings.lessons) {
      var wrap = el('div', 'dshgo-lesson')
      wrap.appendChild(el('h5', null, st.lesson.title))
      wrap.appendChild(el('p', null, st.lesson.body))
      if (st.lesson.tip) wrap.appendChild(el('div', 'tip', '💡 ' + st.lesson.tip))
      this.lessonBody.appendChild(wrap)
    } else {
      this.lessonBody.appendChild(el('div', 'dshgo-empty', st.settings.lessons ? '下几手之后会开始推送围棋知识点。' : '知识点卡片已关闭。'))
    }

    /* 形势 */
    this.scoreBody.innerHTML = ''
    var rows = [
      ['黑棋', String(st.score.black)],
      ['白棋（含贴目 ' + st.score.komi + '）', String(st.score.white)],
      ['判断', st.score.result],
    ]
    if (st.result) rows.push(['终局', st.result])
    rows.forEach(function (r) {
      this.scoreBody.appendChild(el('div', 'k', r[0]))
      this.scoreBody.appendChild(el('div', null, r[1]))
    }, this)
  }

  /* ---------------- 动作 ---------------- */

  GoApp.prototype.post = function (path, body) {
    var self = this
    return api(path, body)
      .then(function (r) {
        if (r && r.state) self.setState(r.state)
        if (r && r.error) self.toast(r.error)
        if (r && r.message) self.toast(r.message)
        return r
      })
      .catch(function (e) {
        self.toast(e.message)
      })
  }

  GoApp.prototype.play = function (x, y) {
    var self = this
    this.startDismissed = true
    if (this.startEl) this.startEl.style.display = 'none'
    var st = this.state
    if (!st) return undefined
    if (st.finished) return this.toast('对局已经结束了，点「新局」再来一盘。')
    if (st.pendingFor !== 'human') {
      return this.toast(st.pendingFor === 'agent' ? '轮到鲸娘了，先请她应手。' : '现在是 AI 的回合。')
    }
    if (st.grid[y * st.size + x] !== 0) return this.toast('这个点已经有子了。')
    this.lastPlaced = [x, y]
    return this.post('/api/play', { x: x, y: y }).then(function (r) {
      if (r && r.ok && r.commentary && r.commentary.danger) self.toast('⚠ ' + r.commentary.danger)
      return r
    })
  }

  GoApp.prototype.askAgent = function () {
    var st = this.state
    var lastTxt = st.lastMove ? (st.lastMove.pass ? '（我停了一手）' : coordName(st.lastMove.x, st.lastMove.y, st.size)) : '（开局）'
    var msg =
      '【围棋模式】轮到你了。棋盘 ' +
      st.size +
      ' 路，你执' +
      (st.settings.humanColor === 1 ? '白' : '黑') +
      '。我刚刚下了 ' +
      lastTxt +
      '。\n请先调用 go_state 看清局面，然后用 go_play 落下你的一手' +
      (st.settings.teaching ? '，并点评我刚才那一手（好在哪里、问题在哪里），以及告诉我接下来该注意什么' : '') +
      '。'
    var ia = this.opts.inputActions
    if (ia && typeof ia.setDraft === 'function') {
      try {
        ia.setDraft(msg)
      } catch (e) {}
      if (typeof ia.submit === 'function') {
        try {
          ia.submit()
          this.toast('已经把消息发给鲸娘了')
          return
        } catch (e) {}
      }
      this.toast('已经把提示词填进输入框，按回车发送即可')
      return
    }
    // 独立页面：复制到剪贴板
    try {
      navigator.clipboard.writeText(msg)
      this.toast('提示词已复制到剪贴板，粘贴到对话里发送即可')
    } catch (e) {
      window.prompt('把下面这段话发给鲸娘：', msg)
    }
  }

  GoApp.prototype.toast = function (msg) {
    var self = this
    if (!msg) return
    this.toastEl.textContent = msg
    this.toastEl.classList.add('on')
    clearTimeout(this._toastT)
    this._toastT = setTimeout(function () {
      self.toastEl.classList.remove('on')
    }, 3200)
  }

  GoApp.prototype.destroy = function () {
    this.stopped = true
    if (this.ro) this.ro.disconnect()
    if (this.onWinResize) window.removeEventListener('resize', this.onWinResize)
    clearTimeout(this._toastT)
  }

  /* ------------------------------------------------------------------ *
   * 对外接口
   * ------------------------------------------------------------------ */

  var mounted = new WeakMap()

  window.__DSH_GO_APP__ = {
    mount: function (node, opts) {
      if (!node) return null
      injectCss()
      var old = mounted.get(node)
      if (old) old.destroy()
      var app = new GoApp(node, opts)
      mounted.set(node, app)
      return app
    },
    unmount: function (node) {
      var app = node ? mounted.get(node) : null
      if (app) {
        app.destroy()
        mounted.delete(node)
      }
    },
    version: '1.0.0',
    base: BASE,
  }

  function autoMount() {
    var n = document.getElementById('dshgo-root')
    if (!n) return
    injectCss()
    window.__DSH_GO_APP__.mount(n, {
      inputActions: window.__DSH_GO_INPUT__ || null,
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount)
  } else {
    autoMount()
  }
})()
