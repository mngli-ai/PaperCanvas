# 本轮用户修改要求

- 默认 Excalifont，中间档 roughness=1。
- 节点文字居中且 containerId/boundElements 真绑定，避免独立文字跟不上块。
- 所有示例箭头起终点真绑定，拖块验证，不接受只靠近边缘。
- 数学表达式保留 LaTeX 源码；示例使用 renderer prepareDemoProject 生成公式 image。
- 普通块双击文字，展开块双击进子图并有标题编辑入口。
- 层级切换先清旧高亮，loadedCanvas 与 frame 一致后按当前 viewport 算新高亮，覆盖往返/缩放测试。
- 重做示例但不覆盖用户自动保存/项目，已有项目要明确点示例重新载入。

放弃旧方法及原因：自由漂浮文本/无绑定箭头仅视觉正确，拖动即散；Unicode 伪公式不可按 LaTeX 改；只按 runner 改光圈会在载图尚未提交时读旧图坐标。
