// 焦点/隐身 spike —— 真机验证用，独立于主应用。
// 运行：  npx electron spike/focus-overlay.js
//
// 目的：验证「点/拖/打字浮层」时，前台浏览器（面试 Tab）会不会触发 blur / visibilitychange。
// 配套：在浏览器（用真实判题平台，或打开 spike/tab-watch.html）里看 console。
//
// 热键（全局，不夺焦）：
//   F1  切换 setFocusable(true/false)        —— 对比能不能打字 / 会不会夺焦
//   F2  切换 setContentProtection(on/off)    —— 对比隐身（共享屏幕时该面板该消失）
//   Cmd+Shift+Q  退出
const { app, BrowserWindow, globalShortcut, screen } = require('electron')

let win = null
let focusable = false        // 提议的默认：浮层不可聚焦
let contentProtect = true

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;font:13px -apple-system,BlinkMacSystemFont,sans-serif;color:#e2e8f0}
  .card{height:100vh;display:flex;flex-direction:column;overflow:hidden;
        background:rgba(12,12,20,.94);border:1px solid rgba(90,90,140,.6);border-radius:12px}
  .bar{-webkit-app-region:drag;padding:8px 12px;background:rgba(24,24,40,.96);font-weight:600;color:#cbd5e1}
  .body{padding:10px 12px;flex:1;overflow:auto}
  .hint{font-size:12px;color:#94a3b8;line-height:1.55}
  input,button{-webkit-app-region:no-drag}
  input{width:100%;margin-top:8px;padding:6px 8px;border-radius:6px;border:1px solid #2d3350;background:#0a0a14;color:#e2e8f0;box-sizing:border-box}
  button{margin-top:6px;padding:5px 12px;border-radius:6px;border:1px solid #33406a;background:#1b2440;color:#9bd1ff;cursor:pointer}
  #log{margin-top:10px;font-size:11px;color:#5b6b8a;white-space:pre-wrap;line-height:1.5}
  b{color:#f0b}
</style></head><body>
  <div class="card">
    <div class="bar">⠿ 拖我 · Focus Spike</div>
    <div class="body">
      <div class="hint">
        1) 浏览器打开真实判题页（或 <b>spike/tab-watch.html</b>），开它的 console。<br>
        2) 依次：① 点本面板 ② 拖标题栏 ③ 在下方输入框<b>打字</b>（最危险）④ 点按钮。<br>
        3) 每一步都回去看面试 Tab 的 console 有没有 <b>blur / hidden</b>。
      </div>
      <input id="t" placeholder="点这里打字 —— 这一步最能暴露夺焦" />
      <button id="b">点我（测试点击）</button>
      <div id="log"></div>
    </div>
  </div>
  <script>
    var d = document.getElementById('log');
    function log(m){ d.textContent = (new Date().toLocaleTimeString()+'  '+m+'\\n'+d.textContent).slice(0,1200); }
    addEventListener('focus', function(){ log('⚠ 本浮层 window FOCUS（它夺焦了！）'); });
    addEventListener('blur',  function(){ log('· 本浮层 window blur'); });
    document.addEventListener('visibilitychange', function(){ log('· 本浮层 visibility=' + document.visibilityState); });
    document.getElementById('b').onclick = function(){ log('button clicked'); };
    document.getElementById('t').addEventListener('input', function(e){ log('typed: ' + JSON.stringify(e.target.value)); });
    log('ready —— 若本面板出现「window FOCUS」即说明它把焦点抢走了');
  </script>
</body></html>`

function build() {
  win = new BrowserWindow({
    width: 360, height: 340, x: 60, y: 90,
    frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, hasShadow: false, resizable: true,
    type: 'panel',
    focusable,                                   // ← 关键变量（F1 热切换）
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setContentProtection(contentProtect)       // ← 隐身（F2 热切换）
  win.setIgnoreMouseEvents(true, { forward: true })
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML))
  win.showInactive()                             // ← 显示但不夺焦（对比 .show()）
}

// 鼠标穿透轮询：光标在窗口内才接收点击（与主应用一致）
function startCursorPoll() {
  let ignoring = true
  setInterval(() => {
    if (!win || win.isDestroyed()) return
    const { x, y } = screen.getCursorScreenPoint()
    const b = win.getBounds()
    const over = x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height
    if (over === ignoring) {
      ignoring = !over
      win.setIgnoreMouseEvents(!over, { forward: true })
    }
  }, 50)
}

app.whenReady().then(() => {
  app.setActivationPolicy('accessory')           // 无 Dock / 无菜单栏（隐身 + 配合不夺焦）
  build()
  startCursorPoll()

  globalShortcut.register('F1', () => {
    focusable = !focusable
    win.setFocusable(focusable)
    console.log('[spike] setFocusable =', focusable, '（注意：macOS 上对已聚焦窗口不会移除焦点）')
  })
  globalShortcut.register('F2', () => {
    contentProtect = !contentProtect
    win.setContentProtection(contentProtect)
    console.log('[spike] setContentProtection =', contentProtect)
  })
  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit())

  console.log('\n[spike] 已启动  focusable=%s  contentProtection=%s', focusable, contentProtect)
  console.log('[spike] F1=切 focusable | F2=切 隐身 | Cmd+Shift+Q=退出')
  console.log('[spike] 现在去浏览器盯着 blur/visibilitychange，操作浮层。\n')
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => globalShortcut.unregisterAll())
