# PaperCanvas Architecture Skill

可分发的多层架构绘图 skill，Node.js 24 推荐，不需要 npm install。不是 PaperCanvas 安装包。

## 内容
- `papercanvas-architecture/SKILL.md`：代理操作约束、输入协议与检查流程。
- `scripts/build.mjs`：声明式 spec → 可编辑的多层 PaperCanvas 工程。
- `scripts/check.mjs`：针对本生成器图元子集的结构、绑定、几何与路线检查。
- `examples/`：实际代理试用产生的 spec 与工程。
- `references/`：隔离 GUI 验证方法与多轮测试记录。

## 安装
将整个 `papercanvas-architecture` 文件夹复制到当前 Hermes profile 的 `skills/` 下，保留 scripts/references/examples。通过 `skill_view(name='papercanvas-architecture')` 或 `/papercanvas-architecture` 使用。不要只复制 SKILL.md，也不要安装到别的 profile。Windows 本机默认数据目录为 `%LOCALAPPDATA%/hermes/skills/`；其他机器以 `hermes` 实际 HERMES_HOME 为准。

通用 agent 也可直接读取 SKILL.md，并执行随包 Node 脚本。

## 最小命令
`node scripts/build.mjs examples/image-generation.spec.json new.papercanvas.json`

`node scripts/check.mjs new.papercanvas.json`

在 PaperCanvas 工作区中打开生成文件，或拖入当前工程复制成一个可展开模块。默认拒绝覆盖，不修改用户正在编辑的工程。

## 限制
生成器是受控纵向布局，不是任意手绘内容的无损编排器；没有自动调用论文、图像或公式服务。所有示例为机制示意，不能当作论文精确复现。修改现有图应走备份后的增量编辑，不能重建覆盖。
