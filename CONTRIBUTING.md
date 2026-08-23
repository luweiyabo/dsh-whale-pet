# 贡献指南

感谢你为 dsh-whale-pet 提交改进。

## 提交问题

- Bug 请使用仓库的 Bug 模板，并提供 DSH、Node.js 和插件版本。
- 功能建议请说明使用场景、预期行为和可能的替代方案。
- 未修复的安全问题请按照 [SECURITY.md](./SECURITY.md) 私密报告。

## 本地开发

```sh
git clone https://github.com/luweiyabo/dsh-whale-pet.git
cd dsh-whale-pet
npm ci
dsh plugin --profile web add .
dsh web
```

同一 Web profile 只能保留 npm、GitHub 或本地源码中的一种安装来源。

## 提交前检查

```sh
npm run check
npm test
npm pack --dry-run
```

请确保：

- 不提交 API Key、Token、私有配置、日志或本地虚拟环境。
- 新增或变更行为包含对应测试。
- 中文 README 与英文 README 中的产品信息保持一致。
- 新增媒体资源具有明确来源和可再分发授权，并同步更新第三方资源说明。

## Pull Request

保持每个 PR 聚焦于一个主题，在描述中写明变更原因、验证方式和界面变化。涉及视觉效果时请附截图或短视频。

---

English contributions are welcome. Please keep each pull request focused, describe the motivation and verification steps, run all release checks, and privately report security issues through the process in [SECURITY.md](./SECURITY.md).
