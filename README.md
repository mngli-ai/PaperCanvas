# PaperCanvas — 论文架构编辑器（技术预览）

独立 Electron 应用，Excalidraw 自由画布 + 递归模块 + LaTeX + 显式演示路线。由 Hermes 与继承 gpt-6.1-sol @ momo2 的内置子智能体开发，不走 lwl。示例仅是 DiT 概念示意，不是精确论文结构，也不执行神经网络计算。

## 启动

克隆后需要 Node.js 24（测试使用内置 TypeScript stripping）与 npm：

```bash
npm ci
npm run build
```

然后双击 `启动-PaperCanvas.bat`。开发用 `npm run dev`。当前是源码技术预览，不是已签名安装包。

## 使用

- 直接使用原画板编辑形状、箭头、文字和样式。
- 选中矩形/菱形/椭圆，点击“将选中形状变为模块”，命名后双击进入。角度旋转后的命中与复杂分组还需专项验收。
- 左侧切换画布，顶部面包屑返回。
- 顶部 **ƒx LaTeX 公式** 打开源码输入与实时预览；确认后由桌面安全渲染服务生成 PNG 插入画布。选中已有公式再点击同一按钮，可重新编辑源码。
- 同层运行光圈平滑移动；模块进入/返回使用 300ms 缩放与淡入淡出，系统减少动态效果设置下关闭动画。
- 右侧路线可命名、改颜色、将选中图元按顺序加入步骤。子模块有路线时自动绑定其第一条；精细选择子路线界面待做。
- 单步进入 / 逐过程 / 跳出 / 上一步 / 连续播放仅演示显式步骤，不计算张量。
- 保存项目把全部子画布、公式资源和路线写入 JSON。自动恢复为辅助，不替代主动保存。每个子画布独立文件化待完成。

## MCP

适配器：node scripts/mcp-server.mjs。应用启动时将临时端口与凭据保存到系统用户数据目录 paper-canvas/bridge.json，客户端每次请求重读，退出删除。不要把凭据写进报告或提交。

支持 inspect / read_canvas / apply_canvas / validate / runner_state。apply_canvas 为带 expectedRevision 的整画布替换，需先读取并保留用户布局；不是最终的语义 patch API。当前未自动配置 Hermes MCP，不修改现有 Hermes 配置。

## 文件、素材与侧栏

首次启动先选择仓库所在目录或普通文件夹，工作区仅浏览本地目录，不自动克隆 Git 仓库；以后恢复上次选择。左侧上半部是当前工程的画布层级，下半部统一浏览工作区文件和素材；可逐级展开，双击项目文件打开，拖到画布则导入为可展开模块。支持 PaperCanvas JSON、.excalidraw；.excalidrawlib 载入素材列表。导入为独立副本，包含源工程层级与演示路线，不实时链接源文件。左右侧栏可各自收起，边缘按钮重新展开，状态本地保存。模块与公式入口已合入 Excalidraw 原生顶部工具条。右侧提供“属性编辑”和“运行演示”页签；属性区停靠 Excalidraw 原生编辑控件。

## 验收

- npm run typecheck
- npm test：领域、运行器、鉴权桥自动测试。
- npm run build
- 应用以 --remote-debugging-port=9337 启动后，node scripts/ui-smoke.mjs 验实际窗口公式、进入子层和回退；node scripts/mcp-smoke.mjs 验真实 stdio 到窗口的读写与版本冲突。
- artifacts/ 保存真实界面与测试证据。测试后原项目示意可从“示例”恢复。

## 明确未完成

draw.io 对照实测、独立子文件格式、端口与论文来源编辑 UI、循环分支、断点、线程线型、语义 patch/事务撤销/幂等、Agent 渲染工具、完整跨画布撤销与关闭未保存提示、独立安装包。以上不能按“已有完整功能”宣传。

## 依赖与借鉴

直接依赖 Excalidraw MIT，公式采用 KaTeX。draw.io 展示覆盖与 Simulink 的进入/逐过程/跳出作为交互参考。当前未复制社区 MCP 项目源码；桥接为本项目实现。没有复制 tldraw、Simulink 商业源码，也没有使用 Obsidian Excalidraw AGPL 源码。正式分发需生成完整第三方声明。
