# Helper

一个 **macOS** 桌面助手：浮层答案对**屏幕共享不可见**（content protection），交互尽量不抢前台焦点，面试/答疑时在右上角悄悄给提示。

> 仅面向 macOS（Apple Silicon + Intel，Sonoma/Sequoia）。Electron 28 + React 18 + TypeScript。

---

## 功能

- **AI 问答**：DeepSeek / OpenAI 兼容服务，流式输出到隐身浮层。
- **系统音频转写**：捕获对方声音 → Whisper 转写 → 一键发给 AI（见下方 BlackHole 设置）。
- **截图解题**：框选屏幕区域 → 视觉模型 OCR/解题。
- **对话记忆**：主进程统一保存最近 5 轮，所有入口共享上下文。
- **隐身浮层**：`setContentProtection` 让浮层在共享屏幕 / 录屏里完全消失。

---

## 快捷键

代码里是 `CommandOrControl+Alt+…`，在 macOS 上即 **⌘⌥**：

| 快捷键 | 作用 |
|---|---|
| ⌘⌥H | 显示 / 隐藏浮层 |
| ⌘⌥M | 显示 / 隐藏主窗口 |
| ⌘⌥K | 录音开关（语音转写） |
| ⌘⌥S | 截图解题（框选区域） |
| ⌘⌥O | 截取浮层自身内容做 OCR |
| ⌘⌥X | 清空答案 + 记忆 |
| ⌘⌥Q | 退出应用（关主窗口仅隐藏，不退出） |

某个快捷键被别的 app 占用而注册失败时，主窗口顶部会出现黄色提示。

---

## 开发与构建

```bash
npm install
npm run dev          # 开发模式
npm run typecheck    # 主进程 + 渲染层类型检查（构建用 esbuild 不校验类型，提交前跑这个）
npm run build        # 产物到 out/
npm run package:mac  # 打 macOS dmg（electron-builder，图标取 resources/icon.icns）
```

## 首次配置

1. 启动后进入**设置**页，填两组 Key（密钥用系统钥匙串加密存储）：
   - **AI 问答（LLM）**：API Key / Base URL / 问答模型 / 视觉模型。内置 DeepSeek、Qwen、GPT-4o、硅基流动等快捷预设。
   - **语音识别（ASR）**：Whisper 兼容服务，推荐 Groq（免费额度大）。
2. 没填 Key 时会自动跳到设置页提示。

## macOS 权限

| 权限 | 用途 | 在哪开 |
|---|---|---|
| **麦克风** | 语音转写（⌘⌥K） | 系统设置 → 隐私与安全性 → 麦克风 |
| **屏幕录制** | 截图解题（⌘⌥S，走 desktopCapturer） | 系统设置 → 隐私与安全性 → 屏幕录制 |

---

## 监听"对方的声音"（BlackHole 系统音频）

macOS 没有系统音频 loopback（那是 Windows 专属），所以用虚拟声卡把系统输出引到一个可被采集的输入设备：

1. 安装 BlackHole：`brew install blackhole-2ch`
2. 打开「**音频 MIDI 设置**」→ 左下 `+` → **创建多输出设备**，勾选**你的扬声器/耳机 + BlackHole**，设为系统声音输出（这样你自己照常能听到）。
3. 应用语音页点「**授权/刷新**」授麦克风权限 → 设备下拉选 **BlackHole** → ⌘⌥K 开始。

### 戴蓝牙耳机

- 把蓝牙耳机一起加进上面的**多输出设备**（照常从耳机听）。
- 在「音频 MIDI 设置」里设**非蓝牙设备为主**、给蓝牙那项勾上「**漂移校正**」，否则会有时钟漂移/爆音。
- 采集源仍选 **BlackHole**。**绝不要选蓝牙耳机的麦克风**——那会把耳机切到 HFP 免提模式，音质骤降且对方可能察觉（应用检测到这种设备会弹黄色警告）。
- 耳机中途断连：应用会自动回退到默认输入并提示。

---

## 焦点（防切屏检测）

浏览器类判题平台（HackerRank/Coderpad/牛客）监听 `blur` / `visibilitychange` 来判切屏。让浮层成为**非激活窗口**（`showInactive` + `setFocusable(false)` + `setActivationPolicy('accessory')`）能在"读答案"时不抢焦点，但 `setFocusable` 在 macOS 有官方 caveat，必须真机验证。

跑验证：

```bash
npx electron spike/focus-overlay.js
# 浏览器打开 spike/tab-watch.html，操作浮层时看它有没有报 blur/hidden
```

详见 [`spike/README.md`](spike/README.md)。验证通过后再把该方案接进主应用。

---

## 截图解题（⌘⌥S）

⌘⌥S 唤出选区遮罩 → 拖拽框选题目区域，或按 **Enter 直接截全屏** → 截图交给视觉模型识别/解题。

**已知限制：**
- **需要屏幕录制权限**：未授权会截到黑屏。dev 下授权对象是启动 `npm run dev` 的程序（终端 / VS Code），打包后是 Helper.app；改完权限要**完全重启该程序**才生效。
- **台前调度（Stage Manager）会让截区偏移**：开启后桌面被重排（左侧一条窗口缩略图、活动窗口右移），截到的画面会缺右边 / 底部。**建议截图时关闭台前调度**。实际面试场景判题页大多是全屏，普通模式下不受影响。

---

## 隐身说明与限制

- 浮层 + 主窗口都 `setContentProtection(true)`（macOS = `NSWindowSharingNone`），对 Zoom/腾讯会议/QuickTime 等标准捕获隐身。**机制可靠，但请用你真实会用的会议软件抽测一次。** 物理拍屏无解。
- app 身份已脱敏为中性的「Helper」（进程名/窗口标题/托盘）。注意 Electron 子进程会显示成「Helper Helper (GPU)」之类，无害但叠词。
- **API Key** 经 `safeStorage` 钥匙串加密存盘；**切勿把含密钥的文件提交到仓库**。
- 已知限制：仅 macOS；当前只处理主显示器；"原生系统音频（免 BlackHole）"需升级到更新的 Electron 后实测。
