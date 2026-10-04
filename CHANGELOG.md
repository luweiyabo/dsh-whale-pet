# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.3] - 2026-10-03

### 新增

- 适配 DSH `0.1.2-rc.1` 的配置 RPC、`remote.session` 会话事件、模型投影以及审批与问答等待状态。
- 断线重连时从权威快照恢复当前状态，同时避免将历史事件作为新事件触发规则。
- 新增对 DSH `0.2.0-rc.2` 的支持：设置读写改走 typert Remote 子服务 `remote.settings`，会话活动改由 `uiSession.sessionStatus` / `uiSession.current` / `remote.session` 提供，设置页适配官方插件页（`plugins.row.config`），模型流式输出经 `assistant-stream` 归一化处理。

### 改进

- 保留旧版 `connection.api` 降级路径。
- 补充新版宿主适配层的配置、模型、事件、交互状态和重连契约测试。
- 明确 DSH `0.1.3-alpha.1` 尚未验证，不在当前兼容范围内。
- 保留 DSH `0.1.x` 兼容：按运行时特性探测在旧/新宿主间分流，`0.1.x` 与 `0.2.0` 行为一致；兼容范围扩展为 `^0.1.0-rc.6 || ^0.1.2-rc.1 || ^0.2.0-rc.2`，插件版本仍在 `0.1.x`。

## [0.1.2] - 2026-08-26

### 新增

- 新增桌宠交互特效层，补充更明显的互动反馈。
- 新增“变成球”动作及其公开资源，补充对应视频与展示素材。

### 修复

- 修复惯性甩动时与双击蓝鲸动画、挤压形变类名和悬停呼吸效果相关的交互问题。
- 调整光标倾斜跟随的触发范围，减少误触发。
- 修复“减少动态效果”场景下的特效与自主行为表现。
- 优化气泡从尾部浮现的表现，并细化甩动碰撞与回弹体验。

### 改进

- 刷新 `0.1.2` 对应的公开资产、截图与文档说明。
- 统一 README 与许可说明中的文档链接、MIT 标识和第三方资源说明。
- 统一代码缩进、Prettier 约束与注释风格。

## [0.1.1] - 2026-08-23

### 修复

- 将浏览器端 ModuleLoader 注册 ID 与 npm 包名 `@luweiyabo/dsh-whale-pet` 对齐，修复 scoped npm 安装后的客户端加载失败。
- 为自定义动作资源接口补充同源与本机访问控制。
- 统一宿主端、客户端和 bundle patch 中的插件标识。

### 改进

- 新增发布契约测试、语法检查和 npm 发布前自动校验。
- 将测试输出统一为中文。
- 完善中英文 README、安装来源冲突说明和 GitHub Raw 图片地址。
- 分离中英文第三方资源许可说明，明确代码与动画资源采用不同授权条款。

## [0.1.0] - 2026-08-23

- 首次 npm 发布。
- 提供 94 个分类动画、Agent 状态感知、点击与拖拽交互、屏幕漫游、自定义动作、触发规则和余额气泡。
- 已知问题：scoped npm 包安装后，浏览器端模块注册名不匹配；已在 `0.1.1` 修复。

[0.1.2]: https://github.com/luweiyabo/dsh-whale-pet/releases/tag/v0.1.2
[0.1.3]: https://github.com/luweiyabo/dsh-whale-pet/releases/tag/v0.1.3
[0.1.1]: https://github.com/luweiyabo/dsh-whale-pet/releases/tag/v0.1.1
[0.1.0]: https://www.npmjs.com/package/@luweiyabo/dsh-whale-pet/v/0.1.0
