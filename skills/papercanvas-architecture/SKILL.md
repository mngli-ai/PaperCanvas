---
name: papercanvas-architecture
description: Use when drawing layered architectures in PaperCanvas.
---

# PaperCanvas 多层架构绘图

## 用途与边界
把系统、模型或软件流程拆成可双击进入的多层画布，输出 `.papercanvas.json` 工程。适用于从零创建独立示意图；不是论文精确复现或真实计算结果。不要把普通分组冒充子画布。

修改现有工程时先备份，读取原工程并保留手工位置、ID、公式源和资源。此生成器只用于新工程，不可用生成结果覆盖用户正在编辑的工程。不要自动连接默认 MCP 桥或自动写入当前画布。需要在线编辑时，先核对 MCP inspect 的项目身份，增量提交并使用 expectedRevision；不得自行猜接口。

## 环境
只需 Node.js（建议24），无 npm install。脚本相对于本 skill 目录。输出工程可在 PaperCanvas 的文件浏览器单击打开，或拖入当前画布复制为模块。导入不是实时引用；不要重复拖入制造副本。

仓库中的隔离窗口验证方法见 [references/gui-validation.md](references/gui-validation.md)。图形文本位置依赖字体的真实度量，check 的保守估算不能代替截图检查。

## 操作流程
1. 先写清各层职责和数据流。默认总览→子系统→内部机制至少三级，确实无需展开的叶子不创建空子画布。节点名直白，示意内容显式标注，不编造论文结论。
2. 新建声明式 spec JSON：
   - `title`：工程名；`root`：根画布ID。
   - `canvases`：数组，每项 `{id,title,nodes,edges?,route?}`。
   - `nodes`：数组，每项 `{id,label,child?,detail?}`。`child` 指另一画布 ID，构成无环层级。
   - `edges`：节点ID二元数组，例如 `[["input","encoder"],["encoder","output"]]`。省略时按节点顺序串联。
   - `route`：明确的节点ID序列，例如 `["input","encoder","output"]`。箭头不是执行顺序；模块步骤进入 child 的演示路线。
3. 执行 `node <skill目录>/scripts/build.mjs <spec.json> <新文件.papercanvas.json>`。默认拒绝覆盖已有文件，不绕过保护。
4. 执行 `node <skill目录>/scripts/check.mjs <新文件.papercanvas.json>`。非零退出必须修复，不把输出成功当成验证通过。报告画布数、层级深度、模块和路线数量。
5. 如果有可用 PaperCanvas，使用独立测试 profile 打开产物，不重载/关闭用户窗口。不允许仅凭 JSON 校验宣称视觉通过。核对每层标题、标签换行、箭头、模块进入/返回、路线逐步进入；无 GUI 时明确只通过结构检查。
6. 交付工程文件路径、验证输出、示意假设与剩余限制。用户应能直接打开并看到多层结构。

## 图形约束
- 先检查包内 `scripts/build.mjs` 与 `scripts/check.mjs` 都存在；缺失是安装包不完整，应停止并报告，不能自写替代品冒充 skill 通过。
- `child` 层级必须无环，但 `edges` 数据流可以有反馈环；`route` 是讲解顺序，不要求相邻步骤有数据流边。每个画布有一条默认讲解路线，模块步骤的 childCanvasId/childRouteId 指向其子路线；运行时“单步进入”进入子路线，结束后返回父路线，“逐过程”跳过展开。
- spec 的节点 ID 在所属画布内唯一，画布 ID 全局唯一；生成器负责最终元素 ID 命名空间。统计分别报告 child模块数、画布路线数和路线步骤数。
- 新节点 Excalifont=5，roughness=1，标签水平居中；容器与文字双向绑定。
- 箭头两端绑定真实节点，节点反向 boundElements 完整，不能用直线伪装绑定箭头。
- 每个子画布需有可见的父模块，不建孤儿；ID唯一，根节点不可回指形成环。
- 长标题及中文换行必须检查，不靠缩到不可读字号解决。detail 是补充说明，不支持富文本/LaTeX渲染承诺。
- 公式必须走 PaperCanvas 的公式渲染接口生成真实资产并保留 LaTeX 源；不要把美元分隔符文本冒充渲染后的公式。

## 反馈迭代
记录每轮输入、真实命令、失败点和修复，回调本 skill 或脚本后换一个架构复测。至少一轮压力输入包含中文长标题、分支数据流和三级以上深度。不能只重复同一个简单链条。

### 已验证的阅读性边界
当前自动布局是纵向教学管线，不会自动把并行节点排成同一行。存在双源输入或并行分支时，label 需要显式写“问题输入”“资料输入”“并行分支A”等职责，不要让纵向位置暗示不存在的箭头关系。若确需论文级并列布局，先生成后增量手调，不宣称自动排版达到该要求。

中文长词组建议在 spec label 中用 `\n` 主动按语义断行，尤其不要把“切块”“证据”等词拆开。长标题避免一口气塞满屏幕；GUI fitToViewport 可能让顶部标题贴近 Excalidraw 的操作提示，验收截图时应轻微缩小或平移留出顶部安全区。长跳跃边走左侧独立通道，通道相近仍需人工核对；当前版本不提供边标签或总线语义，不要假装已经表达。
