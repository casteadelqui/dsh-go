/**
 * dsh-go-mode — DSH 浏览器半侧
 *
 * 在会话的 conversation.view 环里注册一个「围棋」标签页。
 * 真正的界面（棋盘 / 面板 / 教学）由宿主在 /dsh-go/app.js 提供，
 * 这里只负责：动态加载那份脚本 + 把挂载点交给它 + 把 inputActions 递进去。
 */
window.__ModuleLoader__.load({
  id: 'dsh-go-mode',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var react = require('react')

    var SCRIPT_URL = '/dsh-go/app.js'
    var state = { status: 'idle', callbacks: [] }

    function ensureScript(cb) {
      if (window.__DSH_GO_APP__) return cb(true)
      state.callbacks.push(cb)
      if (state.status === 'loading') return
      if (state.status === 'failed') {
        // 允许重试（例如宿主刚起来）
        state.status = 'idle'
      }
      state.status = 'loading'
      var s = document.createElement('script')
      s.src = SCRIPT_URL
      s.async = true
      s.onload = function () {
        state.status = 'ready'
        flush(true)
      }
      s.onerror = function () {
        state.status = 'failed'
        flush(false)
      }
      document.head.appendChild(s)
    }

    function flush(okFlag) {
      var cbs = state.callbacks.slice()
      state.callbacks.length = 0
      for (var i = 0; i < cbs.length; i++) {
        try {
          cbs[i](okFlag && !!window.__DSH_GO_APP__)
        } catch (e) {
          /* ignore */
        }
      }
    }

    function GoView(props) {
      var ref = react.useRef(null)
      var propsRef = react.useRef(props)
      propsRef.current = props

      react.useEffect(function () {
        var node = ref.current
        if (!node) return undefined
        var alive = true
        bridge.mounted++ // 主人在棋盘上了：focus 事件不再抢焦点
        ensureScript(function (okFlag) {
          if (!alive || !okFlag || !node.isConnected) return
          try {
            window.__DSH_GO_APP__.mount(node, {
              inputActions: (propsRef.current && propsRef.current.inputActions) || null,
            })
          } catch (e) {
            node.textContent = '围棋界面启动失败：' + (e && e.message)
          }
        })
        return function () {
          alive = false
          bridge.mounted = Math.max(0, bridge.mounted - 1)
          try {
            if (window.__DSH_GO_APP__ && node) window.__DSH_GO_APP__.unmount(node)
          } catch (e) {
            /* ignore */
          }
        }
      }, [])

      return react.createElement('div', {
        ref: ref,
        style: {
          flex: '1 1 auto',
          minHeight: 0,
          minWidth: 0,
          display: 'flex',
          overflow: 'hidden',
        },
      })
    }

    /* ------------------------------------------------------------------ *
     * 「说开始就跳到棋盘」桥
     *
     * conversation.view 是 conversation.session 的 child 插槽，只有被选中时
     * 才渲染；apply(ctx) 层拿不到 openView 这类 owner prop，所以没法从外面
     * 命令它切换。这里退一步：插件一激活就挂一条长轮询，宿主一旦 emit
     * 'focus'（新局开始），就去 DOM 里把标签文字是「围棋」的那个按钮点一下。
     * 主人已经在棋盘上时（bridge.mounted > 0）只推进游标、不抢焦点。
     * 找不到按钮就算了——绝不报错、绝不影响别的功能。
     * ------------------------------------------------------------------ */

    var bridge = { on: false, since: 0, stop: false, mounted: 0 }

    function goTabButton() {
      var nodes = document.querySelectorAll('button,[role="tab"],[role="button"],a')
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i]
        if (n.textContent && n.textContent.trim() === '围棋') return n
      }
      return null
    }

    function stopBridge() {
      bridge.on = false
      bridge.stop = true
    }

    function startBridge() {
      if (bridge.on) return
      bridge.on = true
      bridge.stop = false
      // 先把游标推到「现在」，否则会把历史上的 focus 事件重放一遍，
      // 导致页面一加载就被弹到棋盘上。
      fetch('/dsh-go/api/state', { credentials: 'same-origin' })
        .then(function (r) {
          return r.json()
        })
        .then(function (j) {
          if (j && j.state && typeof j.state.seq === 'number') bridge.since = j.state.seq
        })
        .catch(function () {})
        .then(function () {
          tick()
        })
    }

    function tick() {
      if (bridge.stop || !bridge.on) return
      fetch('/dsh-go/api/wait?since=' + bridge.since + '&timeout=20000', { credentials: 'same-origin' })
        .then(function (r) {
          return r.json()
        })
        .then(function (j) {
          if (bridge.stop || !bridge.on) return
          if (j && typeof j.seq === 'number') bridge.since = j.seq
          var evs = (j && j.events) || []
          for (var i = 0; i < evs.length; i++) {
            if (evs[i].type !== 'focus') continue
            if (bridge.mounted > 0) break // 主人已经在棋盘上了
            var btn = goTabButton()
            if (btn) {
              btn.click()
              break
            }
          }
          setTimeout(tick, 300)
        })
        .catch(function () {
          if (bridge.stop || !bridge.on) return
          setTimeout(tick, 4000)
        })
    }

    function apply(ctx) {
      ctx.slots.inject('conversation.view', () =>
        ctx.slots.register(
          {
            name: 'conversation.view',
            id: 'go',
            order: 30,
            label: () => '围棋',
          },
          GoView,
        ),
      )
      // 插件一激活就盯着 focus 事件，这样主人不用先点一次「围棋」标签。
      try {
        startBridge()
      } catch (e) {
        /* ignore */
      }
    }

    exports.name = 'dsh-go-mode'
    exports.inject = ['slots']
    exports.apply = apply
    exports.GoView = GoView
    exports.__bridge = { start: startBridge, stop: stopBridge, findTab: goTabButton }
    return module.exports
  },
})
