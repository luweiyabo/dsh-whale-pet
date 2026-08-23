# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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

[0.1.1]: https://github.com/luweiyabo/dsh-whale-pet/releases/tag/v0.1.1
[0.1.0]: https://www.npmjs.com/package/@luweiyabo/dsh-whale-pet/v/0.1.0
