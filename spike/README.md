# 焦点 / 隐身 Spike

验证一个**没法从 Electron typedef 证明、只能真机测**的问题：
浮层用 `showInactive() + setFocusable(false) + setActivationPolicy('accessory')` 后，
**点 / 拖 / 在它里面打字，会不会让前台浏览器（面试 Tab）触发 `blur` / `visibilitychange`**
—— 这正是 HackerRank / Coderpad / 牛客 等平台用来判「切屏」的信号。

> 这组实验最初在 `electron@28.3.3` 上建立。项目当前基线为 Electron 43.2.0；升级后应使用当前依赖重新真机验证，历史版本只用于复现旧结论。

## 跑法

1. 启动浮层（项目根目录）：
   ```bash
   npx --no-install electron spike/focus-overlay.js
   ```
   如需复现 Electron 28.3.3 的历史结果，可运行 `npx --yes electron@28.3.3 spike/focus-overlay.js`，不要据此替代当前版本验收。
2. 用 **Chrome**（跟真实面试同环境）打开 `spike/tab-watch.html`，按 `⌘⌥J` 开 console。
   - 更真实：直接开一个真实判题页，把 `tab-watch.html` 里 `<script>` 的监听片段贴进它的 console。
3. 让 Chrome 处于前台，然后操作浮层，逐项观察 tab-watch 有没有 `❌`：
   - ① 点面板　② 拖标题栏　③ **在输入框打字（最危险）**　④ 点按钮

## 热键（全局）

| 键 | 作用 |
|---|---|
| `F1` | 切换 `setFocusable(true/false)` —— 对比能否打字 / 是否夺焦 |
| `F2` | 切换 `setContentProtection` —— 共享屏幕时该面板应消失 |
| `⌘⇧Q` | 退出 |

## 怎么判读

- **点 / 拖浮层时 tab-watch 没有 `❌`** → 读答案这个高频场景不夺焦，地基成立。
- **打字时必然出现 `❌ BLUR`** → 符合预期（打字必须夺焦）。结论是把「手敲输入」移出浮层，
  改走全局快捷键（语音 / 截图）+ 主窗口，浮层只读。
- **连点 / 拖都出 `❌`** → `setFocusable(false)` 在你机器上没挡住夺焦，
  焦点方案要换思路（浮层彻底只读、纯快捷键驱动）。

## 隐身顺带测一下

共享屏幕（或 `⌘⇧5` 录屏 / QuickTime）时，浮层应当**完全不出现在画面里**。
按 `F2` 关掉 content protection 应能看到它重新出现在录制里，以此确认开关生效。
再用你真实会用的会议软件（腾讯会议 / Zoom）抽测一次。

测完把这个目录删掉即可，不影响主应用。
