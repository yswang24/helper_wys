> **施工级一次性执行方案 · v2**（取代早前的高层思路稿）。核对基线 commit：`55adb53`。生成于 2026-07-04。
>
> **怎么产出的**：并行抽取全项目精确清单（IPC 30 通道×方向、4 份 config 逐字段、三个上帝文件的函数/状态/effect 归属、流控/密钥不变量）→ 组装分步方案 → 对抗式复查依赖倒挂与行为保持。复查发现的 6 项修补已**折入**下方对应 Step。
>
> **核心保证（对应你的要求「一次性执行、完全不影响原功能」）**：
> - **无前向依赖**：每个 Step 的「依赖」只引用更早的 Step；特征测试永远早于被测代码的移动。
> - **每步行为保持**，三选一：(a) 纯移动/改名（特征测试+typecheck 证明前后一致）、(b) 纯新增（新文件未接线，旧路径照跑）、(c) 受闸门保护的切换（绿测+手工 QA 双关）。
> - **四道闸门**：`npm run typecheck`、`npm test`、`npm run build`、以及触碰 overlay/窗口/截图/流式时的**手工 QA 清单**。任一不绿不进下一步。
> - **主线 = Phase 0→3**：做完即完整重构且功能可用。**Phase 4 整相可选**，其中唯一「非行为保持」的一步（去 4s 轮询）单列 **Step 4.6**、以强手工 QA 把关、**不过即回滚**，不影响 4.1–4.5。
>
> **复查结论**：除明确可选的 Step 4.6 外，本方案可支撑「一次直通、零功能影响」。最需要盯的三处（均已加测试守护）：Step 2.9 bootstrap 三元序、Step 2.4 新流不 await 挂死流、Step 3.4 同步钉底。

---

# 重构施工方案

## 执行公约

以下公约适用于**每一个** Step，不再逐条重复：

1. **一次一提交**：每个 Step 对应一个聚焦的 git commit。commit message 形如 `refactor(phaseN): <step 标题>`。单个 Step 触碰的文件尽量少；纯移动/纯新增/单一 swap 三选一，绝不混合。
2. **闸门纪律（Gate discipline）**：进入下一个 Step 之前，当前 Step 的「闸门」必须全绿。基础闸门恒为 `npm run typecheck` 通过（Phase 0.2 起 `npm test` 也并入基础闸门）。凡触碰 overlay/window/截图/流式的 Step，额外附带对应的「手工 QA 清单」条目，必须人工勾选通过。
3. **特征测试先行（characterization-first）**：任何有风险的既有逻辑（截图坐标换算、store 密钥保全、markdown 渲染、流式 generation guard、ASR 状态机、config 双写路径）在**被移动之前**，先写覆盖其当前行为的特征测试，且该测试跑在**旧代码**上变绿。移动后测试不改断言仍绿 = 行为保持的证明。
4. **行为保持的三种形态**，每个 Step 必属其一：
   - **(a) 纯移动/改名**：由特征测试 + typecheck 证明前后一致；断言在移动前后完全不变。
   - **(b) 纯新增**：新建文件但**尚未接线**（no call site 改动）。旧路径仍在跑，风险为零。
   - **(c) 受闸门保护的切换（swap）**：删除旧路径、接入新路径，由已存在的绿色测试 + 手工 QA 双重把关。
5. **无前向依赖**：每个 Step 的「依赖」只能引用**更早**的 Step id。特征测试永远早于被测代码的移动；`register(deps)` 永远在建窗之前；`OverlayController` 是 main 侧**最后**一个抽取；`waitForStreamEnd` 轮询及其调用点在同一 Step 内一起消解，不留跨相的悬空接缝。
6. **右尺寸原则（4000 LOC 单人 app）**：不引入框架；conversation 用函数不用 class；provider-client 只为可测性而非"多 provider 抽象"；primitives/theme 属可选打磨，本方案标注为 optional。
7. **回滚**：每个 Step 由于是独立 commit，回滚即 `git revert <sha>`（swap 类）或 `git rm` 新增文件（additive 类）。每个 Step 单列具体回滚动作。
8. **导入路径与打包不变式**：electron-vite 把 main 打成单文件，`__dirname` 在运行时不变；但每次移动 main 侧文件后，必跑 `npm run build` 确认 `out/main/index.js` 仍生成且 `../renderer/*` `../preload/index.js` 路径未断（typecheck 抓不到运行时路径断裂）。

---

## Phase 0 — 安全网与清理

**目标**：在不动任何生产逻辑的前提下，删除死代码、搭好 Vitest+ESLint+Prettier、把 typecheck 并入 build，并对三块最高危既有代码（`hallucination.ts`、`store.ts` 密钥保全、`describeApiError`/`getOpenAIClient`）落地特征测试。这些测试是后续所有相变的"地基探针"。

**顺序理由**：工具链必须最先就位，否则后续 Step 无处写测试；死代码删除放在工具链之前（零依赖、零风险）以缩小后续扫描面。密钥/错误映射等"能在旧代码上直接测"的特征测试尽量前置，作为跨相安全网。

**相位退出标准**：`npm test` / `npm run lint` / `npm run typecheck` / `npm run build` 四条命令全绿；`input-window/` 已删除；`store.ts` / `hallucination.ts` / `apiError.ts` / `openaiClient.ts` 有绿色特征测试覆盖其关键分支。

### Step 0.1 — 删除死代码 input-window/
- **依赖**: 无
- **改动文件**: `src/renderer/input-window/`（删除整个目录）
- **操作**:
  1. 已确认 `grep -rn "input-window" src/ electron.vite.config.ts` 无任何引用（目录仅含空的 `__tests__`）。
  2. `git rm -r src/renderer/input-window`。
- **测试**: 无需新测试（删除的是零引用空目录）。
- **闸门**: `npm run typecheck` 通过；`npm run build` 通过且 `out/main/index.js` 仍生成。
- **完成标志**: `src/renderer/input-window/` 不存在；构建产物无变化。
- **行为保持**: 该目录无任何 import/构建入口引用（已 grep 证实），删除对运行时零影响。
- **回滚**: `git revert` 该 commit。

### Step 0.2 — 引入 Vitest（不写业务测试，只验证 runner）
- **依赖**: 无
- **改动文件**: `package.json`、新增 `vitest.config.ts`、新增 `test/setup.ts`、新增 `src/shared/__smoke__/runner.test.ts`
- **操作**:
  1. `npm i -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom`。
  2. 新建 `vitest.config.ts`：`test.globals=true`，`test.environment='node'`，`setupFiles=['./test/setup.ts']`，`include=['src/**/*.test.ts','src/**/*.test.tsx']`，`coverage.provider='v8'`，`coverage.include=['src/main/**','src/shared/**']`；`plugins:[react()]`。
  3. 新建 `test/setup.ts`：暂时仅 `import '@testing-library/jest-dom/vitest'`（`mockElectronAPI`/`mockMediaRecorder` 待 Phase 3 用到时再加）。
  4. **关键**：给 `tsconfig.node.json` 与 `tsconfig.web.json` 加 `"exclude": ["src/**/*.test.ts", "src/**/*.test.tsx", "test/**"]`。注意 `exclude` 只挡 emit、**不挡 `--noEmit` 的类型检查**——测试文件里的类型错误仍会让 `typecheck`/`build` 变红。若不希望测试代码波动影响 `build` 门，改为**把测试文件从 `include` 中排除**（或另建 `tsconfig.test.json` 单独承载测试的类型检查），使 `.test.ts` 既不进 emit 也不进生产 typecheck。
  5. 新建 `src/shared/__smoke__/runner.test.ts`：`expect(1+1).toBe(2)`，确认 runner 工作。
  6. `package.json` scripts 增加：`"test":"vitest run"`、`"test:watch":"vitest"`、`"test:cov":"vitest run --coverage"`。
- **测试**: `runner.test.ts` · unit-pure · 断言 `1+1===2`（仅验证 runner 与 jsdom/node 环境切换可用）。
- **闸门**: `npm test` 退出 0；`npm run typecheck` 仍退出 0（test 文件被 exclude，未进 emit）；`npm run build` 仍产出 `out/main/index.js`。
- **完成标志**: `npm test` 打印 1 passed；`npm run build` 后 `find out -name '*.test.js'` 结果为**空**（实证，不只靠 exclude 配置）。
- **行为保持**: 纯新增 devDependency + 配置 + 独立 smoke 测试，不触碰任何 `src` 生产文件（tsconfig 只加 `exclude`，不改 `include` 的生产范围）。
- **回滚**: `git revert`；`npm uninstall` 新增依赖。

### Step 0.3 — 引入 ESLint + Prettier（先只做 check，不做 fix 改写）
- **依赖**: 0.2
- **改动文件**: `package.json`、新增 `eslint.config.js`、新增 `.prettierrc.json`、新增 `.prettierignore`
- **操作**:
  1. `npm i -D eslint typescript-eslint @eslint/js eslint-plugin-react-hooks eslint-config-prettier prettier`。
  2. 新建 `eslint.config.js`（flat config）：`ignores:['out/**','dist/**','node_modules/**','*.config.*']`，`js.configs.recommended`，`...tseslint.configs.recommended`，react-hooks recommended，`prettier`（**必须最后**，关闭风格类规则）。
  3. 新建 `.prettierrc.json`：`{"semi":false,"singleQuote":true,"printWidth":100,"trailingComma":"none","arrowParens":"always"}`（匹配现有代码风格：无分号、单引号、无尾逗号）。
  4. 新建 `.prettierignore`：`out/`、`dist/`、`node_modules/`、`*.md`。
  5. scripts 增加：`"lint":"eslint . && prettier --check ."`、`"lint:fix":"eslint . --fix && prettier --write ."`。
  6. 跑 `npm run lint`，若报错：**只允许**通过在 `eslint.config.js` 里降级/关闭规则消解，**不允许**本 Step 改任何 `src` 源码（避免掺入行为改动）。把"需要 --fix 的格式统一"留给一个独立后续可选提交。
- **测试**: 无（lint/format 属工具闸门，非运行时行为）。
- **闸门**: `npm run lint` 退出 0（必要时通过放宽规则达成，记录哪些规则被放宽）；`npm test`、`npm run typecheck` 仍绿。
- **完成标志**: `npm run lint` 退出 0。
- **行为保持**: 仅新增 lint/format 配置与依赖；本 Step 明令不改 `src` 源码，故运行时零影响。
- **回滚**: `git revert`；`npm uninstall`。

### Step 0.4 — 把 typecheck 并入 build
- **依赖**: 0.2
- **改动文件**: `package.json`
- **操作**:
  1. 把 `"build"` 改为 `"npm run typecheck && electron-vite build"`。
  2. （可选）增加 `"prebuild":"npm run typecheck"` 作为双保险。
- **测试**: 无（这是闸门接线）。
- **闸门**: `npm run build` 先跑 typecheck 再构建，产出 `out/main/index.js`；故意在某文件引入类型错误验证 build 会 fail（验证后还原）。
- **完成标志**: `npm run build` 日志中先出现 tsc 阶段再出现 electron-vite 阶段。
- **行为保持**: typecheck 是"门"不是"变换"，不改变 emit 产物；仅在类型错误时阻断构建。
- **回滚**: `git revert`（把 `build` 改回 `electron-vite build`）。

### Step 0.5 — hallucination.ts 特征测试
- **依赖**: 0.2
- **改动文件**: 新增 `src/shared/hallucination.test.ts`
- **操作**:
  1. 阅读 `src/shared/hallucination.ts`（已知导出 `HALLUCINATION_RE`、`isHallucinatedText`）。
  2. 针对**当前实现的实际行为**写断言（先在旧代码上跑绿，不改源码）。
- **测试**: `isHallucinatedText 匹配/放行` · unit-pure ·
  - 对若干典型幻觉字符串（取自 `HALLUCINATION_RE` 覆盖的模式）断言 `true`；
  - 对正常中/英文句子断言 `false`；
  - 空串、单字符断言（按现有实现的实际返回值锁定，不臆造）。
- **闸门**: `npm test` 全绿。
- **完成标志**: 该测试文件存在且通过；后续 Phase 4 ASR 抽取时它是回归网。
- **行为保持**: 纯新增测试，不动源码。
- **回滚**: `git rm` 该测试文件。

### Step 0.6 — store.ts 密钥保全特征测试（最高危：先测后不动）
- **依赖**: 0.2
- **改动文件**: 新增 `src/main/store.test.ts`
- **操作**:
  1. 阅读 `store.ts:5-148`，锁定 `loadPersistedConfig`/`persistConfig`/`SECRET_FIELDS`/`ENC_PREFIX`/`DECRYPT_FAILED` 语义。
  2. 用 `vi.mock('electron', ...)` 提供假 `safeStorage`（`isEncryptionAvailable`、`encryptString`、`decryptString` 可控），并把配置文件指向临时目录（mock `app.getPath('userData')` 到 tmpdir）。
- **测试**（全部 characterization，跑在旧 `store.ts` 上）:
  - `persistConfig 保留缺席密钥的密文` · 先写 `apiKey:'sk-x'` 得到磁盘密文 C；再以**不含 apiKey** 的对象调用 `persistConfig` → 断言磁盘 `apiKey===C`（仍 `enc:v1:` 前缀）。
  - `persistConfig 空串清空密钥` · 传 `apiKey:''` → 磁盘 `apiKey===''`。
  - `persistConfig 非空密钥被加密` · `isEncryptionAvailable()=true` + `apiKey:'sk-x'` → 磁盘值以 `enc:v1:` 开头且不等于明文 `sk-x`。
  - `keychain 不可用时明文兜底` · `isEncryptionAvailable()=false` → 磁盘 `apiKey==='sk-x'`（不丢失）。
  - `loadPersistedConfig 在 DECRYPT_FAILED 时丢字段` · 磁盘置 `enc:v1:...`，令 `decryptString` 抛错 → 返回对象**无** `apiKey` 键（不是 `''`）。
  - `loadPersistedConfig 正常密钥回环` · encrypt→persist→load → 解密后 `apiKey==='sk-x'`。
  - `损坏配置隔离 + .bak 兜底` · 写不可解析 `config.json` + 合法 `.bak` → 断言生成 `.corrupt-*` 且值来自 `.bak`。
- **闸门**: `npm test` 全绿。
- **完成标志**: 上述 7 条断言通过。
- **行为保持**: 纯新增测试；这是保护关键不变式（密钥永不被未披露的 partial 抹空）的跨相安全网，Phase 1 config 统一时它守住 `store.ts` 密钥逻辑"字节级不变"。
- **回滚**: `git rm` 该测试文件。

### Step 0.7 — apiError.ts + openaiClient.ts 特征测试
- **依赖**: 0.2
- **改动文件**: 新增 `src/main/apiError.test.ts`、新增 `src/main/openaiClient.test.ts`
- **操作**:
  1. `apiError.test.ts` 直接 import `describeApiError`（已导出，纯函数）。
  2. `openaiClient.test.ts` 用 `vi.mock('openai', ...)` 提供假构造器（避免真实 client），断言缓存 identity。
- **测试**:
  - `describeApiError 状态码映射` · unit-pure · 表驱动：`{status:401}`→含"鉴权失败（401）"；404→"找不到（404）"；`{status:400,error:{message:'bad'}}`→"请求被拒（400）：bad"；429→含"限流"；`{status:503,message:'x'}`→"HTTP 503：x"；`{name:'Error',message:'aborted 30000'}`→含"超时"；纯字符串 `'boom'`→`'boom'`。
  - `getOpenAIClient 缓存 identity` · unit-pure · 同 `{apiKey,baseURL,maxRetries}` 两次返回 `===` 同一实例；`maxRetries` 不同→不同实例；未传 `maxRetries` 默认 2（通过传入不同显式值对比验证默认）。
- **闸门**: `npm test` 全绿。
- **完成标志**: 两文件通过。
- **行为保持**: 纯新增测试，不动源码；为 Phase 4 provider-client 抽取预置回归网（确定 `vi.mock('./openaiClient')` 为长期 mock 缝）。
- **回滚**: `git rm` 两测试文件。

---

## Phase 1 — 类型化 IPC 契约 + 统一 Config

**目标**：在 `src/shared/` 建立单一事实源：`ipc.ts`（按方向分表的 Channels）与 `config.ts`（单一 `AppConfig` + `DEFAULTS` + 派生 `PersistedConfig`/`PublicConfig` + `toPersisted`/`fromPersisted`）。全程**先新增、后逐窗接线**，preload 作为唯一收敛点最后替换字符串字面量。

**顺序理由**：`ipc.ts`/`config.ts` 是纯新增类型（Step 1.1–1.3），零运行时风险；随后把 `env.d.ts`/preload/各窗口逐个指向新契约，每次只换类型引用不换逻辑。config 统一时 `store.ts` 密钥逻辑**保持字节不变**（由 0.6 守护），只把内存侧类型对齐。

**相位退出标准**：`src/shared/ipc.ts`、`src/shared/config.ts` 存在并被 preload、`env.d.ts`、main、三窗口引用；`config:get-public` 无密钥、`config:set` 双写路径、ASR 前缀改名等不变式由新增的 mocked-port 测试锁定；四条基础命令全绿。

### Step 1.1 — 新增 shared/ipc.ts（纯类型，尚未接线）
- **依赖**: 0.2, 0.4
- **改动文件**: 新增 `src/shared/ipc.ts`
- **操作**:
  1. 依 ipc-channels 清单，定义**按方向分表**的三张 map（关键：名字跨方向复用，扁平 map 会静默错型）：
     - `InvokeChannels`（7 条）：`app:get-status`、`config:get`、`config:get-public`、`config:test-llm`、`config:test-vision`、`config:test-asr`、`asr:transcribe`；每条 `{ request; response }`。`asr:transcribe` 的 request 建模为元组 `[ArrayBuffer, string, string]`（保持 3 位置参数）。
     - `SendChannels`（16 条，renderer→main）：含 `overlay:set-ignore-mouse`/`overlay:request-mode`（dead-exposed，保留但注释标记待删）、drag 三件套、`config:set`、`llm:*`、`asr:*`、`clipboard:copy`、`screenshot:submit`；每条 `{ payload }`。
     - `EventChannels`（14 条，main→renderer）：`overlay:mode`/`overlay:opacity`、`llm:start/chunk/done/error/clear`、`asr:start/stop/ptt-toggle/transcript`、`image:text/status/error`。
  2. 复用类型引用 config.ts 中尚未建立的类型时，本 Step 先用**本地占位**（如 `TranscriptData`、`AppStatus`、`ScreenRegion`、事件 payload 三元组），Step 1.4 再改为从 `config.ts`/统一定义 import。
  3. **不导入 `env.d.ts` 作为事实源**（它已漂移）；以 main handler 为准。
- **测试**: 无运行时测试（纯类型文件）。可选：一个 `ipc.test.ts` 做"编译期断言"（`expectTypeOf`），非必需。
- **闸门**: `npm run typecheck` 通过（新文件独立，无接线）。
- **完成标志**: `src/shared/ipc.ts` 存在，`tsc` 通过。
- **行为保持**: 纯新增类型文件，无任何 call site 引用它，运行时零影响。
- **回滚**: `git rm src/shared/ipc.ts`。

### Step 1.2 — 新增 shared/config.ts（AppConfig + DEFAULTS，纯类型/纯函数，尚未接线）
- **依赖**: 0.6（store 密钥测试作为不变式护栏）
- **改动文件**: 新增 `src/shared/config.ts`
- **操作**:
  1. 定义 `AppConfig`（`provider`/`prompt`/`ui` 三域，见 config-schema 清单的 target 结构）。
  2. 定义 `DEFAULTS: AppConfig`，值**逐字段等于**三个 legacy 常量的并集：`DEFAULT_CONFIG`(llm) + `DEFAULT`(asr) + `overlayOpacity:0.94` + `screenshotMode:'direct'`。
  3. 定义派生扁平类型 `PersistedConfig`（= 现 store.ts 的 `PersistedConfig`，wire/disk 契约保持字节一致，磁盘键名**字节不变**——`asrApiKey/asrBaseUrl/asrModel` 已是扁平形，**不做任何改名或迁移**；`AppConfig` 里的嵌套 `provider.asrApiKey` 仅是内存侧表示，`toPersisted` 负责拍平回现有磁盘键），`PublicConfig`（`{overlayOpacity;screenshotMode}`），`SECRET_FIELDS=['apiKey','asrApiKey'] as const`（作用于扁平形）。
  4. 实现纯函数 `toPersisted(cfg:AppConfig):PersistedConfig`、`fromPersisted(raw:PersistedConfig):AppConfig`（`fromPersisted` 套 `DEFAULTS`；`answerLang` 越界值走"运行期加宽默认 zh"路径，不抛错不丢字段；`overlayX/overlayY` 不进 renderer 面）。
- **测试**（unit-pure，跑在新文件上）:
  - `DEFAULTS 等于 legacy 并集` · 断言 `toPersisted(DEFAULTS)` 逐字段等于 `{baseUrl:'https://api.deepseek.com', model:'deepseek-chat', visionModel:'deepseek-chat', answerLang:'zh', asrBaseUrl:'https://api.openai.com/v1', asrModel:'whisper-1', overlayOpacity:0.94, screenshotMode:'direct', apiKey:'', asrApiKey:'', jobDescription:'', resume:'', screenshotPrompt:''}`（把三个 legacy 常量的值硬编码进断言以锁定）。
  - `toPersisted/fromPersisted 回环` · 二者只覆盖 **renderer 可见子集**（**不含** `overlayX/overlayY`——坐标走独立的 `persistOverlayPos` 路径）；对一个不含坐标、其余全字段填充的 `AppConfig` 断言 `fromPersisted(toPersisted(cfg))` 深等 `cfg`，并断言 `toPersisted` 输出**不含** `overlayX/overlayY`、拍平后键名逐字等于现磁盘键（`asrApiKey` 等）。
  - `fromPersisted 越界 answerLang 加宽` · `{answerLang:'garbage'}` → `cfg.prompt.answerLang` 不抛错（按实现落到默认或保留原值，锁定实际行为）。
  - `PublicConfig 不含密钥` · 从含密钥的 `PersistedConfig` 派生 public 子集，断言 key 恰为 `{overlayOpacity,screenshotMode}`。
- **闸门**: `npm test`、`npm run typecheck` 全绿。
- **完成标志**: `config.ts` 存在且 4 条断言通过。
- **行为保持**: 纯新增类型 + 纯函数，无 call site 引用，运行时零影响。回环测试证明扁平化不丢信息。
- **回滚**: `git rm src/shared/config.ts`。

### Step 1.3 — config:set / config:get / config:get-public 特征测试（先测旧 handler，后不动）
- **依赖**: 0.2
- **改动文件**: 新增 `src/main/ipc-config.characterization.test.ts`（或就近命名）
- **操作**:
  1. 因当前 handler 内联在 `index.ts` 且依赖 `ipcMain`，先做**最小可测化**：把 `config:set` 的纯合并逻辑抽成 `index.ts` 内导出的纯函数 `mergeConfigForPersist(persisted, p)` 与 `splitConfigSet(p)`（不改行为，只把已有表达式提成函数），或直接以 `vi.mock('electron')` 驱动 handler。**优先选择提纯函数**（更稳）。这一提纯本身是纯移动（把内联表达式包成函数），由下述断言守护。
  2. mock `store`（spy `persistConfig`/`loadPersistedConfig`）、`llm`（spy `setConfig`/`getConfig`）、`asr`（spy `setASRConfig`/`getASRConfig`）、overlay 的 `webContents.send`。
- **测试**（characterization / mocked-port，跑在旧逻辑上）:
  - `config:get-public 无密钥` · 内存+磁盘均含 `apiKey/asrApiKey` → 返回 key 恰为 `{overlayOpacity,screenshotMode}`。
  - `config:get 默认值` · 空磁盘 → `overlayOpacity===0.94`、`screenshotMode==='direct'`；且 `apiKey` 来自**内存** `getConfig()` 而非磁盘解密。
  - `config:set 值比较跳过 no-op` · `loadPersistedConfig` 返回 `{jobDescription:'A'}`，传 `{jobDescription:'A'}` → `persistConfig` **未**被调用。
  - `config:set 保留密钥` · 磁盘 `{apiKey:'sk-x'}`，传 `{overlayOpacity:0.5}` → `merged` 仍含 `apiKey:'sk-x'`；`setConfig` 未收到 asr*/mode/opacity。
  - `config:set opacity 强转 + live push` · 传 `{overlayOpacity:'0.8'}` → `overlay:opacity` 以数字 `0.8` 发送，且持久化 `merged.overlayOpacity===0.8` 且 `typeof merged.overlayOpacity==='number'`。**注**：597 行那条无条件 `overlayOpacity` 重复写入**不可**折进 `merged[k]!==p[k]` 比较循环——否则字符串 `'0.8'` 会落盘（即风险 #6）。
  - `config:set screenshotMode 绕开 LLM` · 传 `{screenshotMode:'ocr', model:'m'}` → `setConfig` 收到 `{model:'m'}` 无 `screenshotMode`；`merged.screenshotMode==='ocr'`。
  - `config:set ASR per-field undefined 守护` · 内存 ASR `{apiKey:'k',baseUrl:'b',model:'m'}`，传 `{asrModel:'m2'}` → `setASRConfig` 收到 `{apiKey:'k',baseUrl:'b',model:'m2'}`。
- **闸门**: `npm test` 全绿。
- **完成标志**: 上述断言通过（在**旧** config 逻辑上）。
- **行为保持**: 提纯函数是纯移动（表达式→函数），断言前后不变即证；这些断言是 Phase 1/2 config 迁移的回归网。
- **回滚**: `git rm` 测试文件；`git revert` 提纯（若做了）。

### Step 1.4 — ipc.ts payload 类型指向 config.ts；统一 env.d.ts
- **依赖**: 1.1, 1.2
- **改动文件**: `src/shared/ipc.ts`、`src/renderer/env.d.ts`
- **操作**:
  1. 把 `ipc.ts` 中 Step 1.1 的本地占位类型改为从 `config.ts` import（`PersistedConfig`/`PublicConfig`/`AppStatus`/`TranscriptData`/`ScreenRegion` 等）。`AppStatus`、`TranscriptData`、`ScreenRegion` 若不属 config，则新建 `src/shared/types.ts` 承载并由二者共享。
  2. 删除 `env.d.ts` 中漂移的本地 `LLMConfig`/inline public 类型，改为 `import` 派生类型；`ElectronAPI` 接口的方法签名以 `ipc.ts` 的 Channels 为准（`setConfig` payload 对齐、`onAnswerError` 的 `id:number|null` 保留、`getPublicConfig` 的 `overlayOpacity?` 保留 optional）。
- **测试**: 无新增运行时测试；靠 typecheck 抓漂移消解后的类型错。
- **闸门**: `npm run typecheck` 通过（这是关键——统一后各窗口引用处若有不兼容会在此暴露）；`npm test` 仍绿；`npm run build` 产出不变。
- **完成标志**: `env.d.ts` 不再含本地 `LLMConfig` 定义；`tsc` 全绿。
- **行为保持**: 仅改类型声明与 import，`.d.ts` 无运行时代码；preload 运行时逻辑此 Step 不动。
- **回滚**: `git revert`。

### Step 1.5 — preload 字符串字面量替换为 ipc.ts 常量
- **依赖**: 1.4
- **改动文件**: `src/preload/index.ts`
- **操作**:
  1. 逐个把 `ipcRenderer.send/invoke/on` 的字符串字面量替换为 `ipc.ts` 导出的常量。**逐 channel 替换，逐次 typecheck**，保持 wrapper 函数体逻辑一字不改（仅字面量→常量）。
  2. 保留 `overlay:set-ignore-mouse`/`overlay:request-mode` 的 dead-exposed wrapper（本相不删，避免掺入行为改动）。
- **测试**: 可选新增 `preload.static.test.ts`（characterization，静态 grep 断言）：preload 中每个 channel 常量都能在 `ipc.ts` 中找到；distinct 名字计数 = 30，(name,direction) 元组 = 37。
- **闸门**: `npm run typecheck` 通过；`npm test` 绿；**手工 QA**：启动 app，验证配置读写/流式/ASR/截图四路 IPC 仍通（见手工 QA 清单 §A 冒烟）。
- **完成标志**: preload 无裸字符串 channel；手工冒烟通过。
- **行为保持**: 字面量→同值常量是纯改名；常量值必须与原字符串逐字相等（typecheck + grep 测试保证），运行时字符串不变故 IPC 路由不变。
- **回滚**: `git revert`。

---

## Phase 2 — 绞杀 main/index.ts（叶子优先，register(deps) 在建窗前）

**目标**：把 810 行的 `index.ts` 按叶子优先拆成 `screenshot/`（capture 纯函数）、`config`/`store` applyPartial、各域 `ipc/*.ts` 的 `register(deps)`、`WindowManager`、最后 `OverlayController`。全程闭包 getter 而非值快照。

**顺序理由**：
- 截图坐标换算是"alignment-critical 且未测"——**必须先写坐标数学的特征测试并把 capture 薄抽取到 `screenshot/` 前置**（Step 2.1–2.2），否则测试无处附着。
- `startStreamSafely`/`waitForStreamEnd` 被 llm/asr/screenshot 三域共享，是跨域接缝——先把它们连同 4s 轮询**在同一 Step 内**抽成单一 shared 实例注入三域（Step 2.4），不留悬空。
- `register(deps)` 改变了 IPC 注册时机（从 module-eval 变为 whenReady 内）——**所有域必须在建窗前注册**，且 deps 全为 getter/闭包（建窗时窗口尚 null）。这是 Phase 2 的验收特征测试（Step 2.9）。
- `OverlayController` 是 main 侧**最后**抽取（Step 2.10），因其两模式契约最脆弱，且被 WindowManager.updateTrayMenu 反向依赖，需最后以注入回调解耦。

**相位退出标准**：`index.ts` 收缩为薄 bootstrap；capture 数学、drag 状态机、heartbeat、applyOverlayMode 调用顺序、config 双写均有绿色测试；"IPC 先于建窗注册"验收测试绿；手工 QA 全过（overlay 不切屏、内容保护、截图对齐、⌘⌥E 无闪）。

### Step 2.1 — 截图坐标数学特征测试（先测，后抽）
- **依赖**: 0.2
- **改动文件**: 新增 `src/main/screenshot.coords.test.ts`；`index.ts`（仅导出 `computeNativeRect`/`computeCropRect` 两个**纯函数**，从现有内联表达式提纯）
- **操作**:
  1. 从 `captureRegionNative`（index.ts:691-699）提纯 `computeNativeRect(display, region):{gx,gy,gw,gh}`；从 `captureRegionDesktop`（index.ts:748-755）提纯 `computeCropRect(tsize, region):{cx,cy,cw,ch}`。仅把内联算式包成函数，调用处替换为函数调用，**数学一字不改**。
  2. 导出这两个纯函数供测试。
- **测试**（mocked-port / unit-pure，跑在提纯后但数学未变的代码上）:
  - `computeNativeRect` · `display.bounds={x:100,y:0,width:2000,height:1000}`, `region={x:50,y:25,w:200,h:100,vw:1000,vh:500}` → `sx=2,sy=2`→`gx=200,gy=50,gw=400,gh=200`；`vw/vh` 缺省 → `sx=sy=1`，`gx=bounds.x+region.x`。
  - `computeCropRect` · `scaleX=tsize.w/vw`；夹取 `cw=min(round(w*scaleX), tsize.w-cx)`；`region.x*scaleX` 取整；`vw/vh` 缺省回落 `tsize` 维度。
- **闸门**: `npm test` 全绿；`npm run build` 产出不变。
- **完成标志**: 两纯函数被测试覆盖并通过。
- **行为保持**: 提纯是纯移动（算式→函数），断言锁定数值前后一致；调用处只是改为调函数。
- **回滚**: `git revert`。

### Step 2.2 — 抽取 screenshot/ capture 模块（含 selectorDisplayId owner）
- **依赖**: 2.1
- **改动文件**: 新增 `src/main/screenshot/capture.ts`、`src/main/screenshot/index.ts`；`index.ts`
- **操作**:
  1. 把 `computeNativeRect`/`computeCropRect`/`captureRegionNative`/`captureRegionDesktop`/`ScreenRegion` 移入 `screenshot/capture.ts`。
  2. `screenshot:submit` handler 逻辑移入 `screenshot/index.ts`，暴露 `registerScreenshotIpc(deps)`（deps: `getSelectorWindow`/`getOverlayWindow`/`getSelectorDisplayId`/`ensureOverlayVisible`/`startStreamSafely`/`extractImageText`/`streamImageAnswer`/`loadPersistedConfig`）——**本 Step 只建函数并从 `index.ts` 调用它**（等价接线，不改注册时机；register(deps) 的时机重排留到 2.9）。
  3. `selectorDisplayId` 归 WindowManager 的准备工作：本 Step 暂以 getter/setter 闭包暴露，`createSelectorWindow` 仍在 `index.ts`。
- **测试**: 复用 2.1 的坐标测试（import 路径改为 `screenshot/capture`）；新增 `screenshot capture finally unlink` · mocked-port · `execFile` cb 传 Error → promise reject 但 `unlink(tmpPng)` 仍被调用。
- **闸门**: `npm test` 全绿；`npm run typecheck`；`npm run build` 产出 `out/main/index.js` 且截图路径未断（**手工 QA**：单显示器截图对齐一次，见清单）。
- **完成标志**: capture 逻辑不再在 `index.ts` 顶层；坐标 + unlink 测试绿。
- **行为保持**: 纯移动 + 等价接线（调用点数量/顺序不变）；坐标测试与 unlink 测试守护；手工截图确认对齐。
- **回滚**: `git revert`（把 capture 逻辑挪回 `index.ts`）。

### Step 2.3 — config 双写逻辑落到 store.applyPartialConfig / config 域（先测已在 1.3）
- **依赖**: 1.3, 1.2
- **改动文件**: 新增 `src/main/config/index.ts`（或 `store.ts` 增 `applyPartialConfig`）；`index.ts`
- **操作**:
  1. 把 `config:*` handler 逻辑移入 `config/index.ts`，暴露 `registerConfigIpc(deps)`（deps: `getConfig/setConfig/getASRConfig/setASRConfig/loadPersistedConfig/persistConfig/sendOverlayOpacity`）。两条写路径（Path A 内存 + Path B 持久 RMW）与 `screenshotMode` 抽离、opacity 独立 `Number()` 分支**逐字保留**。
  2. `index.ts` 改为调用 `registerConfigIpc(...)`（等价接线，时机重排留 2.9）。
- **测试**: 复用 1.3 的全部 config 断言（import 指向新模块）；断言值一字不变即证行为保持。
- **闸门**: `npm test`（含 1.3 七条）全绿；`npm run typecheck`。
- **完成标志**: `config:*` 逻辑集中于 `config/`；1.3 测试仍绿。
- **行为保持**: 纯移动，双写路径/opacity 分支/ASR 改名逐字保留；1.3 特征测试守护。
- **回滚**: `git revert`。

### Step 2.4 — 抽取共享流控 startStreamSafely/waitForStreamEnd（消解跨域接缝，暂不改 4s 轮询）
- **依赖**: 0.7
- **改动文件**: 新增 `src/main/stream-safe.ts`；`index.ts`
- **操作**:
  1. 把 `waitForStreamEnd`（index.ts:601-613）与 `startStreamSafely`（619-632）**原样**移入 `stream-safe.ts`，导出 `createStreamSafe(deps)`（deps: `isCurrentlyStreaming/stopStreaming/forceResetStreaming/getOverlayWindow/ensureOverlayVisible`），返回 `{ startStreamSafely, waitForStreamEnd }` 单实例。
  2. `index.ts` 建单实例并传给 llm/asr/screenshot 三域调用点（此刻它们仍在 `index.ts`，只是改为调用该单实例函数）。**4s 轮询逻辑保持不变**（真正去轮询是 Phase 4 可选项，本相不动）。
- **测试**:
  - **测试 mock 的是注入 deps**（`isCurrentlyStreaming`/`stopStreaming`/`forceResetStreaming`/`getOverlayWindow`/`ensureOverlayVisible`），**不 mock 真实 `llm.ts`**——故此步不隐式依赖 Phase 4 的 hang 夹具。
  - `waitForStreamEnd 立即/超时` · mocked-port + fake timers · 未 streaming → 同步回调；永远 streaming → 80×50ms 后 `forceResetStreaming` + 回调。
  - `startStreamSafely 重守护已销毁 overlay` · overlay 在调用时已 destroyed → `run` 不执行；streaming 路径 → stop + defer。
  - `新流不 await 挂死的前一流` · 令首流 promise 永不 resolve，`stopStreaming()` 后 → `run` 在 ≤4s 内被调用且**不依赖**首流 promise settle（resolved-flag 验证）。**此不变式在此首次被守护，不推迟到可选的 4.6**。
- **闸门**: `npm test` 全绿；`npm run typecheck`。
- **完成标志**: 三域共用单一流控实例；无重复计时器；两测试绿。
- **行为保持**: 纯移动为单例；轮询/计时器逻辑逐字保留；测试锁定"立即/超时/重守护"三分支。
- **回滚**: `git revert`。

### Step 2.5 — 抽取 ipc/app.ts 与 ipc/clipboard.ts（最简叶子）
- **依赖**: 无（可在 1.5 后任意时刻，但依赖 register(deps) 约定，故排此）
- **改动文件**: 新增 `src/main/ipc/app.ts`、`src/main/ipc/clipboard.ts`；`index.ts`
- **操作**:
  1. `app:get-status` → `ipc/app.ts` `registerAppIpc(deps)`（deps: `getOverlayWindow`/`failedShortcuts`）。
  2. `clipboard:copy` → `ipc/clipboard.ts` `registerClipboardIpc()`（无 deps）。
  3. `index.ts` 改为调用二者（等价接线）。
- **测试**: `app:get-status shape` · mocked-port · 返回 `{contentProtection:true, overlayVisible:<from isVisible>, platform, version, failedShortcuts:[]}`。
- **闸门**: `npm test`、`npm run typecheck` 全绿。
- **完成标志**: 两最简域抽出；status 测试绿。
- **行为保持**: 纯移动；status 形状测试守护。
- **回滚**: `git revert`。

### Step 2.6 — 抽取 ipc/llm.ts 与 ipc/asr.ts
- **依赖**: 2.4
- **改动文件**: 新增 `src/main/ipc/llm.ts`、`src/main/ipc/asr.ts`；`index.ts`
- **操作**:
  1. `llm:ask/clear/stop/ask-extracted` → `ipc/llm.ts` `registerLlmIpc(deps)`（deps: `startStreamSafely`/`stopStreaming`/`clearHistory`/`getOverlayWindow`）。
  2. `asr:start/stop/transcript/auto-ask/transcribe` → `ipc/asr.ts` `registerAsrIpc(deps)`（deps: `getOverlayWindow`/`startStreamSafely`/`transcribeAudio`）。保留 `asr:transcribe` 的 3 位置参数与 `lang||''` 兜底、`asr:start/stop/transcript` 事件转发到 overlay。
  3. `index.ts` 改为调用二者。
- **测试**:
  - `asr:transcribe 位置参数 + lang||''` · mocked-port · handler 收 `(buf,'audio/webm',undefined)` → `transcribeAudio(Buffer, 'audio/webm', '')`。
  - `事件名复用不串线` · characterization · `asr:start` send handler 转发 overlay，且 main **未**对同名做 invoke/handle。
- **闸门**: `npm test`、`npm run typecheck` 全绿；**手工 QA**：ASR 录音→转写→送 AI 一轮通。
- **完成标志**: llm/asr 域抽出；两测试绿。
- **行为保持**: 纯移动；位置参数/兜底/事件转发逐字保留；测试守护。
- **回滚**: `git revert`。

### Step 2.7 — 抽取 ipc/overlay.ts（drag 状态机 + set-ignore-mouse + request-mode）
- **依赖**: 2.4（drag 依赖 overlay handle getter，但 applyOverlayMode 仍在 index.ts 直到 2.10）
- **改动文件**: 新增 `src/main/ipc/overlay.ts`；`index.ts`；新增 `src/main/overlay-drag.test.ts`
- **操作**:
  1. 先把 drag 逻辑（drag-start/move/end + 3px 阈值 + moved 持久化）提纯为可测**状态机** `createDragReducer()`（纯状态：`{winX,winY,mouseX,mouseY,moved}`），坐标来自 payload `m.x/m.y`（非 `getCursorScreenPoint`）。
  2. `overlay:drag-start/move/end`、`overlay:set-ignore-mouse`（`{forward:true}` + `overlayInteractive` no-op 守护）、`overlay:request-mode` → `ipc/overlay.ts` `registerOverlayIpc(deps)`（deps: `getOverlayWindow`/`applyOverlayMode`/`isInteractive`/`getDragStart`/`setDragStart`/`persistOverlayPos`）。
- **测试**（mocked-port）:
  - `drag 3px 阈值` · drag-start 后 move dx=2,dy=2 → 无 setPosition；dx=5 → setPosition 且 moved 锁定；后续 dx=1 → 仍 move（moved sticky）。
  - `drag-end 仅 moved 时持久化` · moved=false → 无 persist；moved=true → persist 用 getPosition 坐标，保留其它字段（密钥不动，复用 0.6 语义）。
- **闸门**: `npm test`、`npm run typecheck` 全绿；**手工 QA**：拖拽 overlay 后重启位置保留；单击不误触发移动。
- **完成标志**: overlay 输入类 IPC 抽出；drag 测试绿。
- **行为保持**: drag reducer 是纯状态机移动；阈值/持久化条件逐字保留；测试守护点击 vs 拖拽边界。
- **回滚**: `git revert`。

### Step 2.8 — 抽取 WindowManager（main/selector 窗口 + tray + isQuitting）
- **依赖**: 2.2（selectorDisplayId owner）, 2.7
- **改动文件**: 新增 `src/main/window-manager.ts`；`index.ts`
- **操作**:
  1. 把 `mainWindow`/`selectorWindow`/`tray`/`isQuitting`/`selectorDisplayId` 及 `createMainWindow`/`restoreMainWindow`/`createSelectorWindow`/`updateTrayMenu`/`hardenWebContents` 移入 `window-manager.ts`，暴露 getter（`getMainWindow`/`getSelectorWindow`/`getSelectorDisplayId`）与操作（`createMainWindow`/`restoreMainWindow`/`updateTrayMenu(deps)` 等）。
  2. `updateTrayMenu` 反向依赖 overlay 状态（`overlayInteractive`/`overlay.isVisible()`）与 `applyOverlayMode`——通过**注入回调**（`getOverlayInteractive`/`isOverlayVisible`/`showOverlayInactive`/`hideOverlay`/`applyOverlayMode`）解耦，**不** import OverlayController（避免循环）。此刻 overlay 仍在 `index.ts`，注入的是 `index.ts` 里的闭包。
  3. 保留：main close→hide（非 isQuitting）、`restoreMainWindow` 重置 `isQuitting=false` + 夹取 workArea + `show()+focus()`（main 可 focus）、`setMainWindow(mainWindow)`/`setMainWindow(null)` 与 llm.ts 配对、selector 关闭 `dock.show()` + 300ms 后 `isCapturing=false`。
  4. 路径 `__dirname` 引用（`../renderer/*`、`../preload/index.js`）随文件移动后**必跑 `npm run build` 验证运行时路径未断**。
- **测试**（mocked-port，用假 BrowserWindow 记录调用序）:
  - `restoreMainWindow 夹取数学` · window 在 x=9999、workArea 宽 1440 → 夹取 `x=area.x+width-w`；destroyed 时重置 `isQuitting`。
  - `registerShortcut 记录失败` · `globalShortcut.register→false` → `failedShortcuts` 含该 accelerator。
- **闸门**: `npm test`、`npm run typecheck`、`npm run build`（产出 `out/main/index.js` 且路径未断）全绿；**手工 QA**：关主窗→托盘/⌘⌥激活恢复；截图窗弹出不误触发主窗恢复。
- **完成标志**: main/selector/tray 归 WindowManager；两测试绿；build 路径 OK。
- **行为保持**: 纯移动 + 注入回调解耦；close/restore/dock/setMainWindow 逐字保留；build 验证路径不变式。
- **回滚**: `git revert`。

### Step 2.9 — register(deps) 全域上移到建窗之前（IPC 注册时机验收）
- **依赖**: 2.2, 2.3, 2.5, 2.6, 2.7, 2.8
- **改动文件**: `src/main/index.ts`；新增 `src/main/bootstrap.test.ts`
- **操作**:
  1. 重排 `whenReady` 顺序为：(1) activation policy + `cleanupStaleTempAudio` + config restore + permission handlers；(2) **注册全部 `ipc/*` 域**（`registerAppIpc`/`registerClipboardIpc`/`registerConfigIpc`/`registerLlmIpc`/`registerAsrIpc`/`registerOverlayIpc`/`registerScreenshotIpc`）；(3) 建窗；(4) heartbeat；(5) tray；(6) shortcuts。
  2. **所有 deps 必须是 getter/闭包**（`getOverlayWindow:()=>overlayWindow`），因注册时窗口尚 null。逐个核对无"值快照"（这是最易静默 break 点：冻结成初始 null）。
  3. 保留 ASR startup `||` 兜底（whenReady 内，与 config:set 的 `!==undefined` 区分）、permission 仅授 `'media'`。
  4. **File polyfill 硬化**：把 `(globalThis).File ??= NodeFile` 移进独立的 `src/main/polyfill.ts`，作为 `index.ts` 的**第一个副作用 import**（`import './polyfill'` 在 `import ... from './llm'` 之前），保证 `openai` 求值前 `File` 已定义——不再依赖 esbuild 的书写顺序巧合。
- **测试**:
  - `bootstrap 三元序` · characterization · spy `setConfig`（config restore）、`ipcMain.handle/.on`、`createMainWindow/createOverlayWindow` 的调用序 → 断言 **config-restore < 任一 IPC 注册 < 任一建窗**（不只是「IPC<建窗」）。
  - `deps 是 getter 非值快照` · mocked-port · **建窗前**调用某 `register*(deps)`，此刻 `getOverlayWindow()` 返回 null；建窗后触发该 handler → 断言它读到**新** window 而非被冻结的 null。
  - `File polyfill 前置` · import `./llm` 后断言 `typeof File !== 'undefined'`。
- **闸门**: `npm test`（含此验收）全绿；`npm run typecheck`、`npm run build`；**手工 QA**：冷启动后立刻操作各窗（配置读取/流式/截图），无 "No handler registered"。
- **完成标志**: 验收测试绿；冷启动手工冒烟无缺 handler。
- **行为保持**: 现状是 module-eval 注册（先于建窗）；本 Step 把注册移入 whenReady 但保证 **config-restore < IPC 注册 < 建窗** 三元序不变，行为等价；getter 保证 handler 读到 live 窗口；三元序 + getter-非快照 + File-polyfill 三条验收测试锁定。
- **回滚**: `git revert`（回到 module-eval 分散注册）。

### Step 2.10 — 抽取 OverlayController（main 侧最后一个，两模式契约逐调用迁移）
- **依赖**: 2.8, 2.9
- **改动文件**: 新增 `src/main/overlay-controller.ts`；`index.ts`；`window-manager.ts`（把注入回调改为指向 OverlayController）；新增 `src/main/overlay-controller.test.ts`
- **操作**:
  1. 把 `overlayWindow`/`overlayUserVisible`/`overlayInteractive`/`overlayDragStart`/`overlayRebuildCount` 及 `createOverlayWindow`/`ensureOverlayVisible`/`applyOverlayMode`/heartbeat body 移入 `overlay-controller.ts`。
  2. **逐调用迁移，绝不"顺手清理"**。严格保留：永远 `showInactive()` 从不 `show()/focus()/blur()`；每次 show/rebuild/restore 后重设 `setContentProtection(true)`；per-mode 顺序（interactive: `setFocusable(true)`→`setIgnoreMouseEvents(false)`；passthrough: `setIgnoreMouseEvents(true)`→`setFocusable(false)`）；切模式前后位置保全；heartbeat 单分支（仅 `overlayUserVisible && !isVisible()` 内）restore；did-finish-load/heartbeat 的 `if(!overlayInteractive)` 才重置 passthrough；crash-rebuild ≤5 且 did-finish-load 重置计数；`acceptFirstMouse:true`+`focusable:false`+`show:false`+`type:'panel'`+`transparent` 构造集。
  3. WindowManager 之前注入的 overlay 回调改为指向 OverlayController 的方法（`updateTrayMenu` 仍经回调读 overlay 状态，无 import 循环）。`register*` 的 `applyOverlayMode`/`ensureOverlayVisible` deps 改指 OverlayController。
  4. build 验证 `__dirname` 路径（overlay 的 `../renderer/*`/preload）未断。
  5. **ESLint 强制护栏**：加 `no-restricted-syntax` 规则，禁止在 overlay window handle 上调用 `.show(`/`.blur(`/`.focus(`（只允许 `showInactive`），设为 **error** 并纳入 `npm run lint` 门（非 optional）。
- **测试**（mocked-port，假 BrowserWindow 记录方法调用序）:
  - `applyOverlayMode 调用顺序` · interactive → `[setFocusable(true), setIgnoreMouseEvents(false)]`；passthrough → `[setIgnoreMouseEvents(true), setFocusable(false)]`；**无 blur**；getPosition 变化时才 setPosition；发 `overlay:mode`。
  - `applyOverlayMode 清 drag + 保位` · 设 overlayDragStart 后调用 → drag 清空；getPosition 不同 → setPosition 回原坐标。
  - `heartbeat restore 单分支` · isVisible=false & userVisible=true → 序列 `showInactive, setAlwaysOnTop('screen-saver'), setContentProtection(true), setIgnoreMouseEvents(true if !interactive), updateTrayMenu`；isVisible=true → 无调用；userVisible=false → 无调用。
  - `ensureOverlayVisible 可见时 no-op` · isVisible=true → 无 showInactive/setContentProtection；隐藏时 → 4 项调用 + `overlayUserVisible=true`。
  - `crash-rebuild 计数` · mocked-port · 触发 `render-process-gone` → `destroy`；`closed` 后 500ms 重建；连续触发 5 次后**不再**重建；一次 `did-finish-load` 后计数归零。
- **闸门**: `npm test`（含四组 overlay 测试）全绿；`npm run typecheck`、`npm run build`（路径 OK）；**手工 QA 全套 overlay 清单**（不切屏、内容保护、⌘⌥E 无闪无位移、⌘⌥H 隐显、崩溃自动重建）。
- **完成标志**: `index.ts` 收缩为薄 bootstrap；overlay 四组测试绿；overlay 手工 QA 全过。
- **行为保持**: 逐调用纯移动，每条两模式不变式由 mocked-port 调用序测试锁定；手工 QA 兜底不可单测的视觉/切屏行为。
- **回滚**: `git revert`（把 overlay 逻辑挪回 `index.ts`）。

---

## Phase 3 — 绞杀渲染层 App.tsx（tabs + hooks + shared/markdown）

**目标**：拆 `main-window/App.tsx`(1082) 与 `overlay/App.tsx`(799)。安全的纯组件先 cut-paste；`useAsrCapture`、`useLlmSubmit`、`useStreamingAnswer` 等状态机**与其测试同一步落地**（旧代码里是内联闭包，抽取即测）。

**顺序理由**：
- markdown 四个纯函数（`escapeHtml`/`renderInline`/`renderMarkdownBlock`/`parseSegments`）是最高价值可**先测后移**目标——先在 overlay 内就地写特征测试（Step 3.1），再移到 `shared/markdown`（Step 3.2）。
- overlay 的流式状态机是内联闭包，不可单独测——先写 jsdom 特征测试驱动 App（Step 3.3），再抽 `useStreamingAnswer`（Step 3.4），把同一测试重指向 hook。
- main-window 的 `VoiceTab` 是全场最脆的状态机（三 ref + 双计时器 + ⌘⌥X），**整块**抽 `useAsrCapture`，测试与抽取同步（Step 3.7）。
- "三 tab 恒挂载"（`display:none`）不变式必须在任何 tab 抽取前有特征测试守护（Step 3.5）。

**相位退出标准**：markdown 纯函数 + 三大 hook（streaming/llm-submit/asr-capture）+ service-test/config hook 均有绿测；三 tab 恒挂载、⌘⌥X 全链路手工 QA 通过；overlay 焦点守卫/拖拽/透明度手工确认。

### Step 3.1 — markdown 纯函数特征测试（就地，先测）
- **依赖**: 0.2
- **改动文件**: `overlay-window/App.tsx`（仅 `export` 这四个纯函数 + `Segment` 类型，不改实现）；新增 `src/renderer/overlay-window/markdown.characterization.test.ts`
- **操作**: 给 `escapeHtml`/`renderInline`/`renderMarkdownBlock`/`parseSegments`/`Segment` 加 `export`（就地，body 不动）。
- **测试**（unit-pure / characterization，全部锁定当前输出字符串）:
  - `escapeHtml 顺序` · `'&<>'`→`'&amp;&lt;&gt;'`；`'a & b'`→`'a &amp; b'`；`&` 先转义不二次转义。
  - `renderInline 粗体/行内码/链接中和` · `**x**`→`<strong ...>x</strong>`；`` `x` ``→`<code ...>x</code>`；`[t](https://x)`→无 href 的 `<span>`；`[t](javascript:...)` 不匹配（安全）。
  - `renderMarkdownBlock 空行/标题/列表/引用/转义` · 空行→`height:2px` spacer；`#`/`##`/`###`→1.05/1/0.95em，`####`→落普通 div；`1. `/`- `/`* `/`> ` 各分支；`# <b>`→标题含 `&lt;b&gt;`。
  - `parseSegments 闭合/无 lang/流式开 fence/行内 ``` 误判守护/BOL index` · 覆盖 streaming=true/false 差异与"fence 必须行首"守护。
- **闸门**: `npm test` 全绿。
- **完成标志**: markdown 特征测试绿（在 overlay 原实现上）。
- **行为保持**: 仅加 `export`，实现不动；测试锁定输出字符串。
- **回滚**: `git revert`（去掉 export 与测试）。

### Step 3.2 — 抽取 shared/markdown
- **依赖**: 3.1
- **改动文件**: 新增 `src/shared/markdown/index.ts`；`overlay-window/App.tsx`；测试文件 import 路径更新
- **操作**: 把四个纯函数 + `Segment` 移入 `shared/markdown/index.ts`；overlay 改 import；`MarkdownBlock`/`AnswerText` 可留 overlay（仅依赖纯函数）。保持 `memo` 与 `useMemo(...,[text,streaming])` 引用稳定。
- **测试**: 复用 3.1 全部断言（import 指向 `shared/markdown`）。
- **闸门**: `npm test`（含 3.1 断言）全绿；`npm run typecheck`。
- **完成标志**: markdown 归 `shared/`；测试绿。
- **行为保持**: 纯移动；3.1 断言前后不变即证。
- **回滚**: `git revert`。

### Step 3.3 — overlay 流式机 jsdom 特征测试（先测内联闭包）
- **依赖**: 0.2
- **改动文件**: `test/setup.ts`（补 `mockElectronAPI`）；新增 `src/renderer/overlay-window/streaming.characterization.test.tsx`
- **操作**:
  1. `test/setup.ts` 加 `mockElectronAPI`（所有 `on*` 返回可捕获 handler 的 mock；`getPublicConfig` resolve `{}`）与 RAF stub（`vi.stubGlobal('requestAnimationFrame', cb=>{cb(0);return 0})`）。
  2. jsdom 渲染 overlay `App`，从 mock 捕获注册的 `onAnswerStart/Chunk/Done/Error/Clear` handler，直接驱动它们，断言 DOM/history 行为。
- **测试**（characterization，`// @vitest-environment jsdom`）:
  - `start→chunk→chunk→flush→done` · 一条 history item `answer` 含 `'ab'`、status done；多 chunk 合并（RAF 批处理）。
  - `overlapping streams 不串线` · start{1},start{2},chunk{1,'x'},chunk{2,'y'} → item1='x'、item2='y'。
  - `orphan error id==null 空历史` · error{null,'boom'} → 一条负 id error item。
  - `orphan error 在流式 last 前插入` · start{1}(streaming),error{null,'busy'} → 顺序 `[errItem(neg), item1(streaming)]`。
  - `error 匹配 id` · start{1},error{1,'x'} → item1 变 error，无合成。
  - `done flush 尾字` · start{1},chunk{1,'tail'}(不推进 RAF),done{1} → answer 含 'tail'。
  - `clear` · 填充后 clear → history 空、buffer 清。
- **闸门**: `npm test` 全绿。
- **完成标志**: 7 条流式特征测试在**内联闭包**上绿。
- **行为保持**: 纯新增测试 + setup mock；overlay 源码仅需（若必要）导出可测点，实现不动。
- **回滚**: `git rm` 测试；还原 setup。

### Step 3.4 — 抽取 useStreamingAnswer（把 3.3 测试重指向 hook）
- **依赖**: 3.3
- **改动文件**: 新增 `src/renderer/overlay-window/hooks/useStreamingAnswer.ts`；`overlay-window/App.tsx`
- **操作**:
  1. 把 effect 6（chunkBuf/flush/scheduleFlush/5 订阅）+ `history` state + `nextIdRef` 移入 hook，返回 `{history}`（及可选 clear signal）。
  2. **`stickToBottomRef` 留 view 且钉底保持同步**——把 `stickToBottomRef` 作为参数 `ref` **传入 hook**，hook 在 `onAnswerStart` 回调体内**同步**写 `stickToBottomRef.current=true`（等价原内联赋值）；**不**改成「返回递增 seq 让 view 跨 render 异步设 ref」（那会让钉底晚一个 render、与用户滚动竞争）。保留 flush updater "只有匹配 item 换新对象"的性质（memo 依赖稳定）。
- **测试**: 3.3 全部 7 条重指向 hook（jsdom 渲染一个只用 hook 的测试组件，或继续渲染 App 但断言不变）。
- **闸门**: `npm test`（7 条）全绿；`npm run typecheck`；**手工 QA**：overlay 流式回答滚动跟随、停在底部/回看不被拉底。
- **完成标志**: `useStreamingAnswer` 存在；7 条测试绿；滚动手工 OK。
- **行为保持**: 逻辑整块移动；3.3 断言不变即证；scroll ref 留 view 避免静默回归。
- **回滚**: `git revert`。

### Step 3.5 — 三 tab 恒挂载 + 焦点守卫 + drag 特征测试（main-window & overlay，先测）
- **依赖**: 3.3
- **改动文件**: 新增 `src/renderer/main-window/mounted.characterization.test.tsx`、`src/renderer/overlay-window/interaction.characterization.test.tsx`
- **操作**: jsdom 渲染，靠 mockElectronAPI 驱动。
- **测试**（characterization）:
  - `三 tab 恒挂载` · 渲染 main-window `App`，`tab==='ask'` 时仍能查到 Voice 的 draft textarea（`display:none` 而非卸载）。
  - `overlay 焦点守卫` · focusin 非 input 元素 → `blur()` 调用；focusin 于 `inputRef`/`extractedRef` → 不 blur。
  - `overlay drag 编排` · header mousedown(button0，非 button 元素) → `startOverlayDrag(screenX,screenY)`；mousemove → `moveOverlayDrag`；mouseup → `endOverlayDrag` + 监听移除。
  - `StatusDot 颜色优先级` · `{listening:true,llm:'streaming'}`→cyan；`{listening:true,llm:'idle'}`→green。
  - `opacity 用 public config` · 断言 `getConfig` **未**被调用、`getPublicConfig` 被调用。
  - `answer-start 同步钉底` · 驱动 `onAnswerStart` 后，**同一 tick 内** `stickToBottomRef.current===true`（锁定同步钉底语义，守护 3.4 抽取不引入异步延迟）。
- **闸门**: `npm test` 全绿。
- **完成标志**: 恒挂载/焦点/drag/opacity 守护测试绿（在拆分前）。
- **行为保持**: 纯新增测试；守护后续 tab/hook 抽取不破这些不变式。
- **回滚**: `git rm` 测试。

### Step 3.6 — cut-paste 纯组件（Field/TestRow/SettingsTab/AskTab 的呈现层）
- **依赖**: 3.5
- **改动文件**: 新增 `src/renderer/main-window/components/Field.tsx`、`components/TestRow.tsx`、`tabs/Settings.tsx`、`tabs/Ask.tsx`；`main-window/App.tsx`
- **操作**:
  1. `Field`/`TestRow`（纯呈现）→ `components/`。
  2. `SettingsTab` JSX + 本地字段 state + 三个 test 函数 → `tabs/Settings.tsx`（本 Step 先整体搬运，`useServiceTest`/`useConfig` 的进一步抽取放 3.8）。
  3. `AskTab` JSX + 本地 state → `tabs/Ask.tsx`（流式关联机 `useLlmSubmit` 抽取放 3.9；本 Step 先整体搬）。
  4. **保持三 tab 仍 `display:none` 恒挂载**；App 只做路由与 import。
- **测试**:
  - `Field/TestRow 渲染` · unit-pure · `TestRow` `st==='testing'` 显示"测试中…"，否则 ✓/✗ msg；`Field` password vs text，`onChange` 调用。
  - 复用 3.5 恒挂载断言（import 路径更新后仍绿）。
- **闸门**: `npm test`、`npm run typecheck` 全绿。
- **完成标志**: 四文件抽出；恒挂载 + Field/TestRow 测试绿。
- **行为保持**: 纯 cut-paste（JSX + 本地 state 无跨组件耦合，除 `window.electronAPI`）；恒挂载测试守护路由不变。
- **回滚**: `git revert`。

### Step 3.7 — 抽取 useAsrCapture（VoiceTab 状态机整块 + 同步测试）
- **依赖**: 3.5
- **改动文件**: `test/setup.ts`（补 `mockMediaRecorder`）；新增 `src/renderer/main-window/hooks/useAsrCapture.ts`、`hooks/appendToDraft.ts`（纯）；`src/renderer/main-window/tabs/Voice.tsx`；`main-window/App.tsx`
- **操作**:
  1. 先抽纯函数 `appendToDraft`（过滤 <2 字符/`isHallucinatedText`、空格拼接、末 2000 字符截断）到 `hooks/appendToDraft.ts`，就地写 unit-pure 测试。
  2. 把录音机/计时器/toggle 簇（`recorderRef`/`streamRef`/`listeningRef`/`transcribingRef`/`transcribeGuardRef`(8s)/`togglingRef`/`langRef`/`deviceIdRef`/`devicesRef`/`startCapture`/`stopCapture`/`onstop`+40s watchdog/`onAsrPttToggle` 效果/设备枚举/`grantAndRefresh`）**整块**移入 `useAsrCapture`。**严禁把 ref 读法改成读 state**（stale-closure 陷阱；保留 `eslint-disable exhaustive-deps`）。保留 `recorderRef` null-before-stop 顺序、`transcribing` 同时是 state 和 ref、`readOnly={listening}`。
  3. `tabs/Voice.tsx` 用该 hook，JSX cut-paste。
- **测试**（mocked-port + fake timers，与抽取同步）:
  - `首次 ⌘⌥X 启动` · `listening=true`，`startListening()` 一次，`rec.start()` 一次，`recorderRef` 非空。
  - `二次 ⌘⌥X 停止→转写` · 触发 `onstop`(>2000B blob) → `transcribeChunk(buf,mime,lang)`，resolve 后 `appendToDraft`+`sendTranscript({text,isFinal:true})`，`transcribing` 清。
  - `onstop 永不触发 8s 兜底`（回归"第一次成功之后没反应"）· 推进 8s → `transcribingRef=false`、error 复位、后续 ⌘⌥X 可启动。
  - `40s 转写 watchdog` · `transcribeChunk` 永不 settle → 40s 后 finally 清 `transcribing`，error 含"转写超时"，且 8s guard 先清不双重复位。
  - `双击重入` · 两同步 toggle → `getUserMedia` 仅一次。
  - `转写中拒绝启动` · `transcribingRef=true` → 无 `getUserMedia`，error 提示，draft 不清。
  - `设备回退` · `getUserMedia({deviceId:exact})` 抛 `OverconstrainedError` → 以 `{audio:true}` 重试仍启动。
  - `短/静音 blob` · <2000B → "录音太短" 无 `transcribeChunk`；>2000B 但 <800B/s → 静音警告仍转写。
- **闸门**: `npm test`（8+ 条）全绿；`npm run typecheck`；**手工 QA**：真实设备 ⌘⌥X 启→停→转写→送 AI，overlay 收 `sendTranscript`（见清单）。
- **完成标志**: `useAsrCapture` 存在；状态机测试全绿；真机 ⌘⌥X 全链路 OK。
- **行为保持**: 整块移动（不拆到 hook 边界以下，避免"第一次成功后没反应"复现）；ref 读法不变；测试锁定五 ref/双计时器/toggle 时序；真机 QA 兜底。
- **回滚**: `git revert`。

### Step 3.8 — 抽取 useServiceTest + useConfig（Settings 的 IPC 侧）
- **依赖**: 3.6
- **改动文件**: 新增 `src/renderer/main-window/hooks/useServiceTest.ts`、`hooks/useConfig.ts`；`tabs/Settings.tsx`、`tabs/Ask.tsx`、`App.tsx`
- **操作**:
  1. `useServiceTest`：三个 `test*` + 三个 `*Test` state，注入 `{testLLM,testVision,testASR}`。
  2. `useConfig`：集中 `getConfig`/`setConfig` 与 App 的两个 mount effect（status + first-run）、JD 门控（`jdLoadedRef`）、save 校验。**保留混合写节奏**（opacity/mode/answerLang 交互即写、prompt/resume blur 写、其余保存写）、**load-before-save 顺序**（避免空字段覆盖密钥）、各窗口用各自 channel（Settings 用全量 `getConfig`，Ask 只 `jobDescription`，Voice 只 `asrApiKey`）。
- **测试**（mocked-port + fake timers）:
  - `useServiceTest` · 每个 test → `st:'testing'`→`ok`/`fail`（据 `{ok,message}`），抛错→fail 带 message。
  - `useConfig JD 门控` · 首渲染在 `getConfig` resolve 前不 `setConfig`；resolve 后编辑 JD 500ms debounce `setConfig({jobDescription})`。
  - `useConfig save 校验` · 空 apiKey → `saveErr` 无 `setConfig`；坏 baseUrl → `saveErr`；有效 → 全量 `setConfig`（含密钥）、`onSaved()`、`saved` true→2s 后 false。
  - `lazy-init 白名单` · unit-pure · `asrLang='garbage'`→`'zh-CN'`，`='en-US'`→`'en-US'`；`answerLang` 仅收 zh/en/auto。
- **闸门**: `npm test`、`npm run typecheck` 全绿；**手工 QA**：只拖 opacity 滑块→重启密钥仍在（不变式 #2/#6）。
- **完成标志**: 两 hook 存在；测试全绿；密钥保全手工 QA 通过。
- **行为保持**: 逻辑整块移动；混合写节奏/load-before-save/各窗 channel 逐字保留；测试锁定门控与校验。
- **回滚**: `git revert`。

### Step 3.9 — 抽取 useLlmSubmit（AskTab 流式关联机）
- **依赖**: 3.6
- **改动文件**: 新增 `src/renderer/main-window/hooks/useLlmSubmit.ts`；`tabs/Ask.tsx`
- **操作**: 把 `pendingSubmitRef`/`myStreamIdRef`/`sendTimerRef`/`submit`/effect(152-166) 移入 hook，注入 `{askQuestion,onAnswerStart,onAnswerDone,onAnswerError}`，返回 `{isSending,submit}`。保留 id 关联语义（pending 收养首个 start；done 仅 `!pending && id===myStreamId` 复位；error 于 `pending || id===myStreamId` 复位；`id:null` 前置错误路径；30s 安全计时）。
- **测试**（mocked-port + fake timers）:
  - `useLlmSubmit 关联` · submit → `askQuestion`，`isSending=true`，`pending=true`；`start{7}` 收养；`done{7}` 复位；外来 `done{9}` 不复位；`error{null}` 于 pending 复位；30s 无事件→复位。
- **闸门**: `npm test`、`npm run typecheck` 全绿；**手工 QA**：Ask tab 提问→答案流式→发送按钮正确复位。
- **完成标志**: `useLlmSubmit` 存在；关联测试绿。
- **行为保持**: 逻辑整块移动；id 关联/计时逐字保留；测试锁定所有分支。
- **回滚**: `git revert`。

### Step 3.10 — 抽取 overlay 剩余 hook（useAsrDisplay/useOverlayMode/useOverlayOpacity/useOverlayDrag）+ ImageExtractionPanel
- **依赖**: 3.4, 3.5
- **改动文件**: 新增 `overlay-window/hooks/useAsrDisplay.ts`、`useOverlayMode.ts`、`useOverlayOpacity.ts`、`useOverlayDrag.ts`；新增 `overlay-window/ImageExtractionPanel.tsx`；`overlay-window/App.tsx`
- **操作**:
  1. `useAsrDisplay`（transcript/asr-start/stop effects + `listening`/`finalLines`，返回含 `finalLines.join(' ')`）。
  2. `useOverlayMode`（display-only badge）、`useOverlayOpacity`（**必须用 `getPublicConfig` 不得改 `getConfig`**）、`useOverlayDrag`（返回 `onDragMouseDown`，button-guard 随迁）。
  3. `ImageExtractionPanel`：OCR 面板 state + effect + `submitExtracted`；`extractedRef` 被焦点守卫引用——**必须把 ref plumb 出来**（`forwardRef` 或共享 ref 传入），否则守卫 blur 掉 OCR 输入框（静默 break）。焦点守卫本身**留 view**。
- **测试**:
  - `useAsrDisplay final 行 cap/filter` · mocked-port · 8 final + 1 非 final + 1 单字符 → `finalLines` 长 6，排除非 final 与单字符。
  - 复用 3.5 的 drag/焦点/opacity/StatusDot 断言（import 更新后仍绿）——尤其 opacity 用 public config、焦点守卫仍能看到 `extractedRef`（新增断言：OCR 面板挂载后 focusin 于 OCR textarea **不**被 blur）。
- **闸门**: `npm test`、`npm run typecheck` 全绿；**手工 QA overlay 全套**（透明度 live、mode badge 不可点、拖拽、截图 OCR 编辑框可编辑不被 blur）。
- **完成标志**: overlay hook/panel 抽出；测试绿；overlay 手工 QA 全过。
- **行为保持**: 逐块移动；opacity 用 public config、drag/焦点/badge 不变式由测试 + QA 双守；`extractedRef` plumb 防守卫误 blur。
- **回滚**: `git revert`。

---

## Phase 4 —（可选）llm/ StreamController 与提示构建拆分

> **注意**：**Phase 3 结束后 app 已完整重构且可用**。Phase 4 纯属"内聚度打磨"，不改用户可见行为，可择日进行或永久搁置。conversation 用**函数**而非 class；provider-client 只为可测性，非多 provider 抽象。**唯一非行为保持的一步（去 4s 轮询）单列 4.6 并以手工 QA 强闸门把关，不做则整相仍安全。**

**顺序理由**：先把纯函数（prompt-builder、conversation、provider-client）抽出并测（4.1–4.4，全 additive/纯移动），再把 stream 状态封成 `StreamController`（4.5），最后**可选**替换 4s 轮询（4.6）。

**相位退出标准**：prompt-builder/conversation/StreamController 有绿测；`answerLang` 参数化无漏改（由 `streamAnswer` 特征测试守护）；force-disown/re-entrancy 不变式测试绿；若做 4.6，去轮询后手工 QA 通过。

### Step 4.1 — streamAnswer 特征测试（先测内联闭包，作 answerLang/record 安全网）
- **依赖**: 0.7
- **改动文件**: 新增 `src/main/llm.characterization.test.ts`
- **操作**: `vi.mock('./openaiClient')` 提供假 client（`chunkStream`/`hangingStream` 辅助），假 `BrowserWindow`，`setMainWindow`。
- **测试**（characterization，跑在旧 `llm.ts`）:
  - `re-entrancy 守护` · 首流 hang 时 `streamAnswer('A')` 未 await，再 `streamAnswer('B')` → B 触发 `llm:error {id:null,message:'上一个问题还在生成中，请稍候'}`。
  - `record-only-on-clean-completion` · 两 chunk 后完成 → 一次 `llm:done`、chunk 拼接、history +1 轮；中途 abort → `llm:done`（user-stop）、history 不增。
  - `answerLang 输出` · 设 `answerLang='en'` 后 `streamAnswer` 的 system prompt 含英文措辞（锁定当前措辞，供 4.2 参数化后回归）。
- **闸门**: `npm test` 全绿。
- **完成标志**: 三条特征测试在旧 `llm.ts` 上绿。
- **行为保持**: 纯新增测试；作为 4.2 参数化 `answerLangPhrase`（易静默错型）的回归网。
- **回滚**: `git rm` 测试。

### Step 4.2 — 抽取 llm/prompt-builder.ts（answerLangPhrase 参数化）
- **依赖**: 4.1
- **改动文件**: 新增 `src/main/llm/prompt-builder.ts`；`llm.ts`
- **操作**: 移 `answerLangPhrase`（**加 `answerLang` 参数**，删除对 `currentConfig` 的读取）、`buildBaseMessages`/`buildMessages`/`buildImageMessages`（透传 `answerLang`）、`ANSWER_RULES`/`DEFAULT_SCREENSHOT_PROMPT`/两条 intro 模板、char-budget 常量。**更新全部调用点**（`buildMessages`/`buildImageMessages` 传 `currentConfig.answerLang`）——漏一处即静默错语言，故 4.1 特征测试必须仍绿。
- **测试**（unit-pure）:
  - `无 resume/jd` · system[0] 以中文 intro 开头、含 `ANSWER_RULES`、无 简历/岗位块；末条 `{role:'user',content:'Q'}`；长度 2。
  - `有 resume+jd` · 含简历块（前）+ 岗位块（后）；whitespace-only resume 无块。
  - `answerLangPhrase` · `'en'`/`'auto'`/`'zh'`/未知 各映射；`buildMessages(...,'en')` intro 含英文措辞、`buildImageMessages(...,'auto')` 含 auto 措辞。
  - `char-budget windowing 保最新` · 4 轮超 6000 → 仅最新若干入窗；单条 8000 的最新轮仍保留；replay 顺序 oldest→newest、user→assistant。
- **闸门**: `npm test`（含 4.1 特征测试仍绿）全绿；`npm run typecheck`。
- **完成标志**: prompt-builder 抽出；unit 测试 + 4.1 回归全绿。
- **行为保持**: 移动 + 参数化；4.1 特征测试证明 `answerLang` 未错型；unit 测试锁定 prompt 装配顺序。
- **回滚**: `git revert`。

### Step 4.3 — 抽取 llm/conversation.ts（函数，非 class）
- **依赖**: 4.1
- **改动文件**: 新增 `src/main/llm/conversation.ts`；`llm.ts`
- **操作**: 移 `conversationHistory`/`MAX_HISTORY_ROUNDS`/`clearHistory`，导出 `record(q,a)`（**仅按轮数上限 splice**，char 预算留 prompt-builder 读时）、`snapshot()`、`clear()`。**不**把 char 上限挪进 `record`（会改行为）。
- **测试**（unit-pure）:
  - `record 轮数 trim` · push 7 轮 → `snapshot().length===5`，保留 3..7；>6000 字符答案仍存（char 不在写时 cap）。
- **闸门**: `npm test`（含 4.1）全绿；`npm run typecheck`。
- **完成标志**: conversation 抽出；轮数 trim 测试绿。
- **行为保持**: 纯移动；write=轮数 cap / read=char 预算的分工逐字保留；4.1 record 特征测试守护。
- **回滚**: `git revert`。

### Step 4.4 — 抽取 llm/provider-client.ts（re-export，保 mock 缝）
- **依赖**: 0.7
- **改动文件**: 新增 `src/main/llm/provider-client.ts`；`llm.ts`/`asr.ts`
- **操作**: `provider-client.ts` re-export `getOpenAIClient`（来自 `openaiClient.ts`）+ `describeApiError`（来自 `apiError.ts`）+ 集中超时常量。**保持 `openaiClient.ts` 为长期 mock 缝**（不把真实实现挪进 provider-client，否则 0.7/4.1 的 `vi.mock('./openaiClient')` 失效）。llm/asr 改 import provider-client。
- **测试**: 复用 0.7 的 `describeApiError`/`getOpenAIClient` 测试（缝路径不变，断言不变）。
- **闸门**: `npm test`（含 0.7、4.1）全绿；`npm run typecheck`。
- **完成标志**: provider-client 存在；旧测试全绿（证明 mock 缝未破）。
- **行为保持**: 纯 re-export；mock 路径 `./openaiClient` 保留即证。
- **回滚**: `git revert`。

### Step 4.5 — 抽取 StreamController（force-disown 不变式测试）
- **依赖**: 4.1, 4.4
- **改动文件**: 新增 `src/main/llm/stream-controller.ts`；`llm.ts`
- **操作**: 把 `isStreaming`/`activeAbort`/`streamGen`/`nextStreamId` 与 `streamChat` 的 id/gen/abort/finally 脚手架封入 `StreamController`（**单实例**，避免 `nextStreamId` 重置产生重复 id）。`stop()`/`forceReset()`（bump gen、null abort、`isStreaming=false`、**不 await** 前一 promise）/`isBusy()`/`run(streamFactory)`。**`myGen` 必须是流启动时闭包捕获的局部**，finally 用它比较（不得从实例字段重读）。`safeSend` 失败→abort 的耦合保留。
- **测试**（mocked-port）:
  - `force-disown（启 A、A hang、启 B）` · A 用 `hangingStream`；`forceReset()` 后启 B(`chunkStream(['x'])`)；断言 B 正常 start/chunk/done；A 的迟到 finally 见 `myGen!==streamGen` 不清 B 状态；`isBusy()` 反映 B；B 未 await A（用 resolved flag 验证）。
  - 复用 4.1 的 re-entrancy / record 特征测试（现经 StreamController，断言不变）。
- **闸门**: `npm test`（含 4.1）全绿；`npm run typecheck`；**手工 QA**：正常提问一轮、hang 流（坏 baseUrl）后再问仍工作。
- **完成标志**: `StreamController` 单实例；force-disown 测试绿；4.1 回归绿。
- **行为保持**: 状态封装为单实例，`myGen` 闭包捕获 + finally 守护逐字保留；force-disown/re-entrancy 测试锁定。
- **回滚**: `git revert`。

### Step 4.6 —（可选中的可选）以 StreamController 即时 stop+start 替换 4s 轮询
- **依赖**: 4.5, 2.4
- **改动文件**: `src/main/stream-safe.ts`（或其调用点）
- **操作**: 把 `startStreamSafely` 的"stop 后 `waitForStreamEnd` 轮询 50ms×80"改为 `stop()` 后**立即**启新流（gen 守护已保证状态安全）。删除 `waitForStreamEnd`。**这是全方案唯一非行为保持步**——渲染层按 id 归属事件，理论稳健，但事件重排属时序问题，只能靠手工 QA 兜底。
- **测试**: 无法单测时序重排；靠手工 QA。
- **闸门**: `npm test` 全绿（状态类不变式）；**手工 QA 强闸门**：Q1 未完立刻问 Q2 → overlay 只显 Q2 答案、无"上一个问题还在生成中"、无 Q1 残漏 chunk；坏 baseUrl 触发 hang 后再问 → 新流工作、无卡"正在生成"。QA 不过则**必须回滚本 Step**（前面 4.1–4.5 仍安全保留）。
- **完成标志**: 无 4s 轮询；上述手工 QA 全过。
- **行为保持**: **不保证**——本 Step 明确改变流控时序；由 gen 守护（状态安全）+ 强手工 QA（时序安全）双重把关，不过即回滚。
- **回滚**: `git revert`（恢复 4s 轮询与 `waitForStreamEnd`）。

---

## 手工 QA 清单

> 凡触碰 overlay/window/截图/流式的 Step，完成后必须逐条勾选相关项。建议每个相位末做一次全量回归。所有 overlay 项在**真实屏幕录制**下验证内容保护。

**§A IPC 冒烟（Step 1.5、2.9）**
- [ ] 冷启动后立即打开设置读到已存配置（无空白/无 "No handler registered"）。
- [ ] Ask/Voice/截图三路 IPC 各触发一次均有响应。

**§B Overlay 两模式与显隐（Step 2.10、3.4、3.10）**
- [ ] 提问时 overlay 始终 `showInactive`，**前台 app 不切换**（不切屏）。
- [ ] 屏幕录制中 overlay **不出现**（内容保护）；⌘⌥H 隐藏再显示后仍不出现（重设 setContentProtection）。
- [ ] ⌘⌥E 快速切换 10 次：**无闪屏、overlay 不位移**。
- [ ] passthrough 模式点击穿透到下层；interactive 模式可点击/输入 overlay。
- [ ] 拖拽 overlay 后重启，位置保留；轻点 header（<3px）不移动窗口。
- [ ] mode badge 不可点击。
- [ ] 强杀 overlay 渲染进程 → 500ms 内自动重建（≤5 次），重建后内容保护仍生效。

**§C 流式回答（Step 3.4、4.5、4.6）**
- [ ] 答案流式渲染，滚动跟随；手动上滚后不被强制拉底；新答案到达重钉底。
- [ ] 停止按钮生效（user-stop 视为 done，不报错）。
- [ ]（4.6）Q1 未完立即问 Q2：仅显 Q2、无"还在生成中"、无 Q1 残 chunk。
- [ ]（4.6）坏 baseUrl 造成 hang 后再问：新流正常、不卡"正在生成"。

**§D ASR（Step 2.6、3.7）**
- [ ] 真机 ⌘⌥X 启动→再按停止→转写→"发送到 AI"整链路通。
- [ ] overlay 面板收到 `sendTranscript`（末 6 行）。
- [ ] **回归**：连续多次 ⌘⌥X 均有反应（不出现"第一次成功、之后没反应"）。
- [ ] 蓝牙麦/设备切换后仍可录音（设备回退）。

**§E 截图对齐（Step 2.2、2.8、3.10）**
- [ ] 主显示器选定已知矩形，截图裁剪与所选区域**像素对齐**。
- [ ] 副显示器（非主屏）重复上项，仍对齐（按 selectorDisplayId 选屏）。
- [ ] OCR 模式：识别文本填入编辑框，**编辑框可编辑不被焦点守卫 blur**。

**§F 配置密钥保全（Step 2.3、3.8）**
- [ ] 仅拖动透明度滑块 → 重启后 API key/ASR key 仍在（未被空 partial 抹掉）。
- [ ] 保存全量配置后密钥正确加密落盘（config.json 中为 `enc:v1:` 前缀）。

**§G 主窗生命周期（Step 2.8）**
- [ ] 关闭主窗 → 隐藏而非退出；⌘⌥/托盘可恢复且夹取到可见显示器。
- [ ] 截图窗弹出期间点击 dock 不误触发主窗恢复。

---

## 一次性执行的风险与缓解

1. **`register(deps)` 用值快照而非 getter（最易静默 break）** — 注册时窗口全为 `null`，若 `register({overlayWindow})` 冻结初始 null，所有 handler 永久读到 null。**缓解**：Step 2.9 强制所有 deps 为 `() => window` getter，并以"IPC 先于建窗注册"验收测试 + 冷启动 §A 冒烟双验。

2. **`answerLangPhrase` 参数化漏改调用点** — 类型均为 `string`，漏传不报错，静默变错语言。**缓解**：Step 4.1 先落 `streamAnswer` answerLang 特征测试，4.2 参数化后该测试仍须绿。

3. **overlay 逐调用迁移时"顺手清理"两模式不变式** — 任何 `show()`/`blur()`/漏 `setContentProtection`/改 setFocusable 顺序都致切屏或泄露录制。**缓解**：Step 2.10 mocked-port 调用序测试 + §B 全套手工 QA + **强制** ESLint `no-restricted-syntax`（error 级、纳入 `npm run lint` 门）禁止 overlay handle 上 `.show(`/`.blur(`/`.focus(`，挡未来手滑。

4. **`useAsrCapture` 拆过细致"第一次成功后没反应"复现** — 五 ref + 双计时器 + toggle 是一个不可分机器。**缓解**：Step 3.7 **整块**抽取，8s/40s guard 与重入测试同步落地，真机 §D 回归。

5. **`stickToBottomRef`/`extractedRef` 跨模块共享被切断** — hook 抢走 ref 致滚动或 OCR 编辑框静默失效。**缓解**：Step 3.4 scroll ref 留 view（hook 只发信号）；Step 3.10 `extractedRef` plumb 出来并加"OCR textarea 不被 blur"断言。

6. **`config:set` 双写路径 / opacity 强转 / ASR 前缀改名被"统一"** — 折 opacity 进循环会 number-vs-string 每次重写盘；ASR 命名混用会互换密钥。**缓解**：Step 1.3 七条特征测试**先于**任何 config 迁移落地，2.3 迁移后断言不变。

7. **store 密钥被未披露 partial 抹空 / DECRYPT_FAILED 被 coerce 成 `''`** — 瞬时 keychain 锁定毁掉好密钥。**缓解**：Step 0.6 七条 store 特征测试作为跨相护栏；config 统一时 `store.ts` 密钥逻辑**字节不动**。

8. **main 侧文件下沉子目录后 `__dirname` 运行时路径断裂（typecheck 抓不到）** — `../renderer/*`、`../preload/index.js` 在打包单文件下 `__dirname` 不变，但需实证。**缓解**：每个移动 main 文件的 Step（2.2/2.8/2.10）闸门含 `npm run build` + 相应窗口手工弹出验证。

9. **4.6 去 4s 轮询是唯一非行为保持步** — 事件时序可能在渲染层重排。**缓解**：单列为可选步、gen 守护保状态、§C 强手工 QA 把关，不过即回滚而不影响 4.1–4.5。

10. **tsconfig composite emit 把 `.test.ts` 卷入 `out/`** — `tsconfig.node.json` include 了 `src/shared/**`。**缓解**：Step 0.2 给两个 tsconfig 加 `exclude` 测试文件，并以"`out/` 下无 `.test.js`"作完成标志。