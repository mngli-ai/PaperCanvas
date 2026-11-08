# PaperCanvas 开发记录

## 首轮 M1 技术预览

- 用户授权：独立软件，允许项目依赖安装和多智能体开发；不调用 lwl。
- 配置只读核对：当前 model momo2/gpt-6.1-sol，delegation provider/model 为空，内置子任务继承父会话。没有改 Hermes 配置。
- 项目：C:/Users/24585/Projects/PaperCanvas。方案/计划 v0.2 存科研/论文架构编辑器。
- 三个并行实现域：domain + demo；runner；Electron main/preload + MCP bridge。主控负责 React/Excalidraw、公式、集成与验收。
- 安装：第一次 Electron 下载 GitHub 直连超时；添加 ELECTRON_GET_USE_PROXY=1 与 GLOBAL_AGENT_HTTP_PROXY 后 npm install 成功。
- 测试：npm test 19/19；npm run typecheck 通过；electron-vite build 通过。
- 实际窗口：out/main/index.js 启动 Electron，CDP 9337 为本次验收专用；正常 bat 不开启调试端口。
- UI：scripts/ui-smoke.mjs 验证公式实时渲染与插入、四次 step into 到 DiT 子层、step back、项目校验，捕获 JS 异常为零。
- MCP：scripts/mcp-smoke.mjs 通过真实 SDK stdio 客户端调用五工具，验证读、校验、带 revision 写及 stale revision 拒绝。预期 revision conflict 日志是负测试，不是失败。
- 根因修复：不稳定 onChange/initialData 使 Excalidraw store 订阅更新触发 React #185，改稳定回调与固定初始化对象；scene load 用双 rAF 静默窗口和 element version signature，避免载入触发用户编辑逻辑清空 runner。
- Electron prompt 不可依赖，命名操作改应用内异步弹窗。
- 启动入口：启动-PaperCanvas.bat，当前不是安装包，依赖本目录 node_modules。

## 独立审查修复复验

两个修复任务已回收，主控重新执行 typecheck、build、30/30 测试通过，Electron UI 冒烟通过。合并长命令在最后 MCP 阶段超时，拆分后 MCP smoke 独立执行通过。保存目标绑定 projectId，不同项目清空旧路径；新增非法几何/文件负载校验。公式编辑保留 ID/绑定；快照保存 tombstone；资源按图引用筛选，载入时 resetScene。保存路径主进程变更仍需退出旧窗口重新启动后做真实文件对话框往返，不以纯函数测试替代。

## 示例与层级光圈修订

已重做三级 DiT 示例：Excalifont=5、roughness=1、居中 container 绑定文字、双端+反向箭头绑定；两处 Attention 数学使用真实 KaTeX PNG 并保存 LaTeX 源码。41/41 测试通过；typecheck/build 通过。隔离 profile、9338 端口实际 Electron 测试验证 defaults、进入/回退、缩放光圈与真实鼠标拖块后箭头跟随，证据 artifacts/refinement-smoke.json。示例另存 examples/DiT-绑定与层级演示.papercanvas.json；不覆盖用户 autosave。新图默认不强改旧图元素字体。普通块保留双击文字，可展开块双击进入并新增编辑模块标题。原生箭头仍可悬空，校验项目报告未绑定两块的箭头，尚非全局强制连接工具。

## 公式入口与动画恢复

顶部新增 ƒx LaTeX 公式。公式使用受信 IPC → 隐藏沙箱窗口（内嵌 KaTeX 字体，CSP 禁外部网络）→ PNG；不再依赖 foreignObject SVG。43/43 自动测试、typecheck/build 通过。隔离 profile 9339 实测源码输入/插入/重开、同层光圈多个中间位置、进入与返回 WAAPI 300ms keyframes，证据 artifacts/motion-formula-smoke.json。不是完整性能基准；尚未覆盖所有 DPI、快速连续中断场景。

## 明确未验收/未完成

原生保存/打开对话框的人工完整往返未测；双击命中在不同 DPI/旋转几何体下未测；公式首次插入后重新打开重编辑未做端到端；独立子文件尚未实现；MCP 暂为 canvas replace，不是细粒度事务命令；无跨图统一撤销、断点、循环、并行、线程箭头编辑器、路线线型、端口与来源 UI；draw.io 对照原型未做；MCP 尚未注册到 Hermes 配置。

不要把本轮 smoke pass 当作产品完成。截图在 artifacts/，自动化可能在样例中插入测试公式，首次用户试用可点击示例重载。
