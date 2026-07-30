# Option + Command + Z 局部截图快捷键设计

## 目标

在 macOS 上新增全局快捷键 `Option + Command + Z`，用于打开或关闭现有的局部截图框选层。

框选完成后的处理继续沿用设置页当前选择的“截图解题模式”：

- 直答模式：把选区图像交给视觉模型直接回答。
- OCR 模式：提取选区文字并进入现有确认流程。

本次只增加局部截图的快捷键入口和对应界面提示，不修改截图、OCR、视觉回答或其他快捷键的行为。

## 当前状态

程序已经具备完整的局部截图流程：

- `WindowManager.toggleSelector()` 负责打开或关闭框选层。
- 框选层显示在鼠标所在的显示器上。
- 用户拖动选区后，现有 `screenshot:submit` 流程负责截图。
- 截图处理会读取当前保存的 `screenshotMode`，决定采用直答还是 OCR。

目前缺少的只是触发 `toggleSelector()` 的全局快捷键。

## 采用方案

新增一个独立、可测试的快捷键注册模块，结构与现有的 `Option + Command + X` 模式切换快捷键一致。

模块提供：

```ts
export const REGION_SCREENSHOT_SHORTCUT = 'CommandOrControl+Alt+Z'
export const REGION_SCREENSHOT_SHORTCUT_LABEL = 'Option+Command+Z'

export interface RegionScreenshotShortcutDeps {
  register: (accelerator: string, handler: () => void) => boolean
  toggleSelector: () => void
  onUnavailable: (reason: string) => void
}

export function registerRegionScreenshotShortcut(
  deps: RegionScreenshotShortcutDeps
): boolean
```

使用依赖注入可以直接验证注册的组合键和回调路由，无需在测试中启动 Electron。

没有采用以下方案：

- 直接把注册代码写进 `main/index.ts`：代码较少，但失败处理和行为不容易独立测试。
- 重构所有快捷键为通用注册系统：超出本次需求，并会扩大对现有快捷键的影响范围。

## 运行流程

macOS 应用启动完成后：

1. 主进程注册 Electron accelerator `CommandOrControl+Alt+Z`。
2. 用户按下 `Option + Command + Z`。
3. 快捷键回调调用现有 `windowManager.toggleSelector()`。
4. 如果当前没有框选层，程序在鼠标所在显示器打开局部截图框选层。
5. 如果框选层已经打开，再按一次快捷键会关闭它。
6. 用户拖动并提交选区后，现有流程读取当前 `screenshotMode`。
7. 程序按当前设置执行直答或 OCR，不强制覆盖模式。

快捷键只在 macOS 注册，与现有 Fn 组合键和 `Option + Command + X` 的平台范围保持一致。

## 快捷键冲突与错误处理

如果 `Option + Command + Z` 被其他程序占用或 Electron 注册时抛出异常：

- 不触发局部截图。
- 通过现有 `recordShortcutFailure()` 记录 `Option+Command+Z` 及失败原因。
- 失败信息继续由现有应用状态机制显示，不新增弹窗或额外窗口。

快捷键注册失败不会影响其他快捷键和截图入口。

## 界面提示

macOS 主窗口底部的快捷键说明增加：

```text
⌥⌘Z 局部截图
```

原有说明保持不变，包括：

- `fn⇧` 全屏截图。
- `⌥⌘X` 输入/穿透模式。
- 录音、回答滚动和浮层显示快捷键。

## 不修改的范围

- 不修改 `Fn + Shift` 全屏截图。
- 不修改 `Option + Command + X` 输入/穿透模式。
- 不修改其他 Fn 快捷键。
- 不修改框选层的外观、坐标计算、显示器选择和鼠标交互。
- 不修改直答、OCR、截图上传、视觉模型和回答流程。
- 不增加新的截图模式或设置项。
- 不推送 GitHub，不创建或更新 Pull Request，直到用户完成本地确认。

## 测试与验收

自动测试覆盖：

- 注册的 accelerator 必须为 `CommandOrControl+Alt+Z`。
- 注册成功后触发回调，必须调用现有 `toggleSelector()`。
- 注册被拒绝时，不得调用 `toggleSelector()`，并报告“可能被其他应用占用”。
- 注册抛出异常时，不得调用 `toggleSelector()`，并报告异常原因。
- macOS 主窗口显示 `⌥⌘Z 局部截图` 提示。

完整回归包括：

- 全部 Vitest 测试。
- ESLint。
- TypeScript 类型检查。
- Electron 生产构建。

本地人工验收：

1. 按 `Option + Command + Z`，出现局部截图框选层。
2. 再按一次，当前框选层关闭。
3. 重新打开并拖动选区，截图按设置页当前的直答或 OCR 模式处理。
4. `Fn + Shift` 全屏截图、`Option + Command + X` 和其他快捷键保持原有行为。
