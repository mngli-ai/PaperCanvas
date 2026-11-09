# 文件树交互核对

只读检查本机 Obsidian 1.15.0 asar 中 app.js/app.css，观察到父 folder 包含 children 容器、折叠状态、单独 title 节点、选中节点决定新文件夹父目录。仅参考结构与行为，没有复制闭源实现。Obsidian 主应用非开源，免费使用不等于开源，官方许可证 https://obsidian.md/license。

PaperCanvas 自行实现递归 CanvasTree 与工作区树，18px 每级缩进、折叠箭头、选中态。旧 shell padding!important 会覆盖行内 paddingLeft，改用 CSS 自定义深度配合局部规则。文件单击打开使用受信 workspaceOpen，创建目录受工作区边界检查。切换前将当前工程完整快照写入 papercanvas.before-file-open，以防未保存内容丢失。
