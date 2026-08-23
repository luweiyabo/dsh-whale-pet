/**
 * ============================================================================
 * dsh-whale-pet 浏览器半侧（browser half）—— 桌宠的"前端"部分
 * ============================================================================
 *
 * 【这个文件是什么】
 *   本文件是宠物在浏览器里运行的代码：
 *   1. 以 DSH 规定的"客户端 bundle 形态"注册自己（window.__ModuleLoader__.load）
 *   2. 把宠物组件挂到 DSH 界面的 `shell.overlay` 槽位（右下角浮动层）
 *   3. 负责宠物的全部视觉与交互：双缓冲动画播放、随机行为链、点击/拖拽、屏幕漫游
 *
 * 【浏览器插件格式（重要背景）】
 *   DSH 的浏览器插件必须是一个特殊格式的 JS 文件：
 *   - 用 window.__ModuleLoader__.load({ id, factory }) 注册
 *   - factory 接收一个同步 require，用它拿 React 和 DSH 提供的模块
 *   - 不能自己打包 React（React 由 DSH 外壳提供，直接 require）
 *   - CSS 以字符串形式内联注入 <style> 标签
 *
 * 【动画文件从哪来】
 *   动画视频通过 /whale-pet/<动画名>.webm 加载——这个路由由宿主半侧
 *   （lib/index.js）提供，把 assets/thumb/ 下的 WebM 文件发给浏览器。
 *
 * ============================================================================
 */
window.__ModuleLoader__.load({
	// 插件唯一 ID，必须与 package.json 的 name 一致
	id: '@luweiyabo/dsh-whale-pet',

	// factory：浏览器加载本 bundle 时执行，返回插件导出
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		// ---- 从 DSH 外壳拿 React（不能自己打包） ----
		var react = require('react');
		var { useState, useEffect, useRef, useCallback } = react;
		// h = React.createElement：语义为 (type, props, ...children)——
		// 代码中大量 h(el, props, text) 与 props 内 key 的写法依赖 createElement
		// 语义；jsx-runtime 的 jsx(type, config, maybeKey) 会把第三参当 key
		// 导致文本丢失，故不用 jsx 别名。
		var h = react.createElement;
		// ============================================================================
		// 内联 CSS —— 注入一次（官方插件标准做法）
		// ============================================================================
		var css = [
			// 根容器：fixed 固定定位、层级 40（界面之上）、整体点击穿透、禁止选中
			'.wp-root{position:fixed;z-index:40;pointer-events:none;user-select:none}',
			// 默认角落：右下 / 左下
			'.wp-root[data-corner="bottom-right"]{right:24px;bottom:0}',
			'.wp-root[data-corner="bottom-left"]{left:24px;bottom:0}',
			'.wp-root[data-corner=top-right]{right:24px;top:0}',
			'.wp-root[data-corner=top-left]{left:24px;top:0}',
			// 舞台：16:9（--wp-size 为宽度，默认 462px ≈ 高 260px），本身不响应鼠标
			'.wp-stage{position:relative;width:var(--wp-size,462px);height:calc(var(--wp-size,462px)*9/16);pointer-events:none}',
			// 视频：铺满舞台、保持比例，pointer-events:none 完全穿透——
			// 交互统一由覆盖 HIT_BOX 区域的 .wp-hit 层负责，透明区域点击直达下层 UI
			'.wp-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;opacity:0;transition:opacity .18s ease;transform-origin:center}',
			// 显示中的视频（is-front 类）
			'.wp-video.is-front{opacity:1}',
			// 命中层：覆盖人物区域（HIT_BOX），唯一可交互区域；光标跟随 + 拖拽抓取
			'.wp-hit{position:absolute;pointer-events:auto;cursor:default;z-index:1}',
			'.wp-hit.dragging{cursor:grabbing}',
			// 选中态（左键单击宠物进入"目标移动"模式）：命中层画虚线高亮圈
			'.wp-root.wp-selected .wp-hit{outline:2px dashed var(--dsw-alias-brand-primary);outline-offset:3px;border-radius:8px}',
			// 无障碍：用户系统开启"减少动态效果"时关闭过渡动画
			'@media (prefers-reduced-motion: reduce){.wp-video{transition:none}}',
			// ===== 设置卡片（wp-sf-*）—— 复刻官方插件卡片视觉（同款 --dsw-alias-* token） =====
			// 卡片容器：边框/圆角/背景 + 展开态（对齐官方 PluginCard）
			'.wp-sf-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}',
			'.wp-sf-card:hover{border-color:var(--dsw-alias-label-dimmed)}',
			'.wp-sf-cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}',
			// 折叠头部：标题 + 描述 + 状态徽章 + 箭头
			'.wp-sf-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}',
			'.wp-sf-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
			'.wp-sf-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}',
			'.wp-sf-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}',
			'.wp-sf-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}',
			'.wp-sf-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s;display:block}',
			'.wp-sf-chevronOpen{transform:rotate(180deg)}',
			'.wp-sf-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}',
			'.wp-sf-badgeOk{white-space:nowrap;color:var(--dsw-alias-label-tertiary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;line-height:17px}',
			// 展开体：分区标题 + 字段行 + 底部操作
			'.wp-sf-body{border-top:1px solid var(--dsw-alias-border-l2);padding:16px;display:flex;flex-direction:column}',
			'.wp-sf-section{margin:12px 0 0;padding:13px 0 9px;border-top:1px solid var(--dsw-alias-border-l2);font-size:13px;font-weight:600;line-height:1.5;color:var(--dsw-alias-label-primary)}',
			// 字段行（紧凑：label 左 + 控件右，同行）；提示信息常显在 label 下方
			'.wp-sf-field{flex-direction:row;align-items:flex-start;gap:12px;padding:10px 0;display:flex}',
			'.wp-sf-fieldIntent{align-items:center}.wp-sf-fieldIntent .wp-sf-label{padding-top:0}',
			'.wp-sf-field+.wp-sf-field{border-top:1px solid var(--dsw-alias-border-l2)}',
			'.wp-sf-label{min-width:0;color:var(--dsw-alias-label-primary);flex:0 0 120px;font-size:13px;font-weight:500;line-height:1.5;padding-top:3px}',
			'.wp-sf-fieldHint{display:block;margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:400;line-height:1.45}',
			'.wp-sf-control{flex:1;min-width:0}',
			// 参数组合行：一行多个 label+控件 小组
			'.wp-sf-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px 20px;padding:10px 0}',
			'.wp-sf-row+.wp-sf-row{border-top:1px solid var(--dsw-alias-border-l2)}',
			'.wp-sf-inline{display:flex;align-items:center;justify-content:flex-start;gap:8px;min-width:0;font-size:13px;color:var(--dsw-alias-label-primary);white-space:nowrap}',
			'.wp-sf-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}',
			'.wp-sf-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}',
			'.wp-sf-input[type=number]{height:34px;width:96px}',
			'.wp-sf-inline .wp-sf-input[type=number]{width:76px}',
			'.wp-sf-input[multiple]{height:auto;min-height:56px;padding:6px 8px}',
			'.wp-sf-select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;height:34px;padding:0 8px;font-size:13px}',
			'.wp-sf-select:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}',
			'.wp-sf-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;margin-top:12px;padding:12px 0 0;display:flex}',
			'.wp-sf-error{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}',
			// 动作选择器：chips 标签 + 搜索浮层（替代 <select multiple> 的空白行与超长高度）
			'.wp-sf-pickerWrap{position:relative}',
			'.wp-sf-icon{display:block}',
			'.wp-sf-chips{flex-wrap:wrap;gap:6px;display:flex;align-items:center}',
			'.wp-sf-chip{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);border-radius:999px;padding:2px 8px 2px 10px;font-size:12px;line-height:18px;display:inline-flex;align-items:center;gap:6px}',
			'.wp-sf-chipX{appearance:none;border:0;background:0 0;cursor:pointer;color:var(--dsw-alias-label-tertiary);padding:2px;display:inline-flex;align-items:center;justify-content:center}',
			'.wp-sf-chipX:hover{color:var(--dsw-alias-label-error)}',
			'.wp-sf-add{appearance:none;font:inherit;cursor:pointer;border:1px dashed var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0;border-radius:999px;padding:2px 12px;font-size:12px;line-height:18px;display:inline-flex;align-items:center;gap:4px}',
			'.wp-sf-add:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}',
			'.wp-sf-picker{position:absolute;left:0;top:calc(100% + 4px);z-index:60;width:100%;max-width:340px;box-sizing:border-box;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:8px}',
			'.wp-sf-picker{transform-origin:top left;animation:wpDropdownIn .16s ease-out}',
			'@keyframes wpDropdownIn{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}',
			'.wp-sf-pickerSearch{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 10px;font-size:13px;margin-bottom:6px}',
			'.wp-sf-pickerSearch:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}',
			// 分类 tab：小号 pill 按钮，active 高亮
			'.wp-sf-cats{flex-wrap:wrap;gap:4px;margin-bottom:6px;display:flex}',
			'.wp-sf-cat{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-secondary);border-radius:999px;padding:2px 10px;font-size:12px;line-height:18px}',
			'.wp-sf-cat:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}',
			'.wp-sf-catOn{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}',
			'.wp-sf-checkbox{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary);cursor:pointer;margin:0}',
			// 云朵气泡：单一柔和轮廓贴近人物头部；圆点尾巴指向宠物
			'.wp-bubble{position:absolute;left:50%;bottom:86%;transform:translateX(-50%);z-index:41;box-sizing:border-box;min-width:104px;max-width:240px;min-height:50px;color:var(--dsw-alias-label-primary);padding:14px 30px 14px 22px;font-size:13px;line-height:1.5;text-align:center;pointer-events:none;isolation:isolate;animation:wpBubble 3.6s ease forwards}',
			'.wp-bubbleCloud{position:absolute;inset:-12px -22px -8px -14px;width:calc(100% + 36px);height:calc(100% + 20px);z-index:-1;overflow:visible;filter:drop-shadow(0 5px 7px rgba(0,0,0,.14))}',
			'.wp-bubbleText{position:relative;z-index:1}',
			'.wp-bubble::after{content:"";position:absolute;left:57%;bottom:-9px;width:8px;height:8px;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:50%;box-shadow:-8px 9px 0 -2px var(--dsw-alias-bg-layer-3);pointer-events:none}',
			'.wp-root[data-corner=top-right] .wp-bubble,.wp-root[data-corner=top-left] .wp-bubble{top:92%;bottom:auto}',
			'.wp-root[data-corner=top-right] .wp-bubble::after,.wp-root[data-corner=top-left] .wp-bubble::after{top:-9px;bottom:auto;box-shadow:-8px -9px 0 -2px var(--dsw-alias-bg-layer-3)}',
			// 常驻气泡（额度）：不播放淡出动画，始终保持可见
			'.wp-bubble-sticky{animation:none}',
			// ===== 右键菜单：fixed 定位浮层，独立于舞台可点击 =====
			'.wp-menu{position:fixed;z-index:45;pointer-events:auto;min-width:150px;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:4px;display:flex;flex-direction:column}',
			'.wp-menuItem{appearance:none;font:inherit;cursor:pointer;text-align:left;background:0 0;border:0;border-radius:7px;padding:7px 12px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}',
			'.wp-menuItem:hover{background:var(--dsw-alias-bg-module-platform)}',
			'.wp-menuItem:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
			// ===== 自定义动作区：目录路径 + 刷新按钮 + 规格/计数提示 =====
			'.wp-sf-customDir{display:flex;align-items:center;gap:8px;min-width:0}',
			'.wp-sf-customPath{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}',
			'.wp-sf-customHint{margin:4px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}',
			'.wp-sf-fileInput{display:none}',
			'.wp-sf-uploadStatus{margin:5px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}',
			'.wp-sf-uploadError{color:var(--dsw-alias-label-error)}',
			'.wp-sf-customList{display:flex;flex-direction:column;gap:4px;margin-top:8px}',
			'.wp-sf-customItem{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;color:var(--dsw-alias-label-primary);font-size:12px}',
			'@keyframes wpBubble{0%{opacity:0;transform:translateX(-50%) translateY(4px)}8%{opacity:1;transform:translateX(-50%) translateY(0)}90%{opacity:1}100%{opacity:0}}',
			'@media (prefers-reduced-motion: reduce){.wp-bubble{animation:none}}',
			'.wp-sf-pickerList{max-height:220px;overflow:auto;display:flex;flex-direction:column;gap:1px}',
			'.wp-sf-pickerEntry{display:flex;flex-direction:column}',
			'.wp-sf-pickerRow{display:flex;align-items:center;gap:2px}',
			'.wp-sf-previewBtn{appearance:none;border:0;background:0 0;cursor:pointer;color:var(--dsw-alias-label-tertiary);line-height:1;padding:6px;border-radius:6px;flex:none;display:inline-flex;align-items:center;justify-content:center}',
			'.wp-sf-previewBtn:hover{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-module-platform)}',
			'.wp-sf-pickerItem{appearance:none;border:0;background:0 0;font:inherit;text-align:left;cursor:pointer;color:var(--dsw-alias-label-primary);border-radius:6px;padding:5px 8px;font-size:13px;flex:1;min-width:0}',
			'.wp-sf-pickerItem:hover{background:var(--dsw-alias-bg-module-platform)}',
			// 预览视频：展开在对应条目下方（左缩进对齐条目文字）
			'.wp-sf-previewVideo{width:calc(100% - 30px);margin:2px 0 6px 30px;aspect-ratio:16/9;border-radius:6px;background:#000;display:block}',
			'.wp-sf-pickerItem[data-on=true]{color:var(--dsw-alias-brand-primary);font-weight:500}',
			// ===== 触发规则：列表条目 + 编辑器 =====
			'.wp-rule-item{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:4px}',
			'.wp-rule-item+.wp-rule-item{margin-top:8px}',
			'.wp-rule-head{display:flex;align-items:center;gap:8px;min-width:0}',
			'.wp-rule-name{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.wp-rule-sum{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}',
			'.wp-rule-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}',
			'.wp-rule-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-secondary);border-radius:7px;padding:3px 10px;font-size:12px;line-height:1.5;flex:none;display:inline-flex;align-items:center;justify-content:center;gap:5px}',
			'.wp-rule-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}',
			'.wp-rule-btnDestructive:hover{color:var(--dsw-alias-label-error);border-color:var(--dsw-alias-label-error)}',
			'.wp-rule-editor{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:10px;margin-top:8px}',
			'.wp-rule-editor .wp-sf-row{grid-template-columns:minmax(0,1.5fr) minmax(180px,1fr) auto;align-items:center}',
			'.wp-rule-natural{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;background:var(--dsw-alias-bg-module-platform);border-radius:8px;color:var(--dsw-alias-label-primary);font-size:13px}',
			'.wp-rule-natural .wp-sf-select{width:auto;min-width:180px}.wp-rule-natural .wp-sf-input{width:180px;height:34px}',
			'.wp-rule-advanced{align-self:flex-start}',
			'.wp-rule-actions{border-top:1px solid var(--dsw-alias-border-l2);display:flex;justify-content:flex-end;gap:8px;padding-top:12px}',

			'.wp-rule-tplLabel{flex:0 0 100%;display:block;margin:0 0 2px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}',
			'.wp-rule-condHead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:2px}',
			'.wp-rule-condTitle{position:absolute;left:0;top:7px;margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}',
			'.wp-rule-conditions{position:relative;padding-top:36px}.wp-rule-conditions>.wp-sf-add{position:absolute;right:0;top:0}',
			'.wp-rule-timing{display:grid;grid-template-columns:1fr;align-items:center;gap:10px}.wp-rule-timing .wp-sf-inline{display:grid;grid-template-columns:72px minmax(0,1fr);align-items:center;gap:8px;flex:none}',
			'.wp-rule-cond{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) auto;align-items:center;gap:8px;padding:8px 0}',
			'.wp-rule-cond .wp-sf-select,.wp-rule-cond .wp-sf-input{width:100%;min-width:0;height:34px;box-sizing:border-box}',
			'.wp-rule-tpl{display:flex;flex-wrap:wrap;gap:6px}',

			'.wp-rule-control{display:flex;align-items:center;gap:6px;min-width:0}',
			'.wp-rule-editor .wp-sf-inline .wp-sf-input{height:34px;box-sizing:border-box}',
			'.wp-sf-inline .wp-sf-select{width:96px;height:34px;box-sizing:border-box}',
			'.wp-rule-control{width:100%}.wp-rule-control .wp-sf-input,.wp-rule-control .wp-sf-select{width:100%;height:34px;box-sizing:border-box}',
			'.wp-rule-controlUnit{display:flex;align-items:center;gap:6px;min-width:0}',
			'.wp-rule-controlUnit .wp-sf-input{width:96px;height:34px;box-sizing:border-box}',
			'.wp-rule-unit{color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}',
			'.wp-rule-prio{accent-color:var(--dsw-alias-brand-primary)}',
			'.wp-rule-error{color:var(--dsw-alias-label-error);font-size:12px;line-height:1.5;margin:0}',
			'@media (max-width:640px){.wp-sf-body{padding:12px}.wp-sf-field{flex-direction:column;gap:6px}.wp-sf-fieldIntent{align-items:stretch}.wp-sf-label{flex:auto;padding-top:0}.wp-sf-row{grid-template-columns:1fr}.wp-sf-inline{white-space:normal}.wp-rule-timing{grid-template-columns:1fr}.wp-sf-picker{position:fixed;left:12px;right:12px;top:auto;bottom:12px;width:auto;max-width:none}.wp-rule-editor .wp-sf-row,.wp-rule-cond{grid-template-columns:1fr}.wp-rule-cond .wp-sf-select,.wp-rule-cond .wp-sf-input{min-width:100%}}',
			// ===== 设置界面 V2：分区卡片、统一字段节奏、整行活跃程度、摘要式规则 =====
			'.wp-sf-card{overflow:hidden}.wp-sf-cardOpen{overflow:visible;background:var(--dsw-alias-bg-layer-2)}',
			'.wp-sf-body{gap:14px;padding:18px;background:var(--dsw-alias-bg-layer-2)}',
			'.wp-sf-panel{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);padding:16px;min-width:0}',
			'.wp-sf-sectionHead{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px}',
			'.wp-sf-section{margin:0;padding:0;border:0;font-size:14px;line-height:1.4}',
			'.wp-sf-sectionHint{max-width:58%;margin:1px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;text-align:right}',
			'.wp-sf-fieldGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.wp-sf-fieldGridPools{grid-template-columns:1fr}',
			'.wp-sf-field{display:flex;flex-direction:column;align-items:stretch;gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);min-width:0}',
			'.wp-sf-field+.wp-sf-field{border-top:1px solid var(--dsw-alias-border-l2)}.wp-sf-fieldIntent{align-items:stretch}.wp-sf-fieldIntent .wp-sf-label{padding-top:0}',
			'.wp-sf-label{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex:auto;padding:0;font-size:13px}.wp-sf-fieldHint{display:inline;margin:0;font-size:11px;text-align:right}',
			'.wp-sf-control,.wp-sf-pickerWrap{width:100%;min-width:0}.wp-sf-chips{min-height:40px;box-sizing:border-box;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3)}',
			'.wp-sf-add{min-height:28px;border-radius:7px;padding:3px 10px}.wp-sf-chips>.wp-sf-add{border:0;padding-left:6px;padding-right:6px}',
			'.wp-sf-input,.wp-sf-select{box-sizing:border-box;width:100%;height:38px;background:var(--dsw-alias-bg-layer-3)}.wp-sf-input[type=number],.wp-sf-inline .wp-sf-input[type=number]{width:100%;height:38px}',
			'.wp-sf-toggleGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:12px}',
			'.wp-sf-toggleItem{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;box-sizing:border-box;min-height:88px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);cursor:pointer}',
			'.wp-sf-toggleItem>.wp-sf-checkbox{flex:none;margin-top:2px}.wp-sf-toggleText{display:flex;flex-direction:column;gap:4px;min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500}.wp-sf-toggleTitle{white-space:nowrap;line-height:1.5}.wp-sf-toggleHint{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:400;line-height:1.45}',
			'.wp-sf-settingGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:12px}',
			'.wp-sf-settingItem{display:grid;grid-template-rows:minmax(46px,auto) 38px;gap:8px;box-sizing:border-box;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;min-width:0}',
			'.wp-sf-settingLabel{display:flex;flex-direction:column;align-items:flex-start;gap:3px;min-width:0;font-weight:500}.wp-sf-settingTitle{white-space:nowrap;line-height:1.5}.wp-sf-settingHint{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:400;line-height:1.4}',
			'.wp-sf-activityRow{display:grid;grid-template-columns:minmax(160px,.7fr) minmax(280px,1.3fr);align-items:center;gap:18px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}',
			'.wp-sf-activityText{display:flex;flex-direction:column;gap:3px;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500}.wp-sf-segments{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-module-platform)}',
			'.wp-sf-segment{appearance:none;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:20px;padding:6px 10px;cursor:pointer}.wp-sf-segment:hover{color:var(--dsw-alias-label-primary)}',
			'.wp-sf-segment[aria-pressed=true]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:0 1px 4px rgba(0,0,0,.12)}',
			'.wp-sf-segment:focus-visible,.wp-rule-btn:focus-visible,.wp-sf-add:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.wp-sf-toggleItem:focus-within{border-color:var(--dsw-alias-brand-primary)}',
			'.wp-sf-customField{background:var(--dsw-alias-bg-layer-2)}.wp-sf-customPath{padding:0 8px}.wp-rule-cond>input:nth-last-child(2){grid-column:1/-2}',
			'.wp-rule-list{display:flex;flex-direction:column;gap:10px}.wp-rule-item{padding:0;gap:0;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}.wp-rule-item+.wp-rule-item{margin-top:0}',
			'.wp-rule-head{padding:13px 14px}.wp-rule-titleBlock{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}.wp-rule-name{flex:none}.wp-rule-sum{padding:0 14px 13px}.wp-rule-meta{padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3)}',
			'.wp-rule-meta .wp-rule-btn{margin-left:auto}.wp-rule-add{align-self:flex-start;margin-top:2px}.wp-rule-editor{position:relative;margin:0;padding:0;gap:0;overflow:visible;background:var(--dsw-alias-bg-layer-2)}',
			'.wp-rule-editorHead{padding:14px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3)}.wp-rule-editorName{display:flex;flex-direction:column;gap:7px;color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600}',
			'.wp-rule-natural{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);align-items:start;gap:18px;padding:14px;border-radius:0;background:transparent}.wp-rule-natural .wp-sf-select,.wp-rule-natural .wp-sf-input{width:100%;min-width:0;height:38px}',
			'.wp-rule-sentenceGroup{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;gap:10px;min-width:0}.wp-rule-sentenceWord{padding-top:9px;white-space:nowrap}.wp-rule-sentenceControls{display:flex;flex-direction:column;gap:8px;min-width:0}.wp-rule-actionPicker{position:relative;z-index:2;min-width:0}.wp-rule-actionPicker .wp-sf-picker{z-index:100}.wp-rule-missing{padding:0 14px 12px!important}.wp-rule-advanced{align-self:flex-start;margin:0 14px 12px}',
			'.wp-rule-advancedPanel{display:flex;flex-direction:column;gap:14px;padding:14px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3)}.wp-rule-conditions{padding-top:36px}',
			'.wp-rule-cond .wp-sf-select,.wp-rule-cond .wp-sf-input{height:38px}.wp-rule-cond>.wp-rule-btn:last-child{grid-column:4}.wp-rule-timing{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.wp-rule-timing .wp-sf-inline{display:flex;flex-direction:column;align-items:stretch;gap:7px;white-space:normal}.wp-rule-timing .wp-sf-inline:last-child{grid-column:1/-1}',
			'.wp-rule-controlUnit,.wp-rule-control{width:100%}.wp-rule-controlUnit .wp-sf-input{width:100%;height:38px}.wp-rule-priority{display:grid;grid-template-columns:auto minmax(0,1fr) 46px;align-items:center;gap:12px}.wp-rule-priorityLabel{white-space:nowrap}.wp-rule-prio{display:block;width:100%;min-width:0;margin:0}.wp-rule-priorityValue{width:46px;height:38px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary)}',
			'.wp-rule-actions{justify-content:space-between;padding:12px 14px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3)}.wp-rule-actionEnd{display:flex;gap:8px;margin-left:auto}',
			'.wp-rule-btnPrimary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}.wp-rule-btnPrimary:hover{color:#fff;filter:brightness(1.06)}.wp-rule-btn:disabled,.wp-sf-add:disabled{cursor:not-allowed;opacity:.45}',
			'.wp-rule-templateBody{padding:14px}.wp-rule-templateActions{display:flex;justify-content:flex-end;padding:12px 14px;border-top:1px solid var(--dsw-alias-border-l2)}',
			'@media (min-width:521px){.wp-rule-actionPicker .wp-sf-picker{left:auto;right:0;width:max(100%,340px);max-width:min(420px,calc(100vw - 48px))}}',
			'@media (max-width:760px){.wp-sf-fieldGrid,.wp-sf-toggleGrid,.wp-sf-settingGrid{grid-template-columns:1fr 1fr}.wp-sf-fieldGridPools{grid-template-columns:1fr}.wp-sf-toggleItem:last-child,.wp-sf-settingItem:last-child{grid-column:1/-1}.wp-sf-activityRow{grid-template-columns:1fr}.wp-rule-natural{grid-template-columns:1fr}.wp-rule-timing{grid-template-columns:1fr 1fr}.wp-rule-timing .wp-sf-inline:last-child{grid-column:1/-1}}',
			'@media (max-width:520px){.wp-sf-body{padding:10px;gap:10px}.wp-sf-panel{padding:12px}.wp-sf-sectionHead{display:block}.wp-sf-sectionHint{max-width:none;margin-top:4px;text-align:left}.wp-sf-fieldGrid,.wp-sf-toggleGrid,.wp-sf-settingGrid{grid-template-columns:1fr}.wp-sf-toggleItem:last-child,.wp-sf-settingItem:last-child{grid-column:auto}.wp-sf-fieldHint{display:block;text-align:left}.wp-sf-label{display:block}.wp-sf-customDir{align-items:stretch;flex-wrap:wrap}.wp-sf-customPath{flex-basis:100%;padding:0}.wp-rule-head{align-items:flex-start;flex-wrap:wrap}.wp-rule-titleBlock{flex-basis:calc(100% - 28px)}.wp-rule-sentenceGroup{grid-template-columns:1fr;gap:5px}.wp-rule-sentenceWord{padding-top:0}.wp-rule-timing{grid-template-columns:1fr}.wp-rule-timing .wp-sf-inline:last-child{grid-column:auto}.wp-rule-cond{grid-template-columns:1fr}.wp-rule-cond>.wp-rule-btn:last-child,.wp-rule-cond>input:nth-last-child(2){grid-column:auto}.wp-rule-priority{grid-template-columns:1fr 46px}.wp-rule-priorityLabel{grid-column:1/-1}.wp-rule-actions{flex-wrap:wrap}.wp-rule-actionEnd{width:100%;margin-left:0}.wp-rule-actionEnd .wp-rule-btn{flex:1}.wp-sf-picker{position:fixed;left:12px;right:12px;top:auto;bottom:12px;width:auto;max-width:none}}',
		].join('\n');
		var cssTag = 'dsh-whale-pet/style.css';
		if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + cssTag + '"]') === null) {
			var tag = document.createElement('style');
			tag.dataset.plugin = 'dsh-whale-pet';
			tag.dataset.pluginCss = cssTag;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		// ============================================================================
		// 动画目录（animation catalog）—— 所有动画的"事实来源"
		// ============================================================================
		// 资源文件：assets/thumb/<语义分类>/<英文 id>.webm（基础分类与日常、工作、节日、
		// 美食、游戏、音乐、魔术、梗图等）。运行时内部与界面动作名均使用英文。
		// 画布几何：thumb 视频是 640×360（16:9）画布，人物"脚底"在 y=330。
		// (360-330)/360 = 8.33%，与母版比例一致——用这个比例做落地对齐，缩放后依然准确。
		var CANVAS_W = 640;
		var CANVAS_H = 360;
		var FEET_Y = 330;

		// 点击/拖拽命中矩形（640×360 像素坐标）。全部动画站立帧 bbox 并集
		// 约为 x:200~440（中心 320）、y:50~335，贴近头顶/脚底。
		var HIT_BOX = { x0: 200, y0: 50, x1: 440, y1: 335 };

		// 动画清单：英文 id（文件名/内部标识）+ 英文名称 + 英文描述 + 语义分类（目录）
		var ANIMS = [
			{ id: 'breathing', name: 'Idle Breathing', description: '10-second idle breathing animation.', nameZh: '待机呼吸休闲', descriptionZh: '10 秒桌宠动作：待机呼吸休闲。', category: 'idle' },
			{ id: 'looking_around', name: 'Looking Around', description: '10-second looking around animation.', nameZh: '东张西望', descriptionZh: '10 秒桌宠动作：东张西望。', category: 'turn' },
			{ id: 'floating_steps', name: 'Floating Steps', description: '10-second floating steps animation.', nameZh: '原地漂浮踏步', descriptionZh: '10 秒桌宠动作：原地漂浮踏步。', category: 'moves' },
			{ id: 'crab_walk', name: 'Crab Walk', description: '10-second crab walk animation.', nameZh: '螃蟹走路', descriptionZh: '10 秒桌宠动作：螃蟹走路。', category: 'moves' },
			{ id: 'running_trip', name: 'Running Trip', description: '10-second running trip animation.', nameZh: '原地左转奔跑摔跤', descriptionZh: '10 秒桌宠动作：原地左转奔跑摔跤。', category: 'moves' },
			{ id: 'target_point_run', name: 'Target Point Run', description: 'Running animation used while moving to a selected screen point.', nameZh: '预备姿势奔跑', descriptionZh: '点击屏幕选择目标点后，奔跑前往目标位置。', category: 'moves' },
			{ id: 'happy_hop', name: 'Happy Hop', description: '10-second happy hop animation.', nameZh: '开心跃动', descriptionZh: '10 秒桌宠动作：开心跃动。', category: 'clicks' },
			{ id: 'shy_surprise', name: 'Shy Surprise', description: '10-second shy surprise animation.', nameZh: '害羞惊讶', descriptionZh: '10 秒桌宠动作：害羞惊讶。', category: 'clicks' },
			{ id: 'tsundere_pout', name: 'Tsundere Pout', description: '10-second tsundere pout animation.', nameZh: '傲娇生气', descriptionZh: '10 秒桌宠动作：傲娇生气。', category: 'clicks' },
			{ id: 'ticklish_giggle', name: 'Ticklish Giggle', description: '10-second ticklish giggle animation.', nameZh: '挠痒咯咯笑', descriptionZh: '10 秒桌宠动作：挠痒咯咯笑。', category: 'clicks' },
			{ id: 'cheerful_wave', name: 'Cheerful Wave', description: '10-second cheerful wave animation.', nameZh: '元气挥手', descriptionZh: '10 秒桌宠动作：元气挥手。', category: 'clicks' },
			{ id: 'arrival_wave', name: 'Arrival Wave', description: 'Greeting animation played after reaching a selected screen point.', nameZh: '原地挥手打招呼', descriptionZh: '到达选定目标位置后，原地挥手打招呼。', category: 'clicks' },
			{ id: 'dragged_in_midair', name: 'Dragged in Midair', description: '10-second dragged in midair animation.', nameZh: '被鼠标拖拽悬空反馈', descriptionZh: '10 秒桌宠动作：被鼠标拖拽悬空反馈。', category: 'drag' },
			{ id: 'maid_curtsy', name: 'Maid Curtsy', description: '10-second maid curtsy animation.', nameZh: '女仆屈膝礼仪', descriptionZh: '10 秒桌宠动作：女仆屈膝礼仪。', category: 'daily' },
			{ id: 'big_stretch', name: 'Big Stretch', description: '10-second big stretch animation.', nameZh: '超大伸懒腰', descriptionZh: '10 秒桌宠动作：超大伸懒腰。', category: 'daily' },
			{ id: 'gentle_spin', name: 'Gentle Spin', description: '10-second gentle spin animation.', nameZh: '小幅度原地旋转展示', descriptionZh: '10 秒桌宠动作：小幅度原地旋转展示。', category: 'daily' },
			{ id: 'sleepy_yawn', name: 'Sleepy Yawn', description: '10-second sleepy yawn animation.', nameZh: '哈欠连天', descriptionZh: '10 秒桌宠动作：哈欠连天。', category: 'daily' },
			{ id: 'quick_nap', name: 'Quick Nap', description: '10-second quick nap animation.', nameZh: '原地小憩沉眠', descriptionZh: '10 秒桌宠动作：原地小憩沉眠。', category: 'daily' },
			{ id: 'startled_awake', name: 'Startled Awake', description: '10-second startled awake animation.', nameZh: '打瞌睡被惊醒', descriptionZh: '10 秒桌宠动作：打瞌睡被惊醒。', category: 'daily' },
			{ id: 'morning_brushing', name: 'Morning Brushing', description: '10-second morning brushing animation.', nameZh: '晨间刷牙', descriptionZh: '10 秒桌宠动作：晨间刷牙。', category: 'daily' },
			{ id: 'mirror_check', name: 'Mirror Check', description: '10-second mirror check animation.', nameZh: '照镜子', descriptionZh: '10 秒桌宠动作：照镜子。', category: 'daily' },
			{ id: 'outfit_color_try_on', name: 'Outfit Color Try-On', description: '10-second outfit color try-on animation.', nameZh: '整体换装试色', descriptionZh: '10 秒桌宠动作：整体换装试色。', category: 'daily' },
			{ id: 'attentive_listening', name: 'Attentive Listening', description: '10-second attentive listening animation.', nameZh: '侧耳倾听', descriptionZh: '10 秒桌宠动作：侧耳认真倾听。', category: 'daily' },
			{ id: 'taking_notes', name: 'Taking Notes', description: '10-second taking notes animation.', nameZh: '轻快记录文字', descriptionZh: '10 秒桌宠动作：轻快记录文字。', category: 'work' },
			{ id: 'coding', name: 'Coding', description: '10-second coding animation.', nameZh: '写代码', descriptionZh: '10 秒桌宠动作：写代码。', category: 'work' },
			{ id: 'deep_thought', name: 'Deep Thought', description: '10-second deep thought animation.', nameZh: '深度思考碎碎念', descriptionZh: '10 秒桌宠动作：深度思考碎碎念。', category: 'work' },
			{ id: 'solving_a_rubiks_cube', name: 'Solving a Rubiks Cube', description: '10-second solving a rubiks cube animation.', nameZh: '专心玩魔方', descriptionZh: '10 秒桌宠动作：专心玩魔方。', category: 'games' },
			{ id: 'playing_with_a_toy_car', name: 'Playing with a Toy Car', description: '10-second playing with a toy car animation.', nameZh: '蹲下玩玩具汽车', descriptionZh: '10 秒桌宠动作：蹲下玩玩具汽车。', category: 'games' },
			{ id: 'gaming_rage', name: 'Gaming Rage', description: '10-second gaming rage animation.', nameZh: '玩游戏气急败坏', descriptionZh: '10 秒桌宠动作：玩游戏气急败坏。', category: 'games' },
			{ id: 'water_gun_play', name: 'Water Gun Play', description: '10-second water gun play animation.', nameZh: '玩水枪', descriptionZh: '10 秒桌宠动作：玩水枪。', category: 'games' },
			{ id: 'rocking_horse', name: 'Rocking Horse', description: '10-second rocking horse animation.', nameZh: '骑木马', descriptionZh: '10 秒桌宠动作：骑木马。', category: 'games' },
			{ id: 'kicking_a_shuttlecock', name: 'Kicking a Shuttlecock', description: '10-second kicking a shuttlecock animation.', nameZh: '踢毽子', descriptionZh: '10 秒桌宠动作：踢毽子。', category: 'games' },
			{ id: 'spinning_a_top', name: 'Spinning a Top', description: '10-second spinning a top animation.', nameZh: '抽陀螺', descriptionZh: '10 秒桌宠动作：抽陀螺。', category: 'games' },
			{ id: 'playing_gomoku', name: 'Playing Gomoku', description: '10-second playing gomoku animation.', nameZh: '下五子棋', descriptionZh: '10 秒桌宠动作：下五子棋。', category: 'games' },
			{ id: 'playground_swing', name: 'Playground Swing', description: '10-second playground swing animation.', nameZh: '荡秋千', descriptionZh: '10 秒桌宠动作：荡秋千。', category: 'games' },
			{ id: 'carefree_humming', name: 'Carefree Humming', description: '10-second carefree humming animation.', nameZh: '悠闲哼歌', descriptionZh: '10 秒桌宠动作：悠闲哼歌。', category: 'music' },
			{ id: 'playing_the_violin', name: 'Playing the Violin', description: '10-second playing the violin animation.', nameZh: '小提琴演奏', descriptionZh: '10 秒桌宠动作：小提琴演奏。', category: 'music' },
			{ id: 'elegant_maid_dance', name: 'Elegant Maid Dance', description: '10-second elegant maid dance animation.', nameZh: '优雅女仆舞', descriptionZh: '10 秒桌宠动作：优雅女仆舞。', category: 'music' },
			{ id: 'light_sway_dance', name: 'Light Sway Dance', description: '10-second light sway dance animation.', nameZh: '轻快摇摆舞', descriptionZh: '10 秒桌宠动作：轻快摇摆舞。', category: 'music' },
			{ id: 'cute_otaku_dance', name: 'Cute Otaku Dance', description: '10-second cute otaku dance animation.', nameZh: '可爱宅舞', descriptionZh: '10 秒桌宠动作：可爱宅舞。', category: 'music' },
			{ id: 'playing_the_flute', name: 'Playing the Flute', description: '10-second playing the flute animation.', nameZh: '吹笛子', descriptionZh: '10 秒桌宠动作：吹笛子。', category: 'music' },
			{ id: 'eating_snacks', name: 'Eating Snacks', description: '10-second eating snacks animation.', nameZh: '大口吃零食', descriptionZh: '10 秒桌宠动作：大口吃零食。', category: 'food' },
			{ id: 'caught_snacking', name: 'Caught Snacking', description: '10-second caught snacking animation.', nameZh: '偷吃零食被抓住', descriptionZh: '10 秒桌宠动作：偷吃零食被抓住。', category: 'food' },
			{ id: 'eating_rice', name: 'Eating Rice', description: '10-second eating rice animation.', nameZh: '吃白饭', descriptionZh: '10 秒桌宠动作：吃白饭。', category: 'food' },
			{ id: 'eating_breakfast', name: 'Eating Breakfast', description: '10-second eating breakfast animation.', nameZh: '吃早餐', descriptionZh: '10 秒桌宠动作：吃早餐。', category: 'food' },
			{ id: 'eating_lunch', name: 'Eating Lunch', description: '10-second eating lunch animation.', nameZh: '吃午餐', descriptionZh: '10 秒桌宠动作：吃午餐。', category: 'food' },
			{ id: 'eating_dinner', name: 'Eating Dinner', description: '10-second eating dinner animation.', nameZh: '吃晚餐', descriptionZh: '10 秒桌宠动作：吃晚餐。', category: 'food' },
			{ id: 'melting_ice_cream', name: 'Melting Ice Cream', description: '10-second melting ice cream animation.', nameZh: '吃冰淇淋融化', descriptionZh: '10 秒桌宠动作：吃冰淇淋融化。', category: 'food' },
			{ id: 'eating_watermelon', name: 'Eating Watermelon', description: '10-second eating watermelon animation.', nameZh: '吃西瓜', descriptionZh: '10 秒桌宠动作：吃西瓜。', category: 'food' },
			{ id: 'eating_hotpot', name: 'Eating Hotpot', description: '10-second eating hotpot animation.', nameZh: '涮火锅', descriptionZh: '10 秒桌宠动作：涮火锅。', category: 'food' },
			{ id: 'eating_hairy_crab', name: 'Eating Hairy Crab', description: '10-second eating hairy crab animation.', nameZh: '吃大闸蟹', descriptionZh: '10 秒桌宠动作：吃大闸蟹。', category: 'food' },
			{ id: 'eating_candied_haw', name: 'Eating Candied Haw', description: '10-second eating candied haw animation.', nameZh: '吃糖葫芦', descriptionZh: '10 秒桌宠动作：吃糖葫芦。', category: 'food' },
			{ id: 'eating_longevity_noodles', name: 'Eating Longevity Noodles', description: '10-second eating longevity noodles animation.', nameZh: '吃长寿面', descriptionZh: '10 秒桌宠动作：吃长寿面。', category: 'food' },
			{ id: 'moon_festival', name: 'Moon Festival', description: '10-second moon festival animation.', nameZh: '中秋赏月吃月饼', descriptionZh: '10 秒桌宠动作：中秋赏月吃月饼。', category: 'festivals' },
			{ id: 'setting_off_fireworks', name: 'Setting Off Fireworks', description: '10-second setting off fireworks animation.', nameZh: '放烟花', descriptionZh: '10 秒桌宠动作：放烟花。', category: 'festivals' },
			{ id: 'opening_a_gift', name: 'Opening a Gift', description: '10-second opening a gift animation.', nameZh: '拆礼物', descriptionZh: '10 秒桌宠动作：拆礼物。', category: 'festivals' },
			{ id: 'eating_zongzi', name: 'Eating Zongzi', description: '10-second eating zongzi animation.', nameZh: '吃粽子', descriptionZh: '10 秒桌宠动作：吃粽子。', category: 'festivals' },
			{ id: 'eating_tangyuan', name: 'Eating Tangyuan', description: '10-second eating tangyuan animation.', nameZh: '吃汤圆', descriptionZh: '10 秒桌宠动作：吃汤圆。', category: 'festivals' },
			{ id: 'eating_dumplings', name: 'Eating Dumplings', description: '10-second eating dumplings animation.', nameZh: '吃饺子', descriptionZh: '10 秒桌宠动作：吃饺子。', category: 'festivals' },
			{ id: 'eating_qingtuan', name: 'Eating Qingtuan', description: '10-second eating qingtuan animation.', nameZh: '吃青团', descriptionZh: '10 秒桌宠动作：吃青团。', category: 'festivals' },
			{ id: 'eating_laba_congee', name: 'Eating Laba Congee', description: '10-second eating laba congee animation.', nameZh: '吃腊八粥', descriptionZh: '10 秒桌宠动作：吃腊八粥。', category: 'festivals' },
			{ id: 'eating_rice_cake', name: 'Eating Rice Cake', description: '10-second eating rice cake animation.', nameZh: '吃年糕', descriptionZh: '10 秒桌宠动作：吃年糕。', category: 'festivals' },
			{ id: 'eating_chongyang_cake', name: 'Eating Chongyang Cake', description: '10-second eating chongyang cake animation.', nameZh: '吃重阳糕', descriptionZh: '10 秒桌宠动作：吃重阳糕。', category: 'festivals' },
			{ id: 'receiving_a_red_envelope', name: 'Receiving a Red Envelope', description: '10-second receiving a red envelope animation.', nameZh: '收红包', descriptionZh: '10 秒桌宠动作：收红包。', category: 'festivals' },
			{ id: 'lion_dance', name: 'Lion Dance', description: '10-second lion dance animation.', nameZh: '舞狮头', descriptionZh: '10 秒桌宠动作：舞狮头。', category: 'festivals' },
			{ id: 'writing_the_fu_character', name: 'Writing the Fu Character', description: '10-second writing the fu character animation.', nameZh: '写福字', descriptionZh: '10 秒桌宠动作：写福字。', category: 'festivals' },
			{ id: 'qixi_needlework', name: 'Qixi Needlework', description: '10-second qixi needlework animation.', nameZh: '穿针乞巧', descriptionZh: '10 秒桌宠动作：穿针乞巧。', category: 'festivals' },
			{ id: 'decorating_a_christmas_tree', name: 'Decorating a Christmas Tree', description: '10-second decorating a christmas tree animation.', nameZh: '装点圣诞树', descriptionZh: '10 秒桌宠动作：装点圣诞树。', category: 'festivals' },
			{ id: 'halloween_trick_or_treat', name: 'Halloween Trick-or-Treat', description: '10-second halloween trick-or-treat animation.', nameZh: '讨糖南瓜灯', descriptionZh: '10 秒桌宠动作：讨糖南瓜灯。', category: 'festivals' },
			{ id: 'chongyang_chrysanthemums', name: 'Chongyang Chrysanthemums', description: '10-second chongyang chrysanthemums animation.', nameZh: '插茱萸赏菊', descriptionZh: '10 秒桌宠动作：插茱萸赏菊。', category: 'festivals' },
			{ id: 'releasing_a_river_lantern', name: 'Releasing a River Lantern', description: '10-second releasing a river lantern animation.', nameZh: '放河灯', descriptionZh: '10 秒桌宠动作：放河灯。', category: 'festivals' },
			{ id: 'cute_little_ghost', name: 'Cute Little Ghost', description: '10-second cute little ghost animation.', nameZh: '萌化小幽灵', descriptionZh: '10 秒桌宠动作：萌化小幽灵。', category: 'festivals' },
			{ id: 'releasing_a_sky_lantern', name: 'Releasing a Sky Lantern', description: '10-second releasing a sky lantern animation.', nameZh: '放孔明灯', descriptionZh: '10 秒桌宠动作：放孔明灯。', category: 'festivals' },
			{ id: 'building_a_snowman', name: 'Building a Snowman', description: '10-second building a snowman animation.', nameZh: '堆雪人', descriptionZh: '10 秒桌宠动作：堆雪人。', category: 'seasonal' },
			{ id: 'cooling_with_a_hand_fan', name: 'Cooling with a Hand Fan', description: '10-second cooling with a hand fan animation.', nameZh: '摇扇纳凉', descriptionZh: '10 秒桌宠动作：摇扇纳凉。', category: 'seasonal' },
			{ id: 'buried_in_autumn_leaves', name: 'Buried in Autumn Leaves', description: '10-second buried in autumn leaves animation.', nameZh: '被落叶淹没', descriptionZh: '10 秒桌宠动作：被落叶淹没。', category: 'seasonal' },
			{ id: 'flying_a_kite', name: 'Flying a Kite', description: '10-second flying a kite animation.', nameZh: '放风筝', descriptionZh: '10 秒桌宠动作：放风筝。', category: 'seasonal' },
			{ id: 'dove_magic', name: 'Dove Magic', description: '10-second dove magic animation.', nameZh: '变鸽子魔术', descriptionZh: '10 秒桌宠动作：变鸽子魔术。', category: 'magic' },
			{ id: 'flower_conjuring', name: 'Flower Conjuring', description: '10-second flower conjuring animation.', nameZh: '凭空生花魔术', descriptionZh: '10 秒桌宠动作：凭空生花魔术。', category: 'magic' },
			{ id: 'card_magic', name: 'Card Magic', description: '10-second card magic animation.', nameZh: '扑克魔术', descriptionZh: '10 秒桌宠动作：扑克魔术。', category: 'magic' },
			{ id: 'inflating_a_balloon', name: 'Inflating a Balloon', description: '10-second inflating a balloon animation.', nameZh: '吹气球', descriptionZh: '10 秒桌宠动作：吹气球。', category: 'fun' },
			{ id: 'animal_parade', name: 'Animal Parade', description: '10-second animal parade animation.', nameZh: '动物环绕', descriptionZh: '10 秒桌宠动作：动物环绕。', category: 'fun' },
			{ id: 'three_ball_juggling', name: 'Three-Ball Juggling', description: '10-second three-ball juggling animation.', nameZh: '三球抛接', descriptionZh: '10 秒桌宠动作：三球抛接。', category: 'fun' },
			{ id: 'butterflies_and_blossoms', name: 'Butterflies and Blossoms', description: '10-second butterflies and blossoms animation.', nameZh: '蝴蝶蜜蜂环绕头顶开花', descriptionZh: '10 秒桌宠动作：蝴蝶蜜蜂环绕头顶开花。', category: 'fun' },
			{ id: 'petting_a_cat', name: 'Petting a Cat', description: '10-second petting a cat animation.', nameZh: '撸猫', descriptionZh: '10 秒桌宠动作：撸猫。', category: 'fun' },
			{ id: 'jump_and_smash', name: 'Jump and Smash', description: '10-second jump and smash animation.', nameZh: '原地跳跃抓碎头顶物品', descriptionZh: '10 秒桌宠动作：原地跳跃抓碎头顶物品。', category: 'fun' },
			{ id: 'whale_bubbles', name: 'Whale Bubbles', description: '10-second whale bubbles animation.', nameZh: '鲸鱼吐泡泡特效', descriptionZh: '10 秒桌宠动作：鲸鱼吐泡泡特效。', category: 'special' },
			{ id: 'blue_whale_appears', name: 'Blue Whale Appears', description: '10-second blue whale appears animation.', nameZh: '蓝鲸现世', descriptionZh: '10 秒桌宠动作：蓝鲸现世。', category: 'special' },
			{ id: 'whale_tail_slap', name: 'Whale Tail Slap', description: '10-second whale tail slap animation.', nameZh: '用鲸鱼尾巴拍打地面', descriptionZh: '10 秒桌宠动作：用鲸鱼尾巴拍打地面。', category: 'special' },
			{ id: 'desk_tap', name: 'Desk Tap', description: '10-second desk tap animation.', nameZh: '敲击桌面互动', descriptionZh: '10 秒桌宠动作：敲击桌面互动。', category: 'fun' },
			{ id: 'gravity_squash', name: 'Gravity Squash', description: '10-second gravity squash animation.', nameZh: '重力下蹲压缩', descriptionZh: '10 秒桌宠动作：重力下蹲压缩。', category: 'fun' },
			{ id: 'jump_scare', name: 'Jump Scare', description: '10-second jump scare animation.', nameZh: '被吓一跳', descriptionZh: '10 秒桌宠动作：被吓一跳。', category: 'fun' },
			{ id: 'eating_tokens', name: 'Eating Tokens', description: '10-second eating tokens animation.', nameZh: '吃 Token', descriptionZh: '10 秒桌宠动作：吃 Token。', category: 'memes' },
			{ id: 'yeah_what_should_we_eat', name: 'Yeah, What Should We Eat?', description: '10-second yeah, what should we eat? animation.', nameZh: '是啊，吃什么？', descriptionZh: '10 秒桌宠动作：是啊，吃什么？', category: 'memes' },
		];
		var LEGACY_ANIM_IDS = {
			'idle_breathe': 'breathing',
			'turn_look': 'looking_around',
			'move_float': 'floating_steps',
			'move_crab': 'crab_walk',
			'move_run_trip': 'running_trip',
			'click_happy': 'happy_hop',
			'click_shy': 'shy_surprise',
			'click_tsundere': 'tsundere_pout',
			'click_tickle': 'ticklish_giggle',
			'act_wave': 'cheerful_wave',
			'drag_hang': 'dragged_in_midair',
			'act_curtsy': 'maid_curtsy',
			'act_stretch': 'big_stretch',
			'act_spin': 'gentle_spin',
			'act_yawn': 'sleepy_yawn',
			'act_nap': 'quick_nap',
			'act_awake': 'startled_awake',
			'daily_brush_teeth': 'morning_brushing',
			'act_mirror': 'mirror_check',
			'act_costume': 'outfit_color_try_on',
			'act_notes': 'taking_notes',
			'act_code': 'coding',
			'act_deep_think': 'deep_thought',
			'act_rubik': 'solving_a_rubiks_cube',
			'act_toy_car': 'playing_with_a_toy_car',
			'act_game_frustrated': 'gaming_rage',
			'act_water_gun': 'water_gun_play',
			'games_rocking_horse': 'rocking_horse',
			'games_shuttlecock': 'kicking_a_shuttlecock',
			'games_spinning_top': 'spinning_a_top',
			'games_gomoku': 'playing_gomoku',
			'games_swing': 'playground_swing',
			'act_hum': 'carefree_humming',
			'act_violin': 'playing_the_violin',
			'act_maid_dance': 'elegant_maid_dance',
			'act_swing': 'light_sway_dance',
			'act_cute_dance': 'cute_otaku_dance',
			'music_flute': 'playing_the_flute',
			'act_snack': 'eating_snacks',
			'act_snack_caught': 'caught_snacking',
			'act_rice': 'eating_rice',
			'act_breakfast': 'eating_breakfast',
			'act_lunch': 'eating_lunch',
			'act_dinner': 'eating_dinner',
			'act_ice_cream': 'melting_ice_cream',
			'food_watermelon': 'eating_watermelon',
			'food_hotpot': 'eating_hotpot',
			'food_hairy_crab': 'eating_hairy_crab',
			'food_candied_haw': 'eating_candied_haw',
			'food_longevity_noodles': 'eating_longevity_noodles',
			'act_mooncake': 'moon_festival',
			'festival_fireworks': 'setting_off_fireworks',
			'festival_gift': 'opening_a_gift',
			'festival_zongzi': 'eating_zongzi',
			'festival_tangyuan': 'eating_tangyuan',
			'festival_dumplings': 'eating_dumplings',
			'festival_qingtuan': 'eating_qingtuan',
			'festival_laba_congee': 'eating_laba_congee',
			'festival_rice_cake': 'eating_rice_cake',
			'festival_chongyang_cake': 'eating_chongyang_cake',
			'festival_red_envelope': 'receiving_a_red_envelope',
			'festival_lion_dance': 'lion_dance',
			'festival_fu_calligraphy': 'writing_the_fu_character',
			'festival_qixi_needlework': 'qixi_needlework',
			'festival_christmas_tree': 'decorating_a_christmas_tree',
			'festival_halloween': 'halloween_trick_or_treat',
			'festival_chongyang': 'chongyang_chrysanthemums',
			'festival_river_lantern': 'releasing_a_river_lantern',
			'festival_cute_ghost': 'cute_little_ghost',
			'festival_sky_lantern': 'releasing_a_sky_lantern',
			'act_snowman': 'building_a_snowman',
			'act_fan': 'cooling_with_a_hand_fan',
			'act_leaves': 'buried_in_autumn_leaves',
			'act_kite': 'flying_a_kite',
			'magic_dove': 'dove_magic',
			'magic_flower': 'flower_conjuring',
			'magic_cards': 'card_magic',
			'act_balloon': 'inflating_a_balloon',
			'act_animals': 'animal_parade',
			'fun_juggling': 'three_ball_juggling',
			'fun_butterflies_blossom': 'butterflies_and_blossoms',
			'fun_pet_cat': 'petting_a_cat',
			'act_jump_smash': 'jump_and_smash',
			'act_bubble': 'whale_bubbles',
			'act_blue_whale': 'blue_whale_appears',
			'act_tail_slap': 'whale_tail_slap',
			'act_desk_tap': 'desk_tap',
			'act_squash': 'gravity_squash',
			'act_startle': 'jump_scare',
			'act_token': 'eating_tokens',
			'act_listen': 'attentive_listening',
			'act_read': 'taking_notes',
			'act_celebrate': 'happy_hop',
			'act_search': 'deep_thought',
			'act_shrug': 'gravity_squash',
			'act_confused': 'deep_thought',
			// 0.1.0 后移除的异画风动作：迁移已持久化的英文 ID，避免播放空 URL。
			'searching': 'deep_thought',
			'reading_book': 'taking_notes',
			'confused_head_shake': 'deep_thought',
			'helpless_shrug': 'gravity_squash',
			'celebration': 'happy_hop',
			'move_run': 'running_trip',
			'meme_what_to_eat': 'yeah_what_should_we_eat',
		};
		// 索引：英文 id → 条目 / 英文名称 → 条目
		var ANIM_BY_ID = {};
		var ANIM_BY_NAME = {};
		ANIMS.forEach((a) => { ANIM_BY_ID[a.id] = a; ANIM_BY_NAME[a.name] = a; ANIM_BY_NAME[a.nameZh] = a; });

		// ---- 自定义动作注册表（资源层） ----
		// 宿主扫描 $DSH_HOME/whale-pet/actions/ 下的 WebM/MP4，经
		// /whale-pet/api/actions 下发；这里维护 id → 元数据 的注册表，
		// 供 animUrl/animName/动画选择器统一解析。自定义动作视作 acts
		// 语义（可入动作池/意图映射；不参与移动/点击/拖拽的专用逻辑）。
		var customById = {};
		// 同路径替换过的内置资源需带版本号，避免浏览器继续播放旧缓存。
		var BUILTIN_ASSET_REVISIONS = {
			target_point_run: '20260823-1',
			arrival_wave: '20260823-1',
			attentive_listening: '20260823-1',
		};
		/** 批量更新自定义动作注册表（来自 /whale-pet/api/actions 的 actions 数组） */
		var setCustomAnims = (list) => {
			customById = {};
			(list || []).forEach((a) => { if (a && a.id) customById[a.id] = a; });
		};
		/** 统一取动画条目：内置 → ANIMS 条目；自定义 → 合成 {id,name,category:'custom'}；未知 → null */
		var animEntry = (id) => {
			var a = ANIM_BY_ID[id];
			if (a) return a;
			return customById[id] ? { id: id, name: id, category: 'custom' } : null;
		};
		// 播放 URL：内置 /whale-pet/<分类>/<id>.webm；自定义 /whale-pet/custom/<id>.<ext>
		var animUrl = (id) => {
			var a = ANIM_BY_ID[id];
			if (a) {
				var revision = BUILTIN_ASSET_REVISIONS[id];
				return '/whale-pet/' + a.category + '/' + a.id + '.webm'
					+ (revision ? '?v=' + encodeURIComponent(revision) : '');
			}
			var c = customById[id];
			return c ? '/whale-pet/custom/' + encodeURIComponent(id) + '.' + (c.ext || 'webm')
				+ '?v=' + encodeURIComponent(String(c.mtime || 0)) : '';
		};
		// id → 显示名（UI 用）；自定义动作显示文件名；未知 id 原样返回
		var animName = (id) => {
			var a = ANIM_BY_ID[id];
			return a ? a.name : id;
		};
		var animDescription = (id) => {
			var a = ANIM_BY_ID[id];
			return a ? a.description : '';
		};
		var localizedAnimName = (id, t) => {
			var a = ANIM_BY_ID[id];
			return a && t ? t('animName_' + id) : animName(id);
		};
		var localizedAnimDescription = (id, t) => {
			var a = ANIM_BY_ID[id];
			return a && t ? t('animDescription_' + id) : '';
		};
		// 旧配置迁移：旧版带分类前缀的英文 id / 旧名称 → 新英文 id（settings.yaml 里可能存有旧值）
		var normalizeAnimId = (v) => {
			if (ANIM_BY_ID[v]) return v;
			if (LEGACY_ANIM_IDS[v]) return LEGACY_ANIM_IDS[v];
			var a = ANIM_BY_NAME[v];
			return a ? a.id : v;
		};

		// 解析 session.models 响应 → { route, model }（纯函数，便于单测）；
		// 无有效选择 → null
		var parseSessionModelSelection = (value) => {
			var cur = value && value.current;
			if (!cur || typeof cur.provider !== 'string' || !cur.provider
				|| typeof cur.model !== 'string' || !cur.model) return null;
			return { route: cur.provider, model: cur.model };
		};

		// 主体待机动画（常驻、循环播放）
		var IDLE = 'breathing';
		// 含画内文字的动画不能做整层水平镜像，否则文字会反向。
		var NON_MIRRORED_ANIMS = new Set([
			'deep_thought',
			'quick_nap',
			'writing_the_fu_character',
			'yeah_what_should_we_eat',
		]);
		var animFacingTransform = (anim, facing) =>
			facing === 'right' && !NON_MIRRORED_ANIMS.has(anim) ? 'scaleX(-1)' : '';
		// 转向动画（"东张西望"内容就是从偏左看到偏右，播完翻转 facing）
		var TURN = 'looking_around';
		// 随机动作池：等概率抽取
		var ACTS = ANIMS.filter((a) => ['idle', 'turn', 'moves', 'clicks', 'drag'].indexOf(a.category) === -1).map((a) => a.id);
		// 点击回应动画池（3 选 1）
		var TARGET_MOVE_ANIM = 'target_point_run';
		var GREET_ANIM = 'arrival_wave';
		var CLICKS = ANIMS.filter((a) => a.category === 'clicks' && a.id !== GREET_ANIM).map((a) => a.id);
		// 拖拽动画（按住拖动时播放）
		var DRAG = 'dragged_in_midair';
		// 移动动画池：动画只提供"走路姿态"，实际位移由 rAF 驱动
		var MOVES = ANIMS.filter((a) => a.category === 'moves' && a.id !== TARGET_MOVE_ANIM).map((a) => a.id);

		// 自主行为链默认概率（由设置配置覆盖，见 DEFAULT_CONFIG.behavior）

		// 移动参数
		var MOVE_MIN_PX = 60;   // 单次移动最短距离（px）
		var MOVE_MAX_PX = 240;  // 单次移动最长距离（px）
		var MOVE_MARGIN = 20;   // 屏幕边缘安全边距（px）
		var MOVE_LEAD_SEC = 2;  // 动画开头 2s 是"准备动作"，位置不动
		var MOVE_TAIL_SEC = 2;  // 动画结尾 2s 是"收尾动作"，位置不动
		var MOVE_FALLBACK_DURATION = 10.09; // 取不到动画时长时的兜底（移动动画实际时长）
		// 点击目标移动（选中宠物后点击屏幕）：走路/跑步 + 到达打招呼
		var WALK_ANIM = TARGET_MOVE_ANIM; // selected-target movement uses the dedicated running animation
		var RUN_ANIM = TARGET_MOVE_ANIM;
		var RUN_DISTANCE_PX = 400;     // 目标距离超过此值改用跑步
		var CLICK_MOVE_MIN_PX = 24;    // 目标点距离当前中心小于此值则不移动

		// 完全隐藏 + 屏幕边缘召回参数
		var EDGE_ZONE = 16; // 召回触发：指针距屏幕边缘多少 px 内

		// ---- 交互增强参数 ----
		var DOUBLE_CLICK_MS = 320;      // 双击判定窗口（ms）
		var DOUBLE_ANIM = 'blue_whale_appears'; // 双击特殊动作（蓝鲸现世）
		var FOLLOW_CHANCE = 0.5;        // 自主移动中走向光标的比例（其余朝 facing 漫游）
		var FOLLOW_MIN_PX = 120;        // 光标比这近就不跟（已在阈值内 → 停下）
		var FOLLOW_STOP_PX = 80;        // 跟随时走到离光标至少这么远处停
		var INERTIA_MIN_SPEED = 1.2;    // 松手速度超过此值（px/ms）进入惯性滑行
		var INERTIA_TAU = 160;          // 惯性速度衰减时间常数（ms，指数阻尼）
		var INERTIA_STOP_SPEED = 0.03;  // 惯性速度低于此值（px/ms）停止

		// 点击位置分类：命中框内纵向比例 → 区序（0=上1/3头 1=中1/3身 2=下1/3尾）
		function clickZoneIndex(frac) {
			return frac < 1 / 3 ? 0 : frac < 2 / 3 ? 1 : 2;
		}
		// 拖拽惯性：由最近拖拽采样估算松手速度（px/ms）。
		// 只看 ~120ms 窗口内的样本（过滤久远的静止样本）；样本不足/时间倒流 → null
		function estimateVelocity(samples, now) {
			if (!samples || samples.length < 2) return null;
			var last = samples[samples.length - 1];
			var tNow = now === undefined ? last.t : now;
			var first = null;
			for (var i = samples.length - 1; i >= 0; i--) {
				if (tNow - samples[i].t > 120) break;
				first = samples[i];
			}
			if (!first || first === last) return null;
			var dt = last.t - first.t;
			if (dt <= 0) return null;
			var vx = (last.x - first.x) / dt;
			var vy = (last.y - first.y) / dt;
			return { vx: vx, vy: vy, speed: Math.hypot(vx, vy) };
		}


		// ---- 工具函数 ----
		var randomInt = (min, max) => Math.floor(min + Math.random() * (max - min));
		// 最近加载失败的动画（useVideoLayer 的 error 兜底写入）：pickFrom 在冷却期
		// 内剔除，防止两个以上"清单仍在但文件已删"的自定义 id 交替失败无限循环
		// （error→ended→换一个→error）；冷却过期允许重试，文件恢复/加载成功后自愈。
		var ANIM_FAIL_COOLDOWN_MS = 30000;
		var failedAnims = new Map(); // id -> 最近失败时间戳
		// 从池中等概率抽一个**有效**动画：剔除悬空 id（自定义动作文件被直接删除/
		// 手写 settings.yaml 的脏配置）与冷却期内的失败 id，并排除 exclude
		// （避免连续重复）。排除后无有效项 → null，由调用方回落待机等兜底——
		// 避免播空 URL 卡死行为链。
		var pickFrom = (pool, exclude) => {
			var now = Date.now();
			var entries = (pool || []).filter((id) => {
				if (!id || !animEntry(id) || id === exclude) return false;
				if (failedAnims.has(id)) {
					if (now - failedAnims.get(id) >= ANIM_FAIL_COOLDOWN_MS) failedAnims.delete(id); // 冷却过期即清理，Map 不无限增长
					else return false;
				}
				return true;
			});
			if (!entries.length) return null;
			return entries[Math.floor(Math.random() * entries.length)];
		};

		// 指针是否位于屏幕边缘召回区（完全隐藏时用于触发露出）
		var edgeZoneHit = (x, y, edge) => {
			if (edge === 'left') return x <= EDGE_ZONE;
			if (edge === 'right') return x >= window.innerWidth - EDGE_ZONE;
			if (edge === 'top') return y <= EDGE_ZONE;
			return y >= window.innerHeight - EDGE_ZONE;
		};

		// 系统"减少动态效果"偏好（CSS 过渡/气泡动画/拖拽惯性已分别处理；
		// 此处用于自主漫游降级——显式点击移动/拖拽不受影响）。
		var prefersReducedMotion = () =>
			!!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

		// ============================================================================
		// 意图系统（事件驱动核心）—— 感知层与决策层的纯函数部分
		// ============================================================================
		// 意图（intent）：Harness 活动归一化后的"宠物该演什么"。
		// 纯函数 applyFrame 把事件流帧映射为意图活跃集合，单测友好（见
		// exports.__internals）。
		var INTENT = {
			IDLE: 'IDLE',             // 无活动：自主行为链
			WORKING: 'WORKING',       // Agent 运行中（兜底意图）
			CODING: 'CODING',         // 写代码/操作类工具
			READING: 'READING',       // 阅读/检索类工具
			RESEARCHING: 'RESEARCHING', // 联网查询类工具
			THINKING: 'THINKING',     // 模型思考/输出中
			WAITING_USER: 'WAITING_USER', // 等待用户审批/回答
			LISTENING: 'LISTENING',   // 用户消息到达/排队（倾听）
			ERROR: 'ERROR',           // 工具失败 / Agent 出错
		};
		// 意图优先级：数值越大越优先（仲裁时取最高）
		var INTENT_PRIORITY = {
			ERROR: 9,
			WAITING_USER: 8,
			LISTENING: 7,
			CODING: 6,
			READING: 5,
			RESEARCHING: 4,
			THINKING: 3,
			WORKING: 2,
			IDLE: 0,
		};
		// 工具名 → 意图分类（可在设置中整体覆盖）
		var TOOL_INTENTS = {
			bash: 'CODING', write: 'CODING', edit: 'CODING', str_replace_editor: 'CODING',
			todo_write: 'CODING', workflow: 'CODING',
			read: 'READING', glob: 'READING', grep: 'READING', skill: 'READING',
			web_search: 'RESEARCHING', web_fetch: 'RESEARCHING',
		};
		// 意图 → 动作池（默认映射；数组 = 播完随机轮换，单元素 = 循环播放）。
		// 注意：looking_around（东张西望）同时是转向动画，播完会翻转 facing（左右张望，符合倾听语义）
		var INTENT_ACTIONS = {
			WORKING: ['eating_tokens'],
			CODING: ['coding'],
			READING: ['taking_notes'],
			RESEARCHING: ['taking_notes'],
			THINKING: ['deep_thought'],
			WAITING_USER: ['looking_around'],
			LISTENING: ['attentive_listening'],
			ERROR: ['jump_scare'],
		};

		// 意图状态：{ active: {intent: 最近活跃时间戳}, toolCounts: {intent: 计数},
		//            stepTools: {'turn:step': [intent,...]}, running: bool }
		var emptyIntentState = () => ({ active: {}, toolCounts: {}, stepTools: {}, running: false });

	// 从活跃集合取最高优先级意图（无 → IDLE）。ruleMeta：规则元数据
	// （{ 'rule:<id>': rule }），规则与内置意图同一张牌桌比优先级。
	// 同优先级 tie-break：IDLE 让位给任何活跃意图；其余按 id 字典序（确定性）
	function highestIntent(active, ruleMeta) {
		var best = INTENT.IDLE;
		var bestP = INTENT_PRIORITY[INTENT.IDLE];
		for (var k in active) {
			var p = intentPriorityOf(k, ruleMeta);
			if (p > bestP || (p === bestP && best === INTENT.IDLE && k !== INTENT.IDLE)
				|| (p === bestP && best !== INTENT.IDLE && k < best)) {
				best = k;
				bestP = p;
			}
		}
		return best;
	}

		// 事件流帧 → 意图状态（不可变更新）。帧形状与官方 api.events 一致：
		//   host:  { type:'host/session-status', running } | { type:'host/agent-error' }
		//   mux:   { type:'session/event', event } | { type:'approval/requested' } |
		//          { type:'approval/resolved' } | { type:'question/requested' } |
		//          { type:'question/resolved' } | { type:'session/queue' }
		function applyFrame(state, frame, now) {
			var next = {
				active: { ...state.active },
				toolCounts: { ...state.toolCounts },
				stepTools: state.stepTools,
				running: state.running,
			};
			var touch = (i) => { next.active[i] = now; };
			var clear = (i) => { delete next.active[i]; };

			if (frame.type === 'host/session-status') {
				next.running = !!frame.running;
				if (frame.running) { clear(INTENT.LISTENING); touch(INTENT.WORKING); }
				else { clear(INTENT.WORKING); clear(INTENT.THINKING); }
				return next;
			}
			if (frame.type === 'host/agent-error') {
				touch(INTENT.ERROR);
				return next;
			}
			if (frame.type === 'approval/requested' || frame.type === 'question/requested') {
				touch(INTENT.WAITING_USER);
				return next;
			}
			if (frame.type === 'approval/resolved' || frame.type === 'question/resolved') {
				clear(INTENT.WAITING_USER);
				return next;
			}
			if (frame.type === 'session/queue') {
				// 排队中的用户消息（busy 时输入进队列）：用户在"说话"→ LISTENING；
				// 空队列不激活（残留 LISTENING 由 linger 自然消退）
				if (Array.isArray(frame.items) && frame.items.length) touch(INTENT.LISTENING);
				return next;
			}
			if (frame.type === 'session/event') {
				var ev = frame.event || {};
				var d = ev.data || {};
				if (ev.type === 'tool/call') {
					clear(INTENT.LISTENING);
					// 模型请求工具：分类意图 + 按 turn:step 记账（tool/result 无工具名，靠此配对）
					var ti = TOOL_INTENTS[d.name] || null;
					touch(INTENT.WORKING);
					if (ti) {
						touch(ti);
						next.toolCounts[ti] = (next.toolCounts[ti] || 0) + 1;
					}
					var stepKey = d.turn + ':' + d.step;
					next.stepTools = { ...next.stepTools, [stepKey]: [...(next.stepTools[stepKey] || []), ti] };
					return next;
				}
				if (ev.type === 'tool/result') {
					if (d.error) touch(INTENT.ERROR);
					// 消退该 turn:step 最近一次调用的工具意图
					var key = d.turn + ':' + d.step;
					var arr = next.stepTools[key];
					if (arr && arr.length) {
						next.stepTools = { ...next.stepTools, [key]: arr.slice(0, -1) };
						var done = arr[arr.length - 1];
						if (done) {
							next.toolCounts[done] = (next.toolCounts[done] || 1) - 1;
							if (next.toolCounts[done] <= 0) {
								delete next.toolCounts[done];
								clear(done);
							}
						}
					}
					return next;
				}
				if (ev.type === 'user/message') {
					touch(INTENT.LISTENING);
					return next;
				}
				if (ev.type === 'turn/start') {
					clear(INTENT.LISTENING);
					touch(INTENT.WORKING);
					return next;
				}
				if (ev.type === 'turn/end') {
					// 回合结束：清空全部工作类意图、ERROR 与工具记账
					clear(INTENT.WORKING); clear(INTENT.THINKING); clear(INTENT.CODING);
					clear(INTENT.READING); clear(INTENT.RESEARCHING); clear(INTENT.LISTENING);
					clear(INTENT.ERROR);
					next.toolCounts = {};
					next.stepTools = {};
					return next;
				}
				if (ev.type === 'step/start') {
					clear(INTENT.LISTENING);
					touch(INTENT.THINKING);
					touch(INTENT.WORKING);
					return next;
				}
				if (ev.type === 'step/end') {
					clear(INTENT.THINKING);
					return next;
				}
			if (ev.type === 'assistant/chunk') {
				clear(INTENT.LISTENING);
				touch(INTENT.THINKING); // 只刷新时间戳，不计数
				return next;
			}
			return next;
		}
		return next;
	}

	// ============================================================================
	// 触发规则 —— 纯函数匹配层（applyFrame 之后的第二级意图生产者）
	// ============================================================================
	// 规则 = 声明式条件列表（AND）+ 动作池 + 优先级/冷却/保持。命中 → 激活
	// 'rule:<id>' 意图进仲裁器（与内置意图同一张牌桌）；脉冲语义：holdMs 后
	// 自动摘除（同 ERROR 模式）。全部纯函数、无副作用，进 __internals 可单测。
	var RULE_PREFIX = 'rule:';
	var isRuleIntent = (intent) => typeof intent === 'string' && intent.lastIndexOf(RULE_PREFIX, 0) === 0;
	var intentActionIsOnce = (intent) => intent !== INTENT.IDLE;
	var RULE_MIN_COOLDOWN_MS = 1000;
	var RULE_MAX_COOLDOWN_MS = 3600000;
	var RULE_MAX_COUNT = 50;
	var COND_OPS = ['eq', 'ne', 'contains', 'regex', 'exists'];
	var RULE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
	// 被测字符串截断长度：约束 contains/regex 的输入规模与内存（长 error
	// 消息场景）。注意：截断不能防灾难性回溯（200 字符对指数型正则仍是
	// 天文数字），真正的门禁是下方 danger 检测拒绝此类模式
	var RULE_VALUE_MAX = 200;
	// 编译后正则缓存：chunk 洪流下避免每帧每条件重复编译（实测省 ~50%）
	var REGEX_CACHE_MAX = 128;
	var regexCache = new Map();
	// 只接受可静态判定为安全的正则子集：拒绝反向引用、lookaround/命名组，
	// 以及对“包含 alternation 或其他量词”的组再次量化。后者同时覆盖
	// (a+)+ 与 (a|aa)+ 等典型指数级回溯；普通 ^foo|bar$、(ab)+ 仍可使用。
	function isSafeRegexPattern(pattern) {
		if (typeof pattern !== 'string' || pattern.length > 256) return false;
		var stack = [];
		var inClass = false;
		for (var i = 0; i < pattern.length; i++) {
			var ch = pattern[i];
			if (ch === '\\') {
				var escaped = pattern[i + 1];
				if (!inClass && (/[1-9]/.test(escaped || '') || escaped === 'k')) return false;
				i++;
				continue;
			}
			if (ch === '[' && !inClass) { inClass = true; continue; }
			if (ch === ']' && inClass) { inClass = false; continue; }
			if (inClass) continue;
			if (ch === '(') {
				if (pattern[i + 1] === '?') return false;
				stack.push({ complex: false });
				continue;
			}
			if (ch === '|') {
				if (stack.length) stack[stack.length - 1].complex = true;
				continue;
			}
			if (ch === ')') {
				if (!stack.length) return false;
				var group = stack.pop();
				var next = pattern[i + 1];
				var quantified = next === '+' || next === '*' || next === '?' || next === '{';
				if (quantified && group.complex) return false;
				if (group.complex && stack.length) stack[stack.length - 1].complex = true;
				continue;
			}
			if ((ch === '+' || ch === '*' || ch === '?' || ch === '{') && stack.length) {
				stack[stack.length - 1].complex = true;
			}
		}
		return stack.length === 0 && !inClass;
	}

	// 安全取点路径（'data.error' → frame.data.error；缺字段 → undefined）
	function getPath(obj, path) {
		if (!path) return undefined;
		var parts = String(path).split('.');
		var cur = obj;
		for (var i = 0; i < parts.length; i++) {
			if (cur === null || cur === undefined) return undefined;
			cur = cur[parts[i]];
		}
		return cur;
	}

	// 正则匹配：编译结果缓存（含失败 → null，坏正则不反复编译）；
	// 编译失败 → false，不让手写 settings.yaml 的坏正则炸掉事件流
	function safeRegexTest(pattern, value) {
		var re = regexCache.get(pattern);
		if (re === undefined) {
			if (!isSafeRegexPattern(pattern)) re = null;
			else try { re = new RegExp(pattern); } catch (e) { re = null; }
			if (regexCache.size >= REGEX_CACHE_MAX) regexCache.clear();
			regexCache.set(pattern, re);
		}
		return re ? re.test(value) : false;
	}

	// 单条件匹配。缺失字段语义：eq/ne/contains/regex 一律 false（"字段不存在"
	// 是否算"不等于"有歧义，判存在请用 exists），exists 显式判 undefined。
	// 字符串值先截断（RULE_VALUE_MAX）——约束输入规模。
	function condMatch(c, nframe) {
		if (!c || typeof c.field !== 'string' || !c.field) return false;
		var v = getPath(nframe, c.field);
		if (typeof v === 'string' && v.length > RULE_VALUE_MAX) v = v.slice(0, RULE_VALUE_MAX);
		switch (c.op) {
			case 'exists': return v !== undefined;
			case 'eq': return String(v) === c.value;
			case 'ne': return v !== undefined && String(v) !== c.value;
			case 'contains': return typeof v === 'string' && v.indexOf(c.value) !== -1;
			case 'regex': return typeof v === 'string' && safeRegexTest(c.value, v);
		}
		return false;
	}

	// 传感器帧 → 规则匹配用规范化帧（统一形状 + toolName 增强：
	// tool/result 帧本身无工具名，从 turn:step 配对表回查上一次 tool/call）
	function ruleFrameOf(frame, lastToolByStep) {
		var ev = (frame && frame.event) || {};
		var n = {
			stream: frame.type || '',
			type: ev.type || (frame && frame.type) || '',
			sessionId: frame.sessionId,
			running: frame.running,
			items: frame.items,
			data: ev.data || {},
		};
		if (ev.type === 'tool/call') {
			n.toolName = (ev.data && typeof ev.data.name === 'string') ? ev.data.name : '';
		} else if (ev.type === 'tool/result') {
			var k = (ev.data && ev.data.turn) + ':' + (ev.data && ev.data.step);
			n.toolName = lastToolByStep[k] || '';
		}
		return n;
	}

	// 规则集匹配（纯函数）：返回 { fired: 命中规则数组, state: 新规则状态 }。
	// state = { lastFired: {id: ts}, lastToolByStep: {'turn:step': name} }。
	// cooldown 在此钳制（双保险：normalizeRule 已钳，手写数据再兜一次）。
	function matchRules(rules, frame, state, now) {
		var st = state || { lastFired: {}, lastToolByStep: {} };
		var nframe = ruleFrameOf(frame, st.lastToolByStep);
		// tool/call 时记账工具名（配对表超 500 项整体重置，防长会话膨胀）
		var nextTool = st.lastToolByStep;
		var ev = frame && frame.type === 'session/event' ? (frame.event || null) : null;
		if (ev && ev.type === 'tool/call' && ev.data && typeof ev.data.name === 'string') {
			nextTool = Object.assign({}, st.lastToolByStep);
			if (Object.keys(nextTool).length > 500) nextTool = {};
			nextTool[ev.data.turn + ':' + ev.data.step] = ev.data.name;
		}
		var fired = [];
		var nextLast = st.lastFired;
		var touched = false;
		var list = rules || [];
		for (var i = 0; i < list.length; i++) {
			var r = list[i];
			if (!r || r.enable === false || !Array.isArray(r.when) || !r.when.length) continue;
			var cd = Math.min(Math.max(r.cooldownMs || RULE_MIN_COOLDOWN_MS, RULE_MIN_COOLDOWN_MS), RULE_MAX_COOLDOWN_MS);
			var last = st.lastFired[r.id];
			if (last !== undefined && now - last < cd) continue;
			var ok = true;
			for (var j = 0; j < r.when.length; j++) {
				if (!condMatch(r.when[j], nframe)) { ok = false; break; }
			}
			if (!ok) continue;
			if (!touched) { nextLast = Object.assign({}, st.lastFired); touched = true; }
			nextLast[r.id] = now;
			fired.push(r);
		}
		return { fired: fired, state: { lastFired: nextLast, lastToolByStep: nextTool } };
	}

	// 规则清洗（手写 settings.yaml / 旧版数据 → 安全形状）。非法（id 不合规、
	// 条件缺字段、op 不在白名单、regex 编译失败）→ 整条丢弃返回 null。
	// 注意：actions 不按 animEntry 过滤（自定义动作清单可能晚于设置加载），
	// 悬空 id 由运行时 onIntent 的池过滤兜底。
	function normalizeRule(r) {
		if (!r || typeof r !== 'object') return null;
		if (typeof r.id !== 'string' || !RULE_ID_RE.test(r.id)) return null;
		var when = [];
		if (Array.isArray(r.when)) {
			for (var i = 0; i < r.when.length && when.length < 10; i++) {
				var c = r.when[i];
				if (!c || typeof c !== 'object') return null;
				if (typeof c.field !== 'string' || !c.field || c.field.length > 128) return null;
				if (COND_OPS.indexOf(c.op) === -1) return null;
				var val = String(c.value === undefined ? '' : c.value);
				if (val.length > 256) return null;
				if (c.op === 'regex') {
					try { new RegExp(val); } catch (e) { return null; }
					if (!isSafeRegexPattern(val)) return null;
				}
				when.push({ field: c.field, op: c.op, value: val });
			}
		}
		if (!when.length) return null;
		var acts = [];
		if (Array.isArray(r.actions)) {
			for (var k = 0; k < r.actions.length && acts.length < 5; k++) {
				var id = normalizeAnimId(String(r.actions[k]));
				if (id && id.length <= 64) acts.push(id);
			}
		}
		var pr = Math.round(Number(r.priority));
		if (!isFinite(pr)) pr = 3;
		var cd = Math.round(Number(r.cooldownMs));
		if (!isFinite(cd)) cd = 30000;
		var hd = Math.round(Number(r.holdMs));
		if (!isFinite(hd)) hd = 3000;
		return {
			id: r.id,
			enable: r.enable !== false,
			name: typeof r.name === 'string' ? r.name.slice(0, 64) : '',
			when: when,
			priority: Math.min(Math.max(pr, 0), 9),
			cooldownMs: Math.min(Math.max(cd, RULE_MIN_COOLDOWN_MS), RULE_MAX_COOLDOWN_MS),
			holdMs: Math.min(Math.max(hd, 0), 60000),
			actions: acts,
			bubble: typeof r.bubble === 'string' ? r.bubble.slice(0, 50) : '',
		};
	}

	function normalizeRules(list) {
		if (!Array.isArray(list)) return [];
		var out = [];
		var seen = {}; // id 去重：重复 id 会让 ruleMeta/冷却记账串扰，保留首条
		for (var i = 0; i < list.length && out.length < RULE_MAX_COUNT; i++) {
			var r = normalizeRule(list[i]);
			if (r && !seen[r.id]) {
				seen[r.id] = true;
				out.push(r);
			}
		}
		return out;
	}

	// 意图优先级查表：内置表 → 规则元数据（rule:<id>）→ -1（未知）
	function intentPriorityOf(id, ruleMeta) {
		var p = INTENT_PRIORITY[id];
		if (p !== undefined) return p;
		if (ruleMeta && id.lastIndexOf(RULE_PREFIX, 0) === 0) {
			var m = ruleMeta[id];
			return m ? Number(m.priority) || 0 : -1;
		}
		return -1;
	}

	// ============================================================================
	// useVideoLayer —— 双缓冲视频层 hook（切换动画的核心机制）
		// ============================================================================
		// 思路：两个 <video> 层叠（A/B）。切换动画时：
		//   1. 把目标动画 src 设到"当前非显示"的 video 上
		//   2. 等它 loadeddata 后再把 is-front 换过去（新淡入、旧淡出）
		//   3. frontRef 翻转，下次切换用另一个
		// 这样旧画面一直显示到新画面就绪，切换零空白帧。
		//
		// 竞态防护：快速连切时前一个可能还没加载完。每个切换有一个递增"代数"gen，
		// loadeddata 回调执行时检查自己是否还是最新代——不是就放弃，避免两个视频
		// 都被移除 is-front 而全部透明（宠物消失）。
		//
		// endedRef：一次性动画播完的回调（随渲染更新，play 时取最新引用）。
		function useVideoLayer(videoARef, videoBRef, endedRef) {
			var frontRef = useRef(0);       // 当前显示：0=A, 1=B
			var pendingRef = useRef(null);  // 加载中的 {anim, once, gen}
			var genRef = useRef(0);         // 切换代数

			return useCallback((anim, once, onReady) => {
				// 同一动画还在加载中：直接跳过（避免重复加载）
				var pending = pendingRef.current;
				if (pending && pending.anim === anim && pending.once === once) return;
				var gen = ++genRef.current;
				pendingRef.current = { anim, once, gen };

				// 目标 video = 当前非显示的那个（front 是 A 就用 B，反之用 A）
				var target = frontRef.current === 0 ? videoBRef : videoARef;
				var el = target.current;
				if (!el) {
					// 组件未挂载（visible=false 时 return null）：不能留下 pending 记录，
					// 否则恢复显示后同 (anim, once) 的重放会被开头的去重守卫吞掉，
					// 重建的 video 拿不到 src（宠物隐身）
					pendingRef.current = null;
					return;
				}

				el.src = animUrl(anim);
				el.loop = !once;                          // 一次性动画不循环
				el.muted = true;
				el.autoplay = true;
				el.playsInline = true;
				el.onended = once ? endedRef.current : undefined;
				el.load();

				var onReadyHandler = () => {
					el.removeEventListener('loadeddata', onReadyHandler);
					// 过期检查：期间又有更新的切换，本回调作废
					if (!pendingRef.current || pendingRef.current.gen !== gen) return;
					// 交换前后台：新视频加 is-front（淡入），旧视频移除（淡出）并暂停（避免隐藏循环空转）
					var old = frontRef.current === 0 ? videoARef : videoBRef;
					el.classList.add('is-front');
					if (old.current && old.current !== el) {
						old.current.classList.remove('is-front');
						old.current.pause();
					}
					frontRef.current = frontRef.current === 0 ? 1 : 0;
					pendingRef.current = null;
					failedAnims.delete(anim); // 加载成功：解除失败冷却（文件恢复后立即可用）
					el.play().catch(() => {});
					// 如果这是"计划中的移动"的动画，现在动画就绪，开始驱动位移
					if (onReady) onReady(el);
				};
				el.addEventListener('loadeddata', onReadyHandler);
				// 资源加载失败兜底（死 id/404/瞬时断网）：loadeddata 永不触发会卡死
				// 行为链（pending 永久挂起）。失败时清 pending 并把该动画记入失败
				// 冷却（pickFrom 后续剔除，防止多个悬空自定义 id 交替失败无限循环）；
				// 非待机动画经 ended 链推进一次（待机失败则静默，避免断网时
				// IDLE→error→IDLE 无限递归）。下次任何播放调用都能恢复。
				var onError = () => {
					el.removeEventListener('error', onError);
					if (!pendingRef.current || pendingRef.current.gen !== gen) return;
					pendingRef.current = null;
					failedAnims.set(anim, Date.now());
					if (anim !== IDLE && endedRef.current) endedRef.current();
				};
				el.addEventListener('error', onError);
				// 视频已缓存就绪（readyState>=2）时立即触发
				if (el.readyState >= 2) onReadyHandler();
			}, [videoARef, videoBRef]);
		}

		// ============================================================================
		// 配置系统—— 默认值 + 用户配置合并 + 配置存储
		// ============================================================================
		// 配置来源：宿主 settings 命名空间 'whale-pet'（settings.yaml），
		// 经 api.settings.describe() 读取。mergeConfig 把用户值叠加到代码默认值上
		// （只认已知键，防御手写 settings.yaml 的脏数据）。
		var INTENT_CFG_KEY = {
			WORKING: 'working', CODING: 'coding', READING: 'reading',
			RESEARCHING: 'researching', THINKING: 'thinking',
			WAITING_USER: 'waitingUser', LISTENING: 'listening', ERROR: 'error',
		};
		var DEFAULT_CONFIG = {
			visible: true,
			bubbles: true,
			meter: false,
			size: 462,
			position: 'bottom-right',
			scope: 'current',
			behavior: {
				idleProb: 0.30, turnProb: 0.10, actProb: 0.40, moveProb: 0.20,
				debounceMs: 500, lingerMs: 1500, errorHoldMs: 3000,
			},
			intents: {
				working: INTENT_ACTIONS.WORKING.slice(),
				coding: INTENT_ACTIONS.CODING.slice(),
				reading: INTENT_ACTIONS.READING.slice(),
				researching: INTENT_ACTIONS.RESEARCHING.slice(),
				thinking: INTENT_ACTIONS.THINKING.slice(),
				waitingUser: INTENT_ACTIONS.WAITING_USER.slice(),
				listening: INTENT_ACTIONS.LISTENING.slice(),
				error: INTENT_ACTIONS.ERROR.slice(),
			},
		pools: {
			acts: ACTS.slice(),
			moves: MOVES.slice(),
			clicks: CLICKS.slice(),
		},
		rules: [],
	};
		// 用户值 → 完整配置（深拷贝默认值 + 覆盖已知键；未加载时返回 null）
		function mergeConfig(user) {
			var c = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
			if (!user || typeof user !== 'object') return c;
			if (typeof user.visible === 'boolean') c.visible = user.visible;
			if (typeof user.bubbles === 'boolean') c.bubbles = user.bubbles;
			if (typeof user.meter === 'boolean') c.meter = user.meter;
			if (typeof user.size === 'number') c.size = user.size;
			if (['bottom-left', 'bottom-right', 'top-left', 'top-right'].indexOf(user.position) !== -1) c.position = user.position;
			if (user.scope === 'current' || user.scope === 'any') c.scope = user.scope;
			if (user.behavior && typeof user.behavior === 'object') {
				for (var k in c.behavior) {
					if (typeof user.behavior[k] === 'number') c.behavior[k] = user.behavior[k];
				}
			}
		for (var g of ['intents', 'pools']) {
			if (user[g] && typeof user[g] === 'object') {
				for (var k2 in c[g]) {
					if (Array.isArray(user[g][k2])) {
						// 迁移：旧中文动画名 → 新英文 id（normalizeAnimId 未知值原样保留）
						c[g][k2] = user[g][k2].map(normalizeAnimId);
					}
				}
			}
		}
		// 触发规则：normalizeRules 清洗（非法规则整条丢弃，安全形状钳制）
		if (Array.isArray(user.rules)) c.rules = normalizeRules(user.rules);
		return c;
		}

		// 配置存储：加载（describe）+ 订阅（宠物/设置卡片热更新）
		function createConfigStore(api) {
			var value = null;       // 合并后的完整配置；null = 未加载（调用方走代码默认）
			var listeners = new Set();
			var loading = null;
			var retried = false;    // 命名空间未就绪时的延时重试（宿主 ctx.inject 可能晚于客户端加载）
			function publish(next) {
				value = mergeConfig(next);
				listeners.forEach((fn) => fn(value));
				return value;
			}
			function load() {
				if (!api || !api.settings || loading) return loading;
				var attempt = () => {
					loading = api.settings.describe({})
						.then((res) => {
							var payload = (res && res.result && res.result.ok) ? res.result.value : null;
							var list = (payload && payload.namespaces) || [];
							var ns = list.find((n) => n.ns === 'whale-pet');
							publish(ns ? ns.value : null);
							// 命名空间缺失或加载失败：2s 后重试一次（宿主注册/连接可能晚于本次调用）
							if (!ns && !retried) {
								retried = true;
								setTimeout(() => { load(); }, 2000);
							}
							return value;
						})
						.catch(() => {
							value = null;
							if (!retried) {
								retried = true;
								setTimeout(() => { load(); }, 2000);
							}
						})
						.finally(() => { loading = null; });
				};
				attempt();
				return loading;
			}
		return {
			get() { return value; },
			load,
			// 设置表单先在客户端发布完整草稿，让显示类选项无需等待防抖保存。
			set(next) { return publish(next); },
			subscribe(fn) {
				listeners.add(fn);
				return () => listeners.delete(fn);
			},
		};
	}

	// 自定义动作存储（资源层）：fetch /whale-pet/api/actions →
	// 更新注册表（setCustomAnims）+ 通知订阅者（宠物/设置卡片共享一个实例）。
	// 失败静默（目录可能还没有文件/服务未就绪），卡片刷新或重新打开时重试。
	function createCustomStore() {
		var value = { actions: [], display: null };
		var listeners = new Set();
		var loading = null;
		function load() {
			if (loading) return loading;
			loading = fetch('/whale-pet/api/actions')
				.then((r) => r.json())
				.then((d) => {
				if (d && d.ok && Array.isArray(d.actions)) {
					value = { actions: d.actions, display: d.display || null };
						setCustomAnims(d.actions);
						listeners.forEach((fn) => fn(value));
					}
				})
				.catch(() => { /* 静默：保持上次清单 */ })
				.finally(() => { loading = null; });
			return loading;
		}
		return {
			get() { return value; },
			upload(file) {
				if (!file || typeof file.name !== 'string') return Promise.reject(new Error('invalid-file'));
				return fetch('/whale-pet/api/actions/upload?name=' + encodeURIComponent(file.name), {
					method: 'POST',
					headers: { 'content-type': file.type || 'application/octet-stream' },
					body: file,
				}).then((r) => r.json().catch(() => ({ ok: false, error: r.status === 404 ? 'upload-api-unavailable' : 'upload-failed' })))
					.then((d) => {
						if (!d || !d.ok) throw new Error((d && d.error) || 'upload-failed');
						return load().then(() => d.action);
					});
			},
			remove(id) {
				var action = value.actions.find((item) => item.id === id);
				if (!action || !action.file) return Promise.reject(new Error('file-not-found'));
				return fetch('/whale-pet/api/actions/delete?name=' + encodeURIComponent(action.file), { method: 'DELETE' })
					.then((r) => r.json().catch(() => ({ ok: false, error: r.status === 404 ? 'delete-api-unavailable' : 'delete-failed' })))
					.then((d) => {
						if (!d || !d.ok) throw new Error((d && d.error) || 'delete-failed');
						return load().then(() => d.action);
					});
			},
			load: load,
			subscribe(fn) {
				listeners.add(fn);
				return () => listeners.delete(fn);
			},
		};
	}

		// ============================================================================
		// 意图仲裁器（决策层）—— 工厂函数，纯逻辑 + setTimeout 调度
		// ============================================================================
		// 输入：活跃意图集合（感知层持续更新）；输出：当前应播放的意图。
		// 时序语义：
		//   - 升级（更高优先级意图出现）：debounceMs 后应用（工具快速连发不抖动）
		//   - 降级（当前意图消退）：lingerMs 后应用（动作不闪断）
		//   - 调度期间活跃集合再变：用最新集合重算（timer 刷新）
		// 应用时通过 subscribe 监听器通知（播放器抢占动作）。
		function createArbiter(opts) {
			var current = INTENT.IDLE;
			var timer = null;
			var listeners = new Set();
			var active = {};

		var applyNow = () => {
			timer = null;
			var next = highestIntent(active, opts.ruleMeta);
			if (next !== current) {
				current = next;
				listeners.forEach((fn) => fn(next));
			}
		};
		return {
			get current() { return current; },
			// 感知层每次活跃集合变化时调用
			update(nextActive) {
				active = nextActive;
				var raw = highestIntent(active, opts.ruleMeta);
					if (raw === current) {
						if (timer) { clearTimeout(timer); timer = null; }
						return;
					}
					// 动态读 opts（设置保存后无需重建仲裁器即生效）
					var delay = intentPriorityOf(raw, opts.ruleMeta) > intentPriorityOf(current, opts.ruleMeta)
						? opts.debounceMs : opts.lingerMs;
					if (timer) clearTimeout(timer);
					timer = setTimeout(applyNow, delay);
				},
				subscribe(fn) {
					listeners.add(fn);
					return () => listeners.delete(fn);
				},
				dispose() {
					if (timer) clearTimeout(timer);
					timer = null;
					listeners.clear();
				},
			};
		}

		// ============================================================================
		// 活动传感器（感知层）—— 订阅官方事件流，产出意图活跃集合
		// ============================================================================
		// 用 connection 服务的 api.events 双流（host + mux）：
		//   - host 流：会话运行状态翻转、Agent 出错
		//   - mux 流：会话事件透传（tool/call、assistant/chunk…）+ 审批/问答帧
		// 帧 → applyFrame（纯函数）→ 活跃集合 → onState 回调（仲裁器消费）。
		// ERROR 为"脉冲"意图：激活 3 秒后自动消退（errorHoldMs）。
		// 流结束（非主动 abort）→ 2 秒后重开（断线重连）。
		// 返回清理函数：abort 流 + 清定时器。
		// @returns {() => void} dispose
	function startActivitySensor(api, onState, opts) {
		var ctrl = new AbortController();
		var state = emptyIntentState();
		var reconnectTimer = null;
		var errorTimer = null;
		var disposed = false;
		// 规则状态（matchRules 纯函数维护：lastFired=冷却记账，
		// lastToolByStep=tool/result 的工具名配对表）+ 脉冲摘除定时器
		var ruleState = { lastFired: {}, lastToolByStep: {} };
		var ruleTimers = {};

			var publish = () => {
				if (!disposed) onState(state);
			};
			var clearError = () => {
				errorTimer = null;
				if (state.active[INTENT.ERROR]) {
					state = { ...state, active: { ...state.active } };
					delete state.active[INTENT.ERROR];
					publish();
				}
			};
			var handle = (raw) => {
				// 解包 RpcRequest：api.events 流 yield 的是 { rpcId, payload: Frame }，
				// 业务字段（type/sessionId/event）都在 payload 里。
				var frame = (raw && raw.payload) ? raw.payload : raw;
				// 多会话感知范围过滤（scope=current 时只收当前会话帧）
				if (opts.filter && !opts.filter(frame)) return;
				// request/context 携带本次真实 provider/model；assistant/message 携带 usage。
				if (frame.type === 'session/event') {
					var ev0 = frame.event || {};
					if (opts.onModel && ev0.type === 'request/context' && ev0.data) opts.onModel(ev0.data);
					if (opts.onUsage && ev0.type === 'assistant/message' && ev0.data && ev0.data.usage) opts.onUsage(ev0.data.usage);
				}
			state = applyFrame(state, frame, Date.now());
			// 触发规则：applyFrame 之后匹配（读取器函数热更新——设置保存
			// 即生效，无需重建事件流）。命中 → 激活 rule:<id> 意图 + holdMs
			// 脉冲摘除（重触发刷新保持窗口；同 ERROR 的 errorTimer 模式）
			if (opts.rules) {
				var ruleList = typeof opts.rules === 'function' ? opts.rules() : opts.rules;
				if (ruleList && ruleList.length) {
					var nowMs = Date.now();
					var mr = matchRules(ruleList, frame, ruleState, nowMs);
					ruleState = mr.state;
					for (var fi = 0; fi < mr.fired.length; fi++) {
						var fr = mr.fired[fi];
						var iid = RULE_PREFIX + fr.id;
						state = { ...state, active: { ...state.active, [iid]: nowMs } };
						if (opts.onRuleFired) opts.onRuleFired(fr.id, nowMs);
						if (ruleTimers[iid]) clearTimeout(ruleTimers[iid]);
						ruleTimers[iid] = setTimeout((function (iid2, holdMs2) {
							return function () {
								delete ruleTimers[iid2];
								if (state.active[iid2]) {
									state = { ...state, active: { ...state.active } };
									delete state.active[iid2];
									publish();
								}
							};
						})(iid, fr.holdMs), fr.holdMs ?? 3000);
					}
				}
			}
			// ERROR 脉冲：激活后 errorHoldMs 自动消退（动态读 opts；支持函数——
				// 传入 arbOptsRef 读取器，设置自动保存即热生效，无需重建事件流）
				if (state.active[INTENT.ERROR] && !errorTimer) {
					var holdMs = typeof opts.errorHoldMs === 'function' ? opts.errorHoldMs() : opts.errorHoldMs;
					errorTimer = setTimeout(clearError, holdMs ?? 3000);
				}
				publish();
			};
			var consume = async (openStream, gen) => {
				try {
					for await (var frame of openStream()) handle(frame);
				} catch (e) {
					// 流中断（含 abort）：统一走下面的重连判定
				}
				// 本代流已被新一轮 openStreams 取代（或已销毁）：不重连
				if (disposed || gen.signal.aborted) return;
				// 流正常结束或出错：延时重开。共享的重连定时器先清再排——
				// 双流同时断开时这里会各到一次，不清旧定时器会排两个
				// openStreams()，每开一对新流 → 订阅对翻倍（帧重复雪崩）
				if (reconnectTimer) clearTimeout(reconnectTimer);
				reconnectTimer = setTimeout(() => {
					reconnectTimer = null;
					openStreams();
				}, opts.reconnectMs || 2000);
			};
			var openStreams = () => {
				if (disposed) return;
				// abort 上一代流再开新的：单流断开重连时不复制仍健康的另一条
				ctrl.abort();
				ctrl = new AbortController();
				var gen = ctrl;
				consume(() => api.events.host({}, gen.signal), gen);
				consume(() => api.events.mux({}, gen.signal), gen);
			};
			openStreams();

		return () => {
			disposed = true;
			ctrl.abort();
			if (reconnectTimer) clearTimeout(reconnectTimer);
			if (errorTimer) clearTimeout(errorTimer);
			for (var k in ruleTimers) clearTimeout(ruleTimers[k]);
			ruleTimers = {};
		};
		}

		// ============================================================================
		// WhalePet 组件 —— 宠物本体
		// ============================================================================
		// 职责：
		// 1. 渲染"双缓冲"的一对 <video>，切换动画交叉淡入，永无空白帧
		// 2. 行为链：待机 →（每次播完按概率）→ 待机/转向/动作/移动；点击/拖拽可打断
		// 3. 朝向（facing）：right 时视频水平镜像
		//
		// config：来自 patch 配置（兜底）。api：connection 服务的 api 对象（事件感知；
		// 缺失时退化为纯自主链桌宠）。store：设置配置存储（null = 走代码默认）。
		// customStore：自定义动作存储（null = 不支持自定义动作）。
		function WhalePet({ config, api, store, locale, customStore, ruleRuntime, useSessions }) {
			// ---- 设置配置：订阅配置存储，热生效 ----
			// cfg = 完整合并配置（默认值+用户值）；未加载成功前为 null（走代码默认）
			var [cfg, setCfg] = useState(store ? store.get() : null);
		useEffect(() => {
			if (!store) return;
			var un = store.subscribe((v) => { setCfg(v); });
			store.load();
			return un;
		}, [store]);
			// 资源层：加载自定义动作清单（animUrl 解析自定义 id 依赖此注册表）
			useEffect(() => {
				if (customStore) customStore.load();
			}, [customStore]);
			// 右键菜单：{ x, y } 视口坐标；null = 关闭。
			// 声明必须在其下方关闭 effect 之前：deps 数组在渲染期此处求值，
			// 若先用后声明（var 提升），deps 恒为 [undefined]，effect 永不重跑
			var [menu, setMenu] = useState(null);
			// 右键菜单：点击别处 / Esc / 缩放 / 失焦时关闭
			useEffect(() => {
				if (!menu) return;
				var onDown = (e) => {
					if (menuRef.current && menuRef.current.contains(e.target)) return;
					setMenu(null);
				};
				var onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
				window.addEventListener('click', onDown);
				window.addEventListener('keydown', onKey);
				window.addEventListener('resize', closeMenu);
				window.addEventListener('blur', closeMenu);
				return () => {
					window.removeEventListener('click', onDown);
					window.removeEventListener('keydown', onKey);
					window.removeEventListener('resize', closeMenu);
					window.removeEventListener('blur', closeMenu);
				};
			}, [menu]);
			var cfgRef = useRef(cfg);
			cfgRef.current = cfg;
			// 仲裁/感知参数引用（渲染时同步，effect 内动态读取 → 保存即生效不重建流）
		var arbOptsRef = useRef({ debounceMs: 500, lingerMs: 1500, errorHoldMs: 3000, ruleMeta: {} });
		var bNow = (cfg && cfg.behavior) || DEFAULT_CONFIG.behavior;
		arbOptsRef.current.debounceMs = bNow.debounceMs;
		arbOptsRef.current.lingerMs = bNow.lingerMs;
		arbOptsRef.current.errorHoldMs = bNow.errorHoldMs;
		// 规则元数据：{ 'rule:<id>': rule }——渲染期重建，仲裁器/意图回调
		// 经引用动态读取（设置自动保存即热生效；与 arbOptsRef 同一就地更新模式）
		var rulesList = (cfg && Array.isArray(cfg.rules)) ? cfg.rules : [];
		var ruleMeta = {};
		for (var rmi = 0; rmi < rulesList.length; rmi++) ruleMeta[RULE_PREFIX + rulesList[rmi].id] = rulesList[rmi];
		var ruleMetaRef = useRef(ruleMeta);
		ruleMetaRef.current = ruleMeta;
		arbOptsRef.current.ruleMeta = ruleMeta;
			// 全局槽位标准属性会注入 useSessions；直接订阅当前会话，既用于
			// scope=current 过滤，也用于页面初次打开时预取该会话的模型余额。
			var currentSession = typeof useSessions === 'function'
				? useSessions((sessions) => sessions.current) : undefined;
			var currentSessionRef = useRef(null);
			currentSessionRef.current = currentSession;
			// 统计气泡文案翻译（bind 返回稳定引用，useCallback 闭包安全）
			var tPet = useTranslate(locale);
			// 当前 locale（气泡语言；通过 useTranslate 的订阅重渲染保持最新）
			var localeNowRef = useRef('zh');
			if (locale) {
				var snap = null;
				try { snap = locale.getSnapshot ? locale.getSnapshot() : null; } catch (e) { snap = null; }
				localeNowRef.current = (snap && snap.active) || 'zh';
			}

			// ---- 显示参数（设置配置优先，patch 配置兜底，最后代码默认） ----
			var size = (cfg && cfg.size) || (config && config.size) || 462;                 // 舞台宽度（px），高 = 宽×9/16 ≈ 260
			var corner = (cfg && cfg.position) || (config && config.position) || 'bottom-right'; // 默认角落
			var halfW = size / 2;
			var halfH = size * 9 / 16 / 2;
			var stageH = size * 9 / 16;
			// 人物视觉中心（像素加权重心）相对根容器左上角的 Y 偏移：
			// 落地对齐（脚底 FEET_Y 对齐底边）+ 人物重心在画布中偏下。
			// 注意不能用 HIT_BOX 的 bbox 几何中心（≈192.5）——那是框的几何中点；
			// 人物像素分布不均匀（头部像素少、身体/裙摆像素多），实测重心 y≈206~209。
			var charCenterY = ((CANVAS_H - FEET_Y) + 209) / CANVAS_H * stageH;
			// 人物中心相对"舞台几何中心"(halfH) 的 Y 偏移——点击移动时目标点需补偿，
			// 让点击点对齐"人物中心"而非舞台（视频边框）中心。
			var charCenterOffsetY = charCenterY - halfH;

			// ---- 停靠/召回的"可抓取可见条"（px，随 size 缩放） ----
			// 停靠（部分出屏）与召回（完全隐藏后沿边缘露出）都保留一条可见区域，
			// 且必须与命中框重叠，否则宠物露出来也点不到、无法拖回。
			// 命中框按画布比例定位（x:200~440、y:50~335），随 size 增大外移，
			// 可见条必须同样缩放：固定 200px 在 size≥640 时命中框整体在屏外。
			//   - 横向：x0/CANVAS_W*size + 55px 重叠余量（默认 462 → ≈200px，与旧值一致）
			//   - 纵向：y0/CANVAS_H*stageH + 54px 重叠余量（默认 462 → ≈90px）
			var keepVisibleX = HIT_BOX.x0 / CANVAS_W * size + 55;
			var keepVisibleY = HIT_BOX.y0 / CANVAS_H * stageH + 54;
			// 把舞台左/上边缘钳制到"至少保留可见条在屏内"的范围：
			//   left ∈ [keepVisibleX - size, innerWidth - keepVisibleX]
			//   top  ∈ [keepVisibleY - stageH, innerHeight - keepVisibleY]
			var clampLeft = (v) => Math.min(Math.max(v, keepVisibleX - size), window.innerWidth - keepVisibleX);
			var clampTop = (v) => Math.min(Math.max(v, keepVisibleY - stageH), window.innerHeight - keepVisibleY);

			// ---- React 状态 ----
			// playing 单一对象：anim=动画名、once=是否一次性、seq=播放序号。
			// seq 每次切换 +1：即使连续选中同一动画，对象变化也能强制重播。
			var [playing, setPlaying] = useState({ anim: IDLE, once: true, seq: 0 });
			// 文字气泡：{ text, seq }；seq 用于同文案重复触发时强制重建动画
			var [bubble, setBubble] = useState(null);
			var [facing, setFacing] = useState('left');       // 朝向：left | right
			var [dragging, setDragging] = useState(false);    // 是否正在拖拽
			// 选中态（左键单击宠物进入"目标移动"模式：再点屏幕让宠物走过去）
			var [selected, setSelected] = useState(false);
			// 自定义位置（拖拽/移动后停留的视口比例坐标）；null = 回默认角落
			var [customPos, setCustomPos] = useState(null);
			// 惯性滑行中：位置由 rAF 直接写 inline style，rootStyle 回填 livePosRef
			var [sliding, setSliding] = useState(false);

			// ---- 完全隐藏状态 ----
			// hide：{ active, edge }——宠物被整体拖出屏幕后进入隐藏；edge 记录隐藏边缘
			// peek：隐藏时指针靠近所在边缘 → 露出可见条（召回），便于抓回
			var [hide, setHide] = useState({ active: false, edge: null });
			var [peek, setPeek] = useState(false);
			var hideRef = useRef(hide);
			hideRef.current = hide;
			var pointerRef = useRef({ x: -1, y: -1 }); // 最近一次指针位置（召回露出时跟随）

			// ---- DOM 引用 ----
			var rootRef = useRef(null);    // 根容器（fixed 定位）
			var stageRef = useRef(null);   // 内部舞台（落地对齐）
			var videoARef = useRef(null);  // 视频 A
			var videoBRef = useRef(null);  // 视频 B

			// ---- 交互/异步读取用的 ref 镜像 ----
			var animRef = useRef(playing.anim);
			animRef.current = playing.anim;
			var facingRef = useRef(facing);
			facingRef.current = facing;
			var customPosRef = useRef(customPos);
			customPosRef.current = customPos;
			var dragRef = useRef({ active: false, dragging: false, sx: 0, sy: 0, offX: 0, offY: 0 });
			var justDraggedRef = useRef(false); // 刚拖完（抑制拖拽后的"幽灵点击"）
			// ---- 交互增强 ref ----
			var hoverRef = useRef({ active: false, facing: null }); // 悬停注视：记录进入前朝向
			var lastClickAtRef = useRef(0);   // 上次宠物点击时间（双击判定）
			var dragSamplesRef = useRef([]);  // 拖拽指针采样（惯性速度估算）
			var menuRef = useRef(null);       // 右键菜单 DOM
			// 拖拽/惯性期间的最新指令式位置（px）。rootStyle 在 dragging/sliding
			// 期间回填此值：若返回 {}，React 会清掉上一次 style prop 里的
			// left/top，宠物闪回 data-corner 默认角落（拖拽起点瞬移）
			var livePosRef = useRef(null);

			// ---- 移动引擎 ref ----
			var moveRef = useRef(null);        // 移动中的 rAF id
			var moveTokenRef = useRef(0);      // 移动令牌：每次取消 +1 使旧回调失效
			var pendingMoveRef = useRef(null); // 计划中的移动 {startX,startY,targetX,targetY,dir}（比例制）
			var greetAfterMoveRef = useRef(false); // 点击目标移动到达后打招呼标记
			// 惯性滑行：{token, raf, active, cx, cy}——cx/cy 为舞台中心当前位置
			var inertiaRef = useRef({ token: 0, raf: null, active: false, cx: 0, cy: 0 });

			// ---- 意图系统 ref ----
			var intentRef = useRef(INTENT.IDLE);    // 仲裁器当前意图（异步回调读取）
			var intentActionsRef = useRef([]);      // 当前意图的动作池
			var intentActionRef = useRef(null);       // 当前事件意图的一次性动作 { intent, anim, completed }
			// ---- 播放辅助：切到指定动画（seq 自增保证重播） ----
			var playNext = useCallback((anim, once) => {
				setPlaying((p) => ({ anim, once, seq: p.seq + 1 }));
			}, []);
			// 气泡辅助：显示一句文案（seq 变化强制重建动画；关闭时忽略）
			var showBubble = useCallback((text) => {
				var c = cfgRef.current;
				if (!text || (c && c.bubbles === false)) return;
				setBubble({ text: text, seq: Date.now(), sticky: false });
			}, []);
			// 余额气泡只展示服务商官方接口返回的金额，不进行本地费用估算。
			// 金额保持字符串形式，避免浮点转换造成精度损失。
			var currentModelRef = useRef({ route: null, model: null });
			var meterBalanceRef = useRef({ at: 0, status: 'waiting', providerLabel: null, balances: null });
			// 已预取过模型选择的会话 id（避免每次渲染/切换重复调 session.models）
			var modelSessionRef = useRef(null);
			var showMeterBubble = useCallback(() => {
				var c = cfgRef.current;
				if (!c || c.meter === false) return;
				var mb = meterBalanceRef.current;
				var amount = mb.status === 'waiting' ? tPet('meterWaiting')
					: (mb.status === 'unsupported' ? tPet('meterUnsupported')
						: (mb.status === 'error' ? tPet('meterFailed')
							: (mb.balances ? mb.balances.map((item) => item.currency + ' ' + item.total).join(' · ') : '…')));
				var text = tPet('meterBalance') + (mb.providerLabel ? mb.providerLabel + ' · ' : '') + amount;
				// 常驻气泡：sticky=true，不自动消失
				setBubble({ text: text, seq: Date.now(), sticky: true });
			}, []);
			// 余额节流拉取（30s，与宿主侧缓存一致；失败 5s 后允许重试）：
			// meter 开启、token 用量累计（余额随消耗变化）时触发，避免
			// 一次性预取失败后气泡永远停在占位符
			var refreshBalance = useCallback(() => {
				var mb = meterBalanceRef.current;
				var target = currentModelRef.current;
				if (!target.route) return;
				var now = Date.now();
				if (now - mb.at < 30000) return;
				mb.at = now;
				var query = '?route=' + encodeURIComponent(target.route) + '&model=' + encodeURIComponent(target.model || '');
				fetch('/whale-pet/api/balance' + query)
					.then((r) => r.json())
					.then((d) => {
						if (d && d.ok && Array.isArray(d.balances) && d.balances.length) {
							mb.status = 'ready';
							mb.providerLabel = d.providerLabel || d.provider || target.route;
							mb.balances = d.balances;
							showMeterBubble(); // 余额到了，刷新常驻气泡
						} else if (d && d.unsupported) {
							mb.status = 'unsupported';
							mb.providerLabel = d.route || target.route;
							showMeterBubble();
						} else {
							mb.status = 'error';
							mb.at = now - 25000; // 失败（未配 key/接口错误）：5s 后可重试
							showMeterBubble();
						}
					})
					.catch(() => {
						mb.at = now - 25000;
						if (meterBalanceRef.current === mb) {
							mb.status = "error";
							showMeterBubble();
						}
					});
			}, []);

			// ---- 余额模型采纳（启动预取与真实调用上下文共用） ----
			// 采纳某个 provider/model 作为计费模型；模型变化时重置余额缓存并
			// 立即拉取。返回 true 表示（已）是最新选择。
			var adoptModel = useCallback((route, model) => {
				if (!route || !model) return false;
				var prev = currentModelRef.current;
				if (prev.route === route && prev.model === model) return true;
				currentModelRef.current = { route: route, model: model };
				meterBalanceRef.current = { at: 0, status: 'loading', providerLabel: route, balances: null };
				if (cfgRef.current && cfgRef.current.meter) { showMeterBubble(); refreshBalance(); }
				return true;
			}, [showMeterBubble, refreshBalance]);

			// ---- 余额模型预取（resolveSessionModel）----
			// 启动/会话切换时直接查当前会话的模型选择（api.sessions.models，读的
			// 是会话选择/默认模型，无需先发生一次模型调用）；成功经 adoptModel
			// 立即拉余额并刷新常驻气泡；失败且尚无模型时回退"等待模型调用"
			// （request/context 事件兜底）。
			var resolveSessionModel = useCallback(() => {
				var fallbackWaiting = () => {
					if (!currentModelRef.current.route && cfgRef.current && cfgRef.current.meter) {
						meterBalanceRef.current = { at: 0, status: 'waiting', providerLabel: null, balances: null };
						showMeterBubble();
					}
				};
				if (!api || !api.sessions || typeof api.sessions.models !== 'function') {
					fallbackWaiting();
					return Promise.resolve(false);
				}
				var sessionId = currentSessionRef.current;
				if (!sessionId) {
					fallbackWaiting();
					return Promise.resolve(false);
				}
				return api.sessions.models({ sessionId }).then((res) => {
					var selection = parseSessionModelSelection(res && res.result && res.result.ok ? res.result.value : null);
					if (!selection) { fallbackWaiting(); return false; }
					return adoptModel(selection.route, selection.model);
				}).catch(() => { fallbackWaiting(); return false; });
			}, [api, adoptModel, showMeterBubble]);

			// ---- 一次性动画播完的回调（endedRef 由 useVideoLayer 在 play 时读取） ----
			var endedRef = useRef(null);
			endedRef.current = () => {
				if (dragRef.current.active) return; // 拖拽中：不打断
				var cur = animRef.current;
				if (cur === TURN) {
					// 东张西望播完 → 翻转朝向
					setFacing((f) => (f === 'left' ? 'right' : 'left'));
				}
				// 用户打断触发的动画（点击回应/拖拽）播完 → 先回待机缓冲
				var clicks = (cfgRef.current && cfgRef.current.pools && cfgRef.current.pools.clicks) || CLICKS;
				if (cur === DRAG || clicks.indexOf(cur) !== -1) {
					playNext(IDLE, true);
					return;
				}
				// 移动动画播完：点击目标移动 → 打招呼并取消选中；自主漫游 → 进行为链
				if (MOVES.indexOf(cur) !== -1 || cur === TARGET_MOVE_ANIM) {
					if (greetAfterMoveRef.current) {
						greetAfterMoveRef.current = false;
						setSelected(false); // 到达后取消选中
						playNext(GREET_ANIM, true); // 打招呼
						return;
					}
					pickNext();
					return;
				}
				// 每次事件意图只完整播放一个动作；行为仍持续时转入自主链，
				// 后续新事件产生新意图后再切换，不重复当前映射动作。
				var intent = intentRef.current;
				var intentAction = intentActionRef.current;
				if (intentAction && !intentAction.completed && intentAction.anim === cur) {
					intentAction.completed = true;
					pickNext();
					return;
				}
				// 自主链动画播完 → 按概率选下一个
				pickNext();
			};

			// ---- 双缓冲层 ----
			var play = useVideoLayer(videoARef, videoBRef, endedRef);

			// ---- 行为链：每次动画播完 → 按概率选下一个 ----
			// 链式模型（无常驻待机定时器）：每个动画（含待机）都是一次性播放，
			// 播完按概率选下一个；概率与动作池读设置配置，缺省用代码默认。
			// 点击/拖拽打断的动画播完后先回待机（缓冲），待机播完再进随机链。
			var pickNext = () => {
				var b = (cfgRef.current && cfgRef.current.behavior) || DEFAULT_CONFIG.behavior;
				var acts = (cfgRef.current && cfgRef.current.pools && cfgRef.current.pools.acts) || ACTS;
				var moves = (cfgRef.current && cfgRef.current.pools && cfgRef.current.pools.moves) || MOVES;
				var roll = Math.random();
				if (roll < b.idleProb) {
					// 低频闲聊气泡（25%；统计开关开启时不显示）
					var cIdle = cfgRef.current;
					if (!(cIdle && cIdle.meter)) {
						var langIdle = localeNowRef.current;
						var idleTexts = BUBBLES[langIdle] && BUBBLES[langIdle].idle;
						if (idleTexts && idleTexts.length && Math.random() < 0.25) {
							showBubble(idleTexts[Math.floor(Math.random() * idleTexts.length)]);
						}
					}
					playNext(IDLE, true);
				} else if (roll < b.idleProb + b.turnProb) {
					playNext(TURN, true);
			} else if (roll < b.idleProb + b.turnProb + b.actProb) {
				// 动作池为空/全悬空/仅剩当前动画时回落待机（避免播空 URL 卡死）
				playNext(pickFrom(acts, playing.anim) || IDLE, true);
			} else {
				// 移动概率：先试"走向光标附近"（FOLLOW_CHANCE 比例），再朝 facing
				// 漫游；空间不够/配置移动池为空则回退随机动作。
				// prefers-reduced-motion 用户关闭自主漫游（显式点击移动/拖拽不受影响）
				if (moves.length && !prefersReducedMotion()) {
					if (Math.random() < FOLLOW_CHANCE && tryFollowPointer()) return;
					if (tryPlanMove()) return;
				}
				playNext(pickFrom(acts, playing.anim) || IDLE, true);
			}
		};

			// ---- 状态驱动播放：playing 一变就切换视频 ----
			useEffect(() => {
				play(playing.anim, playing.once, (el) => {
					// 按当前朝向设置新视频镜像（inline transform，不依赖全局 CSS）：
					// 旧视频保持自己的 transform 淡出，两者互不影响；
					// onReady 时 facingRef 已是翻转后的值（setFacing 的渲染先于本回调）
					el.style.transform = animFacingTransform(playing.anim, facingRef.current);
					if (pendingMoveRef.current) startDrive(el);
				});
			}, [playing]);

			// ---- 显示开关恢复（false→true）：visible=false 时组件 return null 卸载了
			// 两个 <video>，重新开启后元素是新建的（src 为空）；此时 playing 未变，
			// 上面的播放 effect 不会重跑，需在此重新加载当前动画。 ----
			var prevVisibleRef = useRef(true);
			useEffect(() => {
				var visibleNow = !cfg || cfg.visible !== false;
				var was = prevVisibleRef.current;
				prevVisibleRef.current = visibleNow;
				if (visibleNow && !was) {
					play(playing.anim, playing.once, (el) => {
						el.style.transform = animFacingTransform(playing.anim, facingRef.current);
						if (pendingMoveRef.current) startDrive(el);
					});
				}
			}, [cfg && cfg.visible, playing]);

			// ---- 事件感知 + 意图仲裁（感知层 → 决策层 → 播放器） ----
			// 有 api（connection 服务）才接入；缺失时退化为纯自主链桌宠。
			// 仲裁器输出意图时抢占播放对应动作；用户交互/交互动画进行中不抢占。
			// 参数经 arbOptsRef 动态读取（设置自动保存即热生效，不重建事件流）。
			useEffect(() => {
				if (!api || !api.events) return;
				var arbiter = createArbiter(arbOptsRef.current);
			var onIntent = (intent) => {
				var prev = intentRef.current;
				intentRef.current = intent;
				// 意图动作池：规则意图（rule:<id>）查规则元数据；内置意图
				// 配置显式值优先（空数组 = 回落自主链）；缺失才用代码默认。
				// 规则池按 animEntry 过滤（自定义动作可能已删除 → 悬空 id 剔除）
				var isRule = intent.lastIndexOf(RULE_PREFIX, 0) === 0;
				var ruleDef = isRule ? ruleMetaRef.current[intent] : null;
				var pool = null;
				var cfgNow = cfgRef.current;
				if (isRule) {
					pool = (ruleDef && Array.isArray(ruleDef.actions))
						? ruleDef.actions.filter((id) => !!animEntry(id))
						: [];
				} else {
					if (cfgNow && cfgNow.intents) pool = cfgNow.intents[INTENT_CFG_KEY[intent]];
					if (!Array.isArray(pool)) pool = INTENT_ACTIONS[intent] || [];
					// 悬空 id 剔除（自定义动作文件被直接删除/手写脏配置）：
					// 与规则池同策略，避免播放空 URL 卡死行为链
					pool = pool.filter((id) => !!animEntry(id));
				}
				intentActionsRef.current = pool;
				// 气泡：非 IDLE 意图切换时冒泡；余额开关开启时显示余额（替代文案）；
				// 规则意图优先用规则自定义气泡文案
				if (intent !== INTENT.IDLE) {
					var cNow = cfgRef.current;
					if (cNow && cNow.meter) {
						showMeterBubble();
					} else if (isRule && ruleDef && ruleDef.bubble) {
						showBubble(ruleDef.bubble);
					} else {
						var lang = localeNowRef.current;
						var poolTexts = BUBBLES[lang] && BUBBLES[lang][INTENT_CFG_KEY[intent]];
						if (poolTexts && poolTexts.length) showBubble(poolTexts[Math.floor(Math.random() * poolTexts.length)]);
					}
				}
					if (intent === INTENT.IDLE || !pool.length) {
						// 意图消退（或该意图池被清空）：仅从非 IDLE 回落时收尾。
						// 已完成的一次性意图动作已经进入自主链，不应再次切换；
						// 尚未完成则让当前视频自然播完。
						// 初始同步与重复通知不打断当前播放；被交互保护拦下的
						// 场景由点击回应/拖拽收尾的 ended 自然回链
						if (prev !== INTENT.IDLE) {
							var finishedAction = intentActionRef.current;
							if (finishedAction && finishedAction.intent === prev) {
								// 意图消退时：未播完则等待 onended；已播完则自主链已启动。
								// 两种情况都不能再次切换或重播。
								if (finishedAction.completed) intentActionRef.current = null;
								return;
							}
							intentActionRef.current = null;
							var clicksFade = (cfgRef.current && cfgRef.current.pools && cfgRef.current.pools.clicks) || CLICKS;
							if (dragRef.current.active || dragRef.current.dragging) return;
							if (animRef.current === DRAG || clicksFade.indexOf(animRef.current) !== -1) return;
							if (hideRef.current.active) return;
							pickNext();
						}
						return;
					}
					// 用户交互优先：拖拽中/交互动画播放中/隐藏中不抢占
					var clicksNow = (cfgRef.current && cfgRef.current.pools && cfgRef.current.pools.clicks) || CLICKS;
					if (dragRef.current.active || dragRef.current.dragging) return;
					if (animRef.current === DRAG || clicksNow.indexOf(animRef.current) !== -1) return;
					if (hideRef.current.active) return;
					var nextAnim = pickFrom(pool);
					if (!nextAnim) {
						// 防御：池已过滤仍无可播放动作 → 回落自主链（不打断当前播放）
						intentActionRef.current = null;
						if (prev !== INTENT.IDLE) pickNext();
						return;
					}
					intentActionRef.current = { intent: intent, anim: nextAnim, completed: false };
					playNext(nextAnim, intentActionIsOnce(intent)); // 所有事件意图每次只完整播放一个动作
				};
				var unsub = arbiter.subscribe(onIntent);
				// 初始同步一次当前意图（让 intentRef 就位）
				unsub && onIntent(INTENT.IDLE);
			var stop = startActivitySensor(api, (state) => arbiter.update(state.active), {
				errorHoldMs: () => arbOptsRef.current.errorHoldMs,
				// 触发规则：读取器模式（cfgRef 动态读，设置自动保存即热生效）
				rules: () => (cfgRef.current && cfgRef.current.rules) || [],
				onRuleFired: ruleRuntime ? (id, at) => ruleRuntime.notify(id, at) : null,
					// 当前真实模型上下文变化时切换计费服务商并刷新（与启动预取共用 adoptModel）
					onModel: (context) => {
						var route = context && typeof context.provider === 'string' ? context.provider : '';
						var model = context && typeof context.model === 'string' ? context.model : '';
						if (!route) return;
						adoptModel(route, model);
					},
					// 有新用量时节流刷新官方余额，不在本地估算费用。
					onUsage: () => {
						if (cfgRef.current && cfgRef.current.meter) {
							refreshBalance();
						}
					},
					// 多会话感知范围：scope=current 时只接受当前会话的帧（无当前会话则不过滤）
					filter: (frame) => {
						var c = cfgRef.current;
						if (!c || c.scope !== 'current') return true;
						var cur = currentSessionRef.current;
						if (!cur) return true;
						return frame.sessionId === undefined || frame.sessionId === cur;
					},
				});
				return () => {
					stop();
					unsub();
					arbiter.dispose();
				};
			}, [api]);

			// ---- 额度气泡常驻：meter 开启时显示常驻气泡并拉取余额；关闭时清除 ----
			useEffect(() => {
				if (!cfg) return;
				if (cfg.meter === false) {
					// meter 关闭：清除常驻额度气泡（不影响临时文字气泡）
					setBubble((b) => (b && b.sticky ? null : b));
					return;
				}
				// 开启时展示当前已识别模型的余额。尚无模型时不再干等首次模型调用：
				// 只要存在当前会话且 session.models 可用，就直接解析其模型选择并
				// 拉余额（见下方"余额模型预取"effect），此处仅显示 loading 态；
				// 确实无法解析（无会话/无接口）才显示"等待模型调用"。
				if (!currentModelRef.current.route) {
					var canResolve = !!currentSessionRef.current && !!(api && api.sessions && typeof api.sessions.models === 'function');
					meterBalanceRef.current = { at: 0, status: canResolve ? 'loading' : 'waiting', providerLabel: null, balances: null };
				}
				showMeterBubble();
				refreshBalance();
				// 也同步外部产生的消费；服务端仍有 30 秒缓存与限流保护。
				var balanceTimer = setInterval(refreshBalance, 31000);
				return () => clearInterval(balanceTimer);
			}, [cfg && cfg.meter]);

			// ---- 余额模型预取：当前会话出现/切换时直接解析其模型选择 ----
			// 打开 Harness 时默认会话即带模型，无需先调用一次模型（request/context）
			// 才能显示余额；解析失败允许下次会话变化时重试。
			useEffect(() => {
				var c = cfgRef.current;
				if (!c || c.meter !== true) return;
				var sessionId = currentSessionRef.current;
				if (!sessionId) return;
				if (modelSessionRef.current === sessionId) return;
				modelSessionRef.current = sessionId;
				resolveSessionModel().then((ok) => {
					if (!ok) modelSessionRef.current = null; // 失败：下次会话变化重试
				});
			}, [currentSession, cfg && cfg.meter]);

			// ---- 气泡定时消失（临时气泡 3.6s；常驻额度气泡 sticky 不自动消失） ----
			useEffect(() => {
				if (!bubble || bubble.sticky) return;
				var id = setTimeout(() => setBubble(null), 3600);
				return () => clearTimeout(id);
			}, [bubble]);

		// ---- 组件卸载：清理移动 rAF 与惯性滑行 ----
		useEffect(() => () => { stopDrive(); stopInertia(); }, []);

		// ---- 试触发：设置卡片的"试触发"按钮 → 立即播一次该规则动作池。
		// 经共享 ruleRuntime 解耦（设置卡片与宠物互不持引用）；显式用户
		// 操作，直接 playNext 不走仲裁器。卸载时注销。 ----
		useEffect(() => {
			if (!ruleRuntime) return;
			ruleRuntime.trigger = (actions, bubble) => {
				var pool = (actions || []).filter((id) => !!animEntry(id));
				if (pool.length) playNext(pool[Math.floor(Math.random() * pool.length)], true);
				if (bubble) showBubble(bubble);
			};
			return () => { ruleRuntime.trigger = null; };
		}, [ruleRuntime]);

			// ---- 窗口尺寸变化：重算比例位置（宠物保持相对窗口位置） ----
			useEffect(() => {
				var onResize = () => {
					setCustomPos((prev) => (prev ? { ...prev } : prev));
				};
				window.addEventListener('resize', onResize);
				return () => window.removeEventListener('resize', onResize);
			}, []);

			// ---- 屏幕边缘召回：隐藏时指针靠近所在边缘 → 露出可见条 ----
			// 只更新 pointerRef（轻量）；进入/离开召回区时 setPeek 切换渲染。
			// React 对相同值会 bail out，指针在区内连续移动不会频繁重渲染。
			useEffect(() => {
				var onMove = (e) => {
					pointerRef.current = { x: e.clientX, y: e.clientY };
					if (!hideRef.current.active) return;
					setPeek(edgeZoneHit(e.clientX, e.clientY, hideRef.current.edge));
				};
				window.addEventListener('mousemove', onMove);
				return () => window.removeEventListener('mousemove', onMove);
			}, []);

			// ---- 选中态下点击屏幕：宠物走路/跑步到点击点 ----
			// 命中层 onClick 已 stopPropagation，不会到这里；点击可交互控件（按钮/链接/
			// 输入框等）也忽略，只有点击空白处才触发移动。
			useEffect(() => {
				if (!selected) return;
				var onClick = (e) => {
					var t = e.target;
					if (t && t.closest && t.closest('.wp-hit, button, a, input, select, textarea, [role="button"], [contenteditable="true"]')) return;
					if (moveToRef.current) moveToRef.current(e.clientX, e.clientY);
				};
				window.addEventListener('click', onClick);
				return () => window.removeEventListener('click', onClick);
			}, [selected]);

			// ============================================================================
			// 移动系统 —— 动画提供姿态，代码驱动位置
			// ============================================================================
			// 当前位置（视口坐标）：
			// customPos 存"相对窗口比例"（rx = centerX/innerWidth），渲染/驱动时乘当前
			// 窗口尺寸 → resize 后宠物保持相对位置。
			var currentCenterX = () => {
				var cp = customPosRef.current;
				if (cp) return cp.rx * window.innerWidth;
				var rootEl = rootRef.current;
				if (rootEl) return rootEl.getBoundingClientRect().left + halfW;
				return window.innerWidth - 24 - halfW;
			};
			var currentCenterY = () => {
				var cp = customPosRef.current;
				if (cp) return cp.ry * window.innerHeight;
				var rootEl = rootRef.current;
				if (rootEl) return rootEl.getBoundingClientRect().top + halfH;
				return window.innerHeight - 20 - halfH;
			};

			/**
			 * 尝试计划一次移动（朝当前 facing 方向）。
			 * 只做两件事：检查空间是否够 + 记录计划；真正的位置驱动等移动动画
			 * 就绪后由 play 的 onReady 触发。
			 * @returns {boolean} true=移动已计划；false=空间不够（调用方回退随机动作）
			 */
			var tryPlanMove = () => {
				if (moveRef.current !== null || pendingMoveRef.current) return true; // 已在移动/已计划
				if (hideRef.current.active) return false; // 完全隐藏中：不漫游（动画链继续，但位置不动）
				if (intentRef.current !== INTENT.IDLE) return false; // 事件意图激活中：不漫游（移动仅属自主链）
				var moves = (cfgRef.current && cfgRef.current.pools && cfgRef.current.pools.moves) || MOVES;
				if (!moves.length) return false; // 配置移动池为空：不漫游
				// 方向按"实际朝向"计算：若刚播完东张西望（animRef 仍为 TURN），
				// facing 即将翻转，方向取反——否则人物"脸朝新方向、却往旧方向走"
				var dir = (facingRef.current === 'right') !== (animRef.current === TURN) ? 1 : -1;
				var W = window.innerWidth;
				var cx = currentCenterX();
				var cy = currentCenterY();
				var distance = randomInt(MOVE_MIN_PX, MOVE_MAX_PX);
				var target = cx + dir * distance;
				// 播放前检查一次距离：目标点必须在屏幕安全边距内
				var leftBound = MOVE_MARGIN + halfW;
				var rightBound = W - MOVE_MARGIN - halfW;
				if (target < leftBound || target > rightBound) return false;
				// 记录计划（存比例而非绝对坐标，resize 后仍正确）；自主漫游为水平移动（targetY=startY）
				pendingMoveRef.current = {
					startX: cx / W,
					startY: cy / window.innerHeight,
					targetX: target / W,
					targetY: cy / window.innerHeight,
					dir,
				};
				// 移动动画一次性播放，播完 ended → handleEnded → 进动画链
				var moveAnim = pickFrom(moves);
				if (!moveAnim) return false; // 移动池全悬空：不移动，调用方回落随机动作
				playNext(moveAnim, true);
				return true;
			};

			/**
			 * 启动"位置驱动"循环。只在移动动画真正加载完成并开始播放后调用
			 * （在 play 的 onReady 里），保证人物姿态先出现在屏幕上、位置才开始动。
			 *
			 * 关键设计：位置跟随动画的播放时钟（video.currentTime）——
			 *   开头 MOVE_LEAD_SEC(2s) 准备动作：位置不动
			 *   中间窗口：位置按进度从起点走向终点
			 *   结尾 MOVE_TAIL_SEC(2s) 收尾动作：位置已到终点
			 * 这样踏步节奏和位移完全同步，不会"滑步"。
			 */
			var startDrive = (el) => {
				var pm = pendingMoveRef.current;
				if (!pm || moveRef.current !== null) return; // 没有计划或已在移动
				pendingMoveRef.current = null;
				// 动画时长驱动节奏，取不到时兜底
				var duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : MOVE_FALLBACK_DURATION;
				// 真正移动的窗口 = 总时长 - 前后 2s（至少 0.1s 防除零）
				var travelWindow = Math.max(0.1, duration - MOVE_LEAD_SEC - MOVE_TAIL_SEC);
				var token = ++moveTokenRef.current;
				var step = () => {
					if (moveTokenRef.current !== token) return;
					var t = el.currentTime || 0; // 动画当前播放进度（秒）
					var rootEl = rootRef.current;
					if (rootEl) {
						// 每帧用"当前窗口尺寸 × 比例"算实际坐标——resize 后自动跟随
						var W = window.innerWidth;
						var H = window.innerHeight;
						var ratioX, ratioY;
						if (t <= MOVE_LEAD_SEC) {
							ratioX = pm.startX;
							ratioY = pm.startY;
						} else if (t >= duration - MOVE_TAIL_SEC) {
							ratioX = pm.targetX;
							ratioY = pm.targetY;
						} else {
							var progress = (t - MOVE_LEAD_SEC) / travelWindow;
							ratioX = pm.startX + (pm.targetX - pm.startX) * progress;
							ratioY = pm.startY + (pm.targetY - pm.startY) * progress;
						}
						// 直接改 DOM style（不触发 React 重渲染，保证 60fps 平滑）
						rootEl.style.left = (ratioX * W - halfW) + 'px';
						rootEl.style.top = (ratioY * H - halfH) + 'px';
						rootEl.style.right = 'auto';
						rootEl.style.bottom = 'auto';
					}
					if (t < duration - MOVE_TAIL_SEC) {
						moveRef.current = requestAnimationFrame(step); // 继续下一帧
					} else {
						// 到位：提交终点位置（相对窗口比例），让动画自然播完最后 2s 收尾
						// （一次性动画，ended 事件会带我们回行为链）
						moveRef.current = null;
						setCustomPos({ rx: pm.targetX, ry: pm.targetY });
					}
				};
				moveRef.current = requestAnimationFrame(step);
			};

		// 停止移动（点击/拖拽打断时调用）：取消计划 + 使 rAF 失效 + 取消帧
		var stopDrive = () => {
			pendingMoveRef.current = null;
			moveTokenRef.current++;
			if (moveRef.current !== null) {
				cancelAnimationFrame(moveRef.current);
				moveRef.current = null;
			}
		};

		// ============================================================================
		// 拖拽惯性—— 快速甩动松手 → 动量滑行（指数衰减阻尼）
		// ============================================================================
		// 位置由 rAF 直接写 inline style（sliding 状态让 rootStyle 不设 left/top，
		// 避免重渲染覆盖）；滑出屏幕进入"完全隐藏 + 边缘召回"；速度衰减到阈值停下，
		// 落定当前位置（渲染时 clamp 保留可抓回可见条）。滑行中再按下即可抓住。
		var stopInertia = () => {
			var cur = inertiaRef.current;
			cur.token++;
			var had = cur.active;
			cur.active = false;
			if (cur.raf !== null) {
				cancelAnimationFrame(cur.raf);
				cur.raf = null;
			}
			return had ? { cx: cur.cx, cy: cur.cy } : null; // 返回最后位置供调用方落定
		};
		// 切换默认角落时，清除拖拽/漫游产生的内联坐标。否则 left/top 的
		// 优先级会高于 data-corner，表现为选项已保存但宠物仍停在原处。
		var lastCornerRef = useRef(corner);
		useEffect(() => {
			if (lastCornerRef.current === corner) return;
			lastCornerRef.current = corner;
			stopDrive();
			stopInertia();
			setSliding(false);
			setSelected(false);
			setHide({ active: false, edge: null });
			setPeek(false);
			setCustomPos(null);
			livePosRef.current = null;
			var rootEl = rootRef.current;
			if (rootEl) {
				rootEl.style.left = '';
				rootEl.style.top = '';
				rootEl.style.right = '';
				rootEl.style.bottom = '';
			}
		}, [corner]);
		var startInertia = (vx, vy, centerX, centerY) => {
			var cur = inertiaRef.current;
			cur.active = true;
			cur.cx = centerX;
			cur.cy = centerY;
			var token = ++cur.token;
			var prev = performance.now();
			var settle = (edge) => {
				cur.raf = null;
				cur.active = false;
				setSliding(false);
				if (edge) {
					// 甩出屏幕：进入隐藏（customPos 记出屏点，渲染 clamp 停靠位）
					setHide({ active: true, edge: edge });
					setCustomPos({ rx: cur.cx / window.innerWidth, ry: cur.cy / window.innerHeight });
					// 指针若还在对应边缘召回区：立即露出
					setPeek(edgeZoneHit(pointerRef.current.x, pointerRef.current.y, edge));
				} else {
					setCustomPos({ rx: cur.cx / window.innerWidth, ry: cur.cy / window.innerHeight });
				}
				// 与拖拽松手一致：安静呼吸（循环），点击后回行为链
				playNext(IDLE, false);
			};
			var step = () => {
				if (cur.token !== token) return; // 已被新的惯性/抓取取代
				var now = performance.now();
				var dt = Math.min(Math.max(now - prev, 4), 40); // 钳制帧间隔（切后台不瞬移）
				prev = now;
				cur.cx += vx * dt;
				cur.cy += vy * dt;
				var decay = Math.exp(-dt / INERTIA_TAU); // 指数阻尼
				vx *= decay;
				vy *= decay;
				// 完全出屏判定（与拖拽出屏同语义）
				var W = window.innerWidth;
				var H = window.innerHeight;
				var nx = cur.cx - halfW, ny = cur.cy - halfH;
				var edge = null;
				if (nx + size <= 0) edge = 'left';
				else if (nx >= W) edge = 'right';
				else if (ny + stageH <= 0) edge = 'top';
				else if (ny >= H) edge = 'bottom';
				if (edge) { settle(edge); return; }
				var rootEl = rootRef.current;
				if (rootEl) {
					rootEl.style.left = nx + 'px';
					rootEl.style.top = ny + 'px';
					rootEl.style.right = 'auto';
					rootEl.style.bottom = 'auto';
					livePosRef.current = { left: nx, top: ny };
				}
				if (Math.hypot(vx, vy) > INERTIA_STOP_SPEED) {
					cur.raf = requestAnimationFrame(step);
				} else {
					settle(null);
				}
			};
			cur.raf = requestAnimationFrame(step);
		};

		// ---- 目标移动：选中宠物后点击屏幕，宠物走路/跑步到目标点 ----
		// planWalkTo：通用目标移动规划（选中态点击 / 光标跟随共用）——
		// 钳制目标到安全边距、按方向设置朝向、按距离选走路/跑步姿态。
		// greet=true 时到达后打招呼（选中态点击）；目标太近返回 false。
		// moveTo 存 ref（每次渲染更新），window click 监听读最新闭包，
		// 避免闭包捕获过期渲染变量（size/halfW 等）。
		var planWalkTo = (targetX, targetY, greet) => {
			var W = window.innerWidth, H = window.innerHeight;
			var cx = currentCenterX(), cy = currentCenterY();
			// 目标点钳制到安全边距内（保留宠物一半宽度/高度在屏内）
			var tx = Math.min(Math.max(targetX, MOVE_MARGIN + halfW), W - MOVE_MARGIN - halfW);
			// Y 补偿：舞台中心定位会让人物中心停在点击点下方 charCenterOffsetY 处，
			// 故把目标舞台中心上移该偏移，使点击点对齐"人物中心"而非视频边框中心。
			var ty = Math.min(Math.max(targetY - charCenterOffsetY, MOVE_MARGIN + halfH), H - MOVE_MARGIN - halfH);
			var dx = tx - cx, dy = ty - cy;
			if (Math.hypot(dx, dy) < CLICK_MOVE_MIN_PX) return false; // 目标太近，忽略
			stopDrive(); // 打断当前移动/计划，重新规划
			setFacing(dx >= 0 ? 'right' : 'left'); // 朝目标方向
			pendingMoveRef.current = {
				startX: cx / W, startY: cy / H,
				targetX: tx / W, targetY: ty / H,
				dir: dx >= 0 ? 1 : -1,
			};
			greetAfterMoveRef.current = greet; // 到达后是否打招呼
			var dist = Math.hypot(dx, dy);
			playNext(dist > RUN_DISTANCE_PX ? RUN_ANIM : WALK_ANIM, true);
			return true;
		};
		var moveToRef = useRef(null);
		moveToRef.current = (clientX, clientY) => {
			if (hideRef.current.active) return; // 完全隐藏中不移动
			planWalkTo(clientX, clientY, true);
		};

		// ---- 光标跟随（鼠标跟随）：空闲时偶尔走向指针附近 ----
		// 目标点至少停在离光标 FOLLOW_STOP_PX 处（"距离阈值内停下"）；
		// 光标已在 FOLLOW_MIN_PX 内/指针未知/事件意图激活/隐藏中 → 不跟。
		var tryFollowPointer = () => {
			if (moveRef.current !== null || pendingMoveRef.current) return true; // 已在移动/已计划
			if (hideRef.current.active) return false;
			if (intentRef.current !== INTENT.IDLE) return false; // 移动仅属自主链
			var p = pointerRef.current;
			if (p.x < 0 && p.y < 0) return false; // 尚无指针位置
			var cx = currentCenterX(), cy = currentCenterY();
			var dx = p.x - cx, dy = p.y - cy;
			var dist = Math.hypot(dx, dy);
			if (dist < FOLLOW_MIN_PX) return false; // 光标已在附近：不跟
			var travel = Math.min(dist - FOLLOW_STOP_PX, MOVE_MAX_PX);
			if (travel < CLICK_MOVE_MIN_PX) return false;
			return planWalkTo(cx + dx / dist * travel, cy + dy / dist * travel, false);
		};

			// ============================================================================
			// 点击 vs 拖拽的区分
			// ============================================================================
			// 问题：按下+松开可能是一次"点击"，也可能是一次"拖拽"。
			// 方案：pointerdown 只记录起点；pointermove 超过阈值（5px）才判定为拖拽
			// （播放拖拽动画并跟手）；松手时若没拖过，click 事件正常触发点击回应。
			var DRAG_THRESHOLD = 5; // 拖拽判定阈值（px）

			// 命中层覆盖 HIT_BOX 区域：视频 pointer-events:none（完全穿透），
			// 命中层 pointer-events:auto 只覆盖人物区域。事件天然都在人物范围内，
			// 无需再做坐标命中检查；命中层之外点击直达下层 UI。
		// 按下：只记录，不立即切动画
		var handlePointerDown = (e) => {
			e.currentTarget.classList.add('dragging'); // 拖拽中抓取光标
			stopDrive(); // 用户交互打断正在进行的移动
			// 惯性滑行中抓住：停下并落定当前位置，从这儿继续拖
			if (inertiaRef.current.active) {
				var last = stopInertia();
				setSliding(false);
				if (last) setCustomPos({ rx: last.cx / window.innerWidth, ry: last.cy / window.innerHeight });
			}
			setMenu(null); // 交互即关闭右键菜单
			e.currentTarget.setPointerCapture(e.pointerId);
			// 记录"鼠标点相对舞台中心的偏移"：拖动时保持该偏移，
			// 从人物任意位置抓起都不会瞬移到鼠标下
			var rootEl = rootRef.current;
			var offX = 0, offY = 0;
			if (rootEl) {
				var rr = rootEl.getBoundingClientRect();
				offX = e.clientX - (rr.left + rr.width / 2);
				offY = e.clientY - (rr.top + rr.height / 2);
			}
			dragRef.current = { active: true, dragging: false, sx: e.clientX, sy: e.clientY, offX, offY };
			dragSamplesRef.current = []; // 新一轮拖拽采样
		};
		// 移动：超过阈值才进入拖拽模式
		var handlePointerMove = (e) => {
			var d = dragRef.current;
			if (!d.active) return;
			var dx = e.clientX - d.sx;
			var dy = e.clientY - d.sy;
			if (!d.dragging) {
				// 还没超过阈值：仍是"点击候选"，不动
				if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
				// 进入拖拽：播放拖拽动画
				d.dragging = true;
				setDragging(true);
				playNext(DRAG, true);
			}
			// 指针采样（惯性速度估算）：保留最近 8 个点
			var samples = dragSamplesRef.current;
			samples.push({ t: performance.now(), x: e.clientX, y: e.clientY });
			if (samples.length > 8) samples.splice(0, samples.length - 8);
			// 跟手：直接改 root 的 style（不触发 React 重渲染 → 60fps 平滑）。
			// 拖动中不做钳制——可自由拖出屏幕；舞台整体出屏即进入"完全隐藏"。
			var rootEl = rootRef.current;
			if (rootEl) {
				var W = window.innerWidth;
				var H = window.innerHeight;
				var nx = e.clientX - d.offX - halfW;
				var ny = e.clientY - d.offY - halfH;
				// 完全出屏判定：舞台整体移出视口（任一边缘）
				var edge = null;
				if (nx + size <= 0) edge = 'left';
				else if (nx >= W) edge = 'right';
				else if (ny + stageH <= 0) edge = 'top';
				else if (ny >= H) edge = 'bottom';
				if (edge) {
					// 进入/保持隐藏（记录隐藏边缘；隐藏中不可见，无需写位置）
					if (!hideRef.current.active || hideRef.current.edge !== edge) {
						setHide({ active: true, edge });
					}
					setPeek(false);
				} else {
					// 回到屏内（哪怕只露出 1px）：取消隐藏，正常跟手
					if (hideRef.current.active) setHide({ active: false, edge: null });
					rootEl.style.left = nx + 'px';
					rootEl.style.top = ny + 'px';
					rootEl.style.right = 'auto';
					rootEl.style.bottom = 'auto';
					livePosRef.current = { left: nx, top: ny };
				}
			}
		};
		// 松手：真拖拽则停留 + 回待机（循环）；没拖过则等 click 事件。
		// 快速甩动（惯性）：估算松手速度，够快则进入动量滑行。
		var handlePointerUp = (e) => {
			var d = dragRef.current;
			var wasDragging = d.dragging;
			d.active = false;
			d.dragging = false;
			e.currentTarget.classList.remove('dragging'); // 结束抓取光标
			if (wasDragging) {
				// 抑制拖拽结束后的"幽灵点击"（浏览器在拖完也会发 click）
				justDraggedRef.current = true;
				setTimeout(() => { justDraggedRef.current = false; }, 100);
				setDragging(false);
				// 停在松手处（以舞台中心为基准而非鼠标点——从角落抓起时
				// 松手也保持偏移，宠物不会跳回鼠标位置）；存相对窗口比例
				var rcx = e.clientX - d.offX;
				var rcy = e.clientY - d.offY;
				// 惯性判定：最近 ~120ms 采样估算速度（reduced-motion 用户关闭惯性）
				var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
				var v = estimateVelocity(dragSamplesRef.current);
				if (v && v.speed > INERTIA_MIN_SPEED && !reduced) {
					setSliding(true);
					playNext(DRAG, false); // 滑行中保持被拎起姿态（循环）
					startInertia(v.vx, v.vy, rcx, rcy);
					return;
				}
				setCustomPos({
					rx: rcx / window.innerWidth,
					ry: rcy / window.innerHeight,
				});
				// 若松手时处于完全隐藏（拖出屏幕后松开）：立即按指针位置评估召回露出，
				// 避免指针明明还在边缘、宠物却要等下一次 mousemove 才露出来
				if (hideRef.current.active) {
					setPeek(edgeZoneHit(e.clientX, e.clientY, hideRef.current.edge));
				}
				// 回待机并循环（拖完先安静地呼吸，点击后再进行为链）
				playNext(IDLE, false);
			}
			// 没拖过：交给 handleClick
		};

		// 点击回应（仅真点击触发，拖拽后的 click 被忽略）。
		// 点击可打断任何动画（含事件意图动作/自主链动作），提升响应速度；
		// 回应动画播完回待机缓冲，再进自主链。
		// 双击 → 特殊动作（蓝鲸现世）；单击按命中框上/中/下 1/3 分类回应（头/身/尾）。
		var handleClick = (e) => {
			var d = dragRef.current;
			if (d.active || d.dragging || justDraggedRef.current) return; // 拖拽中/刚拖完：忽略
			e.stopPropagation(); // 阻止冒泡到 window（选中态下的屏幕点击移动）
			stopDrive(); // 点击打断移动
			setMenu(null);
			// 双击窗口内再次点击 → 特殊动作，取消选中
			var now = Date.now();
			if (now - lastClickAtRef.current < DOUBLE_CLICK_MS) {
				lastClickAtRef.current = 0;
				setSelected(false);
				playNext(DOUBLE_ANIM, true);
				return;
			}
			lastClickAtRef.current = now;
			// 点击位置分类：上/中/下 1/3；同一区域有多个动作时随机回应
			var clicks = (cfgRef.current && cfgRef.current.pools && cfgRef.current.pools.clicks) || CLICKS;
			var anim = IDLE;
			if (clicks.length) {
				var rect = e.currentTarget.getBoundingClientRect();
				var frac = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
				var zi = clickZoneIndex(frac);
				var zoneClicks = clicks.filter((_, i) => i % 3 === zi);
				anim = pickFrom(zoneClicks.length ? zoneClicks : clicks) || IDLE; // 全悬空回落待机
			}
			playNext(anim, true);
			// 切换选中态：选中后点击屏幕即可让宠物走过去
			var next = !selected;
			setSelected(next);
			if (next) {
				// 选中：meter 开启时显示余额气泡，否则显示移动提示
				if (cfgRef.current && cfgRef.current.meter) showMeterBubble();
				else showBubble(tPet('selectHint'));
			}
		};

		// ============================================================================
		// 右键菜单—— 回家 / 打开设置 / 隐藏
		// ============================================================================
		var closeMenu = () => { setMenu(null); };
		var handleContextMenu = (e) => {
			if (dragRef.current.active || dragRef.current.dragging) return; // 拖拽中不弹
			e.preventDefault(); // 屏蔽浏览器默认菜单
			e.stopPropagation();
			// 钳制在视口内（菜单约 160×120）
			var x = Math.min(e.clientX, window.innerWidth - 170);
			var y = Math.min(e.clientY, window.innerHeight - 130);
			setMenu({ x: Math.max(x, 4), y: Math.max(y, 4) });
		};
		// 回家：回默认角落（清自定义位置），到家打个招呼
		var menuGoHome = () => {
			setMenu(null);
			stopDrive();
			stopInertia();
			setSliding(false);
			setSelected(false);
			// 取消"完全隐藏"（边缘召回态下回家）：否则 rootStyle 仍按隐藏定位，
			// 宠物回不了默认角落、招呼动画在屏外播放
			setHide({ active: false, edge: null });
			setPeek(false);
			setCustomPos(null); // rootStyle 走 data-corner 默认角落
			playNext(GREET_ANIM, true);
		};
		// 隐藏：优先写设置 visible=false（设置卡片可重新开启）；无设置通道时
		// 退化为"完全隐藏 + 屏幕边缘召回"（指针移到最近边缘唤回）
		var menuHide = () => {
			setMenu(null);
			var fallback = () => {
				var cx = currentCenterX(), cy = currentCenterY();
				var dl = cx, dr = window.innerWidth - cx, dt = cy, db = window.innerHeight - cy;
				var min = Math.min(dl, dr, dt, db);
				var edge = min === dl ? 'left' : min === dr ? 'right' : min === dt ? 'top' : 'bottom';
				stopDrive();
				stopInertia();
				setSliding(false);
				setHide({ active: true, edge: edge });
			};
			if (api && api.settings) {
				api.settings.update({ ns: 'whale-pet', patch: { visible: false } })
					.then(() => { if (store) store.load(); })
					.catch(fallback);
			} else {
				fallback();
			}
		};
		// 打开设置：先打开宿主设置，再依次选择“插件”和“鲸鱼桌宠”。
		// 宿主暂无公开导航 API，因此只匹配明确的可点击控件文本/无障碍名称，
		// 并短暂轮询等待对话框与插件页完成挂载。
		var menuOpenSettings = () => {
			setMenu(null);
			var controls = () => Array.from(document.querySelectorAll('button,a,[role="button"],[role="tab"]'));
			var textOf = (el) => ((el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim());
			var findNamed = (names, allowPrefix) => controls().find((el) => {
				var text = textOf(el);
				return names.some((candidate) => text === candidate || (allowPrefix && text.indexOf(candidate) === 0));
			});
			var settingsButton = document.querySelector('.hHd-Xa_settingsArea button')
				|| findNamed(['设置', 'Settings']);
			if (!settingsButton) {
				showBubble(tPet('settingsHint'));
				return;
			}
			settingsButton.click();
			var attempts = 0;
			var openPlugin = () => {
				var petButton = findNamed([tPet('title'), '鲸鱼桌宠', 'Whale Pet'], true);
				if (petButton) {
					if (petButton.getAttribute('aria-expanded') !== 'true') petButton.click();
					if (petButton.scrollIntoView) petButton.scrollIntoView({ block: 'center' });
					return;
				}
				var pluginButton = findNamed(['插件', 'Plugins']);
				if (pluginButton) pluginButton.click();
				if (++attempts < 20) setTimeout(openPlugin, 100);
				else showBubble(tPet('settingsHint'));
			};
			setTimeout(openPlugin, 0);
		};

			// ============================================================================
			// 渲染
			// ============================================================================
			// 落地对齐：视频是 640×360 画布、脚在 y=330，脚底距画布底 30px（8.33%）。
			// 舞台是 16:9（高 = size×9/16），bottomPad 把舞台下移这段距离，
			// 让"脚"正好落在视口底线上。
			var bottomPad = size * 9 / 16 * (CANVAS_H - FEET_Y) / CANVAS_H;
			// 舞台样式：拖拽中无偏移；平时 translateY(bottomPad) 落地
			var stageStyle = dragging
				? { transform: 'none' }
				: { transform: 'translateY(' + bottomPad + 'px)' };

		// 根容器样式：
			// - 拖拽中/惯性滑行中：回填 livePosRef 的最新指令式位置（位置由跟手/
			//   滑行逻辑直接写 inline style；回填是为了不让 React 的 style diff
			//   清空 left/top 导致闪回默认角落）
		// - 完全隐藏：整体移出屏幕；peek（召回）时沿隐藏边缘露出可见条，
		//   并跟随指针（指针始终落在露出条上，可直接抓住拖回）
		// - 有自定义位置（拖过/走过）：按"相对窗口比例 × 当前窗口尺寸"定位，
		//   经 clamp 钳制——允许停靠在屏幕外，但保留可见条可抓回
		// - 否则不设：走 CSS 的 data-corner 默认角落，天然响应式
		var rootStyle = (dragging || sliding) ? (livePosRef.current
				? { left: livePosRef.current.left + 'px', top: livePosRef.current.top + 'px', right: 'auto', bottom: 'auto' }
				: {}) : (hide.active
				? (() => {
					var px = pointerRef.current.x;
					var py = pointerRef.current.y;
					// 隐藏前的基础位置（停靠钳制位；无 customPos 时回默认角落）
					var baseLeft = customPos ? clampLeft(customPos.rx * window.innerWidth - halfW) : window.innerWidth - 24 - size;
					var baseTop = customPos ? clampTop(customPos.ry * window.innerHeight - halfH) : window.innerHeight - stageH;
					var s = { right: 'auto', bottom: 'auto' };
					if (hide.edge === 'left') {
						s.left = (peek ? keepVisibleX - size : -size) + 'px';
						s.top = (peek ? clampTop(py - halfH) : baseTop) + 'px';
					} else if (hide.edge === 'right') {
						s.left = (peek ? window.innerWidth - keepVisibleX : window.innerWidth) + 'px';
						s.top = (peek ? clampTop(py - halfH) : baseTop) + 'px';
					} else if (hide.edge === 'top') {
						s.top = (peek ? keepVisibleY - stageH : -stageH) + 'px';
						s.left = (peek ? clampLeft(px - halfW) : baseLeft) + 'px';
					} else {
						s.top = (peek ? window.innerHeight - keepVisibleY : window.innerHeight) + 'px';
						s.left = (peek ? clampLeft(px - halfW) : baseLeft) + 'px';
					}
					return s;
				})()
				: (customPos
				? (() => {
					var left = clampLeft(customPos.rx * window.innerWidth - halfW);
					var top = clampTop(customPos.ry * window.innerHeight - halfH);
					return { left: left + 'px', top: top + 'px', right: 'auto', bottom: 'auto' };
				})()
				: {}));

			// 两个 video 共用的 props（纯播放属性，交互交给命中层）
			var commonVideoProps = { muted: true, playsInline: true, autoPlay: true, title: 'dsh-whale-pet' };
		// 命中层 props：覆盖 HIT_BOX 区域，承载全部交互事件与抓取光标。
		// 悬停注视：悬停期间 facing 跟随光标（左半→朝左/右半→朝右），
		// 离开时恢复进入前朝向；拖拽/滑行中不启用。
		var hitProps = {
			className: 'wp-hit',
			style: {
				left: (HIT_BOX.x0 / CANVAS_W * 100) + '%',
				top: (HIT_BOX.y0 / CANVAS_H * 100) + '%',
				width: ((HIT_BOX.x1 - HIT_BOX.x0) / CANVAS_W * 100) + '%',
				height: ((HIT_BOX.y1 - HIT_BOX.y0) / CANVAS_H * 100) + '%',
			},
			onMouseEnter: (e) => {
				if (!dragRef.current.active) e.currentTarget.style.cursor = 'grab';
				if (!dragRef.current.active && !inertiaRef.current.active) {
					hoverRef.current = { active: true, facing: facingRef.current };
				}
			},
			onMouseMove: (e) => {
				// 悬停注视：光标在舞台左半 → 朝左，右半 → 朝右（去重，不频繁 setState）
				if (!hoverRef.current.active || dragRef.current.active) return;
				var rootEl = rootRef.current;
				if (!rootEl) return;
				var r = rootEl.getBoundingClientRect();
				var side = e.clientX < r.left + r.width / 2 ? 'left' : 'right';
				if (side !== facingRef.current) setFacing(side);
			},
			onMouseLeave: (e) => {
				if (!dragRef.current.active) e.currentTarget.style.cursor = 'default';
				var hv = hoverRef.current;
				if (hv.active) {
					hoverRef.current = { active: false, facing: null };
					if (!dragRef.current.active) setFacing(hv.facing); // 恢复进入前朝向
				}
			},
			onClick: handleClick,
			onContextMenu: handleContextMenu,
			onPointerDown: handlePointerDown,
			onPointerMove: handlePointerMove,
			onPointerUp: handlePointerUp,
			onPointerCancel: handlePointerUp,
			title: 'dsh-whale-pet',
		};

			// 显示开关：visible=false 时隐藏桌宠（组件不渲染 DOM；hooks 继续运行，
			// 重新开启时视频元素重建、状态保留在 refs 中）
			if (cfg && cfg.visible === false) return null;

			// 渲染树：root > stage > [video A, video B, 命中层]
			// A 初始带 is-front（显示），B 隐藏待命；命中层在最上层承载交互
			return h('div', {
				ref: rootRef,
				className: 'wp-root' + (selected ? ' wp-selected' : ''),
				'data-corner': corner,   // CSS 决定默认角落
				'data-facing': facing,   // 预留：CSS 镜像（实际镜像走视频 inline transform）
				style: Object.assign({ '--wp-size': size + 'px' }, rootStyle),
				children: [
					h('div', {
						ref: stageRef,
						className: 'wp-stage',
						style: stageStyle,
						children: [
							h('video', Object.assign({}, commonVideoProps, { ref: videoARef, className: 'wp-video is-front' })),
							h('video', Object.assign({}, commonVideoProps, { ref: videoBRef, className: 'wp-video' })),
							h('div', hitProps),
						],
			// 连续 SVG 云朵轮廓；常驻气泡不播放淡出动画
				}),
				bubble && h('div', { key: bubble.seq, className: 'wp-bubble' + (bubble.sticky ? ' wp-bubble-sticky' : ''), role: 'status', children: [
					h('svg', { className: 'wp-bubbleCloud', viewBox: '0 0 240 96', preserveAspectRatio: 'none', 'aria-hidden': true }, h('path', { d: 'M30 78C14 78 5 67 8 53C10 41 19 33 31 30C32 16 43 7 57 8C66 1 80 2 90 10C102 1 118 3 127 14C141 7 158 10 166 24C180 14 201 20 207 39C225 40 236 52 233 67C231 81 215 88 198 84C180 91 160 87 146 83C126 92 105 89 91 83C71 90 48 86 30 78Z', fill: 'var(--dsw-alias-bg-layer-3)', stroke: 'var(--dsw-alias-border-l2)', strokeWidth: 1.5, vectorEffect: 'non-scaling-stroke' })),
					h('span', { className: 'wp-bubbleText' }, bubble.text),
				] }),
				// 右键菜单：fixed 定位浮层（wp-root pointer-events:none，菜单自身 auto）
				menu && h('div', {
					ref: menuRef,
					className: 'wp-menu',
					role: 'menu',
					'aria-label': tPet('menuLabel'),
					style: { left: menu.x + 'px', top: menu.y + 'px' },
					children: [
						h('button', { type: 'button', role: 'menuitem', className: 'wp-menuItem', onClick: menuGoHome }, tPet('menuHome')),
						h('button', { type: 'button', role: 'menuitem', className: 'wp-menuItem', onClick: menuOpenSettings }, tPet('menuSettings')),
						h('button', { type: 'button', role: 'menuitem', className: 'wp-menuItem', onClick: menuHide }, tPet('menuHide')),
					],
				}),
			],
		});
	}

		// ============================================================================
		// 设置卡片—— 注册进官方"设置 → 插件"页（settings.plugin.item）
		// ============================================================================
		// 表单内容：意图→动作映射（多选）、动作池启用（多选）、显示与行为设置（开关/预设/下拉）。
		// 保存走 api.settings.update（宿主 zod 校验 + 持久化 settings.yaml），
		// 成功后配置存储刷新 → 宠物热生效（无需重启）。
		var SETTINGS_NS = 'whale-pet';
		// 全部动画 id（配置值域）
		var ALL_ANIMS = ANIMS.map((a) => a.id);
		// 意图标签（翻译键）
		var INTENT_LABELS = {
			working: 'intentWorking', coding: 'intentCoding', reading: 'intentReading',
			researching: 'intentResearching', thinking: 'intentThinking', waitingUser: 'intentWaitingUser',
			listening: 'intentListening', error: 'intentError',
		};

		var INTENT_HINTS = {
			working: 'hintIntentWorking', coding: 'hintIntentCoding', reading: 'hintIntentReading',
			researching: 'hintIntentResearching', thinking: 'hintIntentThinking', waitingUser: 'hintIntentWaitingUser',
			listening: 'hintIntentListening', error: 'hintIntentError',
		};

		// ---- 国际化字典（locale 命名空间 'whale-pet'） ----
		var LOCALES = {
			zh: {
				title: '鲸鱼桌宠',
				desc: '事件动作、自主行为与显示设置（修改后自动生效）',
				secIntents: '事件动作映射',
				secPools: '自主行为池',
				secParams: '显示与行为',
				intentWorking: '工作中', intentCoding: '写代码', intentReading: '阅读',
				intentResearching: '查资料', intentThinking: '思考', intentWaitingUser: '等待用户',
				intentListening: '倾听', intentError: '出错',

				hintIntentWorking: 'Agent 正在运行，但没有更具体的活动类型', hintIntentCoding: 'Agent 正在编写、修改或执行代码',
				hintIntentReading: 'Agent 正在读取文件或检索项目内容', hintIntentResearching: 'Agent 正在搜索网页或查阅外部资料',
				hintIntentThinking: 'Agent 正在分析问题或生成回复', hintIntentWaitingUser: 'Agent 正在等待你的审批或回答',
				hintIntentListening: '收到你的消息或检测到排队输入', hintIntentError: '工具执行失败或 Agent 发生错误',
				poolActs: '动作池', poolMoves: '移动池', poolClicks: '点击回应池',
				hintEmptyPool: '留空 = 该意图回落自主链',
				hintActs: '自主链的随机动作', hintMoves: '漫游走路姿态', hintClicks: '点击回应动画',
				labelVisible: '显示宠物', hintVisible: '关闭后桌宠隐藏，可随时重新开启',
				labelBubbles: '显示气泡', hintBubbles: '意图切换时显示文字气泡',
				labelMeter: '显示余额', hintMeter: '气泡显示服务商官方接口返回的账户余额（开启后替代文字气泡）',
			selectHint: '点一下屏幕，让我走过去~',
			unsaved: '等待自动保存',
			meterBalance: '余额 ', meterWaiting: '等待模型调用…', meterUnsupported: '当前服务商暂不支持', meterFailed: '查询失败',
			// 交互增强
			menuLabel: '宠物菜单',
			menuHome: '回家', menuSettings: '打开设置', menuHide: '隐藏',
			settingsHint: '从左侧栏打开设置（齿轮）哦~',
			// 资源层
			secCustom: '自定义动作',
			labelCustomDir: '动作目录',
			hintCustomDir: '放入 640×360（脚底 y=330）透明 WebM/MP4 后点刷新',
			customEmpty: '目录暂无动作文件',
			refreshCustom: '刷新',
				uploadCustom: '上传动作', uploadingCustom: '上传中…', uploadCustomDone: '上传成功，已归入“自定义”分类',
				uploadCustomInvalid: '仅支持名称有效的 WebM 或 MP4 文件', uploadCustomExists: '同名动作已存在，请重命名后上传',
				uploadCustomTooLarge: '文件不能超过 64 MiB', uploadCustomFailed: '上传失败，请重试', uploadCustomUnavailable: '上传接口尚未加载，请重启 Harness 后重试',
				deleteCustom: '删除', deleteCustomConfirm: '确定永久删除自定义动作“{name}”吗？', deletingCustom: '正在删除…', deleteCustomDone: '已删除自定义动作，相关配置引用已自动清理', deleteCustomFailed: '删除失败，请重试', deleteCustomUnavailable: '删除接口尚未加载，请重启 Harness 后重试',
				hintCustomCategory: '用户上传的动作会自动归入“自定义”分类',
			catAll: '全部', catIdle: '待机', catTurn: '转向', catActs: '动作',
			catDaily: '日常', catWork: '工作', catGames: '游戏', catMusic: '音乐舞蹈', catFood: '美食', catFestivals: '节日', catSeasonal: '四季', catMagic: '魔术', catFun: '趣味', catSpecial: '鲸鱼特色', catMemes: '梗图',
			catMoves: '移动', catClicks: '点击', catDrag: '拖拽', catCustom: '自定义',
			// 触发规则
			secRules: '触发规则',
			hintRules: '根据工具执行、回合结束等事件，自动播放指定动画',
			ruleEmpty: '还没有规则——新建一条，让宠物在你关心的事件发生时表演',
			addRule: '新建规则',
			ruleNoName: '未命名规则',
			ruleName: '名称',
			ruleWhen: '触发条件（全部满足）',
			rulePriority: '优先级',
			ruleCooldown: '冷却',
			ruleHold: '保持',
			ruleSecondsShort: '秒',
				ruleConditionJoin: ' 且 ', ruleActionUnit: '个动作',
				cornerBottomRight: '右下', cornerBottomLeft: '左下', cornerTopRight: '右上', cornerTopLeft: '左上', scopeCurrent: '当前会话', scopeAny: '全部会话',
			ruleBubble: '气泡文案',
			hintRulePriority: '0 最低，9 最高（可覆盖出错）；点击/拖拽始终最高',
				hintRuleCooldown: '同一规则再次触发前需要等待的时间',
				hintRuleHold: '规则触发后保持该动作的时间',
				hintRuleBubble: '规则触发时显示在桌宠上方的文字',
			addCond: '添加条件',
			testRule: '试触发',
			lastFired: '上次触发',
			neverFired: '未触发过',
			editRule: '编辑',
			deleteRule: '删除',
			cancelRule: '取消',
			saveRule: '保存规则',
			startFromTemplate: '从模板开始：',
			tplBlank: '自定义规则',
			tplToolCall: '指定工具被调用时',
			tplToolErr: '工具执行失败时',
			tplAgentErr: '助手出错时',
			tplTurnEnd: '回合结束时',
			tplApproval: '等待我审批时',
			fieldType: '事件类型', fieldTool: '工具名', fieldSession: '会话 ID',
			fieldRunning: '运行中', fieldError: '出错标记', fieldCustom: '自定义路径…',
			fieldCustomPh: '帧字段路径，如 data.error',
			ruleWhenNatural: '当', ruleThenNatural: '鲸鱼就', ruleActionLabel: '播放动作', toolNameOptional: '工具名称（可选）', repeatEvery: '秒内不重复', ruleActionJoin: '、',
			chooseTemplate: '选择一个常用场景', templateHint: '选好后只需挑选想播放的动作', advancedMode: '高级模式', hideAdvanced: '收起高级模式',
			eventToolCall: '执行工具时', eventToolResult: '工具执行完成时', eventTurnStart: '开始处理消息时', eventTurnEnd: '完成一轮回答时',
			eventStepStart: '开始一个步骤时', eventStepEnd: '完成一个步骤时', eventAssistantChunk: '生成回答内容时', eventAssistantMessage: '助手发送消息时',
			eventUserMessage: '我发送消息时', eventApprovalRequested: '等待我确认时', eventApprovalResolved: '确认完成时', eventQuestionRequested: '等待我回答问题时',
			eventQuestionResolved: '问题得到回答时', eventSessionQueue: '任务进入队列时', eventSessionStatus: '任务状态变化时', eventAgentError: '助手遇到错误时',
			opEq: '等于', opNe: '不等于', opContains: '包含', opRegex: '匹配正则', opExists: '存在',
			invalidRegex: '正则表达式无效',
			dangerousRegex: '正则存在灾难性回溯风险（嵌套量词），请改写',
			ruleMissingActions: '未选动画（触发后回落自主链）',
				labelSize: '尺寸', labelCorner: '角落', labelScope: '感知',
				labelActivity: '活跃程度', hintActivity: '控制待机、表演和移动的整体频率', activityQuiet: '安静', activityBalanced: '均衡', activityLively: '活泼',
				hintSize: '舞台宽度 px，高 = 宽×9/16',
				hintScope: '事件驱动跟随哪个会话',
				saving: '自动保存中…', saved: '已自动保存 ✓',
				addAction: '添加', done: '完成',
				search: '搜索动画…', preview: '预览动画', stopPreview: '停止预览',
				removeAction: '移除',
				loading: '加载中…', settingsUnavailable: '设置服务不可用',
				loadFailed: '无法读取设置', saveFailed: '保存失败：',
			},
			en: {
				title: 'Whale Pet',
				desc: 'Event actions, autonomous behavior, and display settings (auto-applied)',
				secIntents: 'Event Actions',
				secPools: 'Behavior Pools',
				secParams: 'Display & Behavior',
				intentWorking: 'Working', intentCoding: 'Coding', intentReading: 'Reading',
				intentResearching: 'Researching', intentThinking: 'Thinking', intentWaitingUser: 'Waiting for you',
				intentListening: 'Listening', intentError: 'Error',

				hintIntentWorking: 'The agent is running without a more specific activity', hintIntentCoding: 'The agent is writing, editing, or running code',
				hintIntentReading: 'The agent is reading files or searching the project', hintIntentResearching: 'The agent is searching the web or external sources',
				hintIntentThinking: 'The agent is analyzing or generating a response', hintIntentWaitingUser: 'The agent is waiting for your approval or answer',
				hintIntentListening: 'Your message arrived or input is queued', hintIntentError: 'A tool failed or the agent reported an error',
				poolActs: 'Actions', poolMoves: 'Moves', poolClicks: 'Click responses',
				hintEmptyPool: 'Empty = fall back to the idle chain',
				hintActs: 'Random actions in the idle chain', hintMoves: 'Wander gaits', hintClicks: 'Click response animations',
				labelVisible: 'Show pet', hintVisible: 'Hides the pet while off; re-enable anytime',
				labelBubbles: 'Show bubbles', hintBubbles: 'Show a speech bubble on intent changes',
				labelMeter: 'Show balance', hintMeter: 'Bubble shows the account balance returned by the provider (replaces text bubbles)',
			selectHint: 'Click anywhere to send me there~',
			unsaved: 'Waiting to auto-save',
			meterBalance: 'Balance ', meterWaiting: 'Waiting for a model call…', meterUnsupported: 'Provider not supported', meterFailed: 'Query failed',
			// 交互增强
			menuLabel: 'Pet menu',
			menuHome: 'Go home', menuSettings: 'Open settings', menuHide: 'Hide',
			settingsHint: 'Open settings from the left sidebar~',
			// 资源层
			secCustom: 'Custom Actions',
			labelCustomDir: 'Folder',
			hintCustomDir: 'Drop 640×360 (feet y=330) transparent WebM/MP4, then refresh',
			customEmpty: 'No custom action files yet',
			refreshCustom: 'Refresh',
				uploadCustom: 'Upload action', uploadingCustom: 'Uploading…', uploadCustomDone: 'Uploaded and categorized as Custom',
				uploadCustomInvalid: 'Choose a valid WebM or MP4 file', uploadCustomExists: 'An action with this name already exists; rename the file first',
				uploadCustomTooLarge: 'File must be 64 MiB or smaller', uploadCustomFailed: 'Upload failed; try again', uploadCustomUnavailable: 'The upload service is not loaded; restart Harness and try again',
				deleteCustom: 'Delete', deleteCustomConfirm: 'Permanently delete custom action “{name}”?', deletingCustom: 'Deleting…', deleteCustomDone: 'Custom action deleted; related configuration references were cleaned up automatically', deleteCustomFailed: 'Delete failed; try again', deleteCustomUnavailable: 'The delete service is not loaded; restart Harness and try again',
				hintCustomCategory: 'Uploaded actions are automatically categorized as Custom',
			catAll: 'All', catIdle: 'Idle', catTurn: 'Turn', catActs: 'Acts',
			catDaily: 'Daily', catWork: 'Work', catGames: 'Games', catMusic: 'Music & Dance', catFood: 'Food', catFestivals: 'Festivals', catSeasonal: 'Seasonal', catMagic: 'Magic', catFun: 'Fun', catSpecial: 'Whale Specials', catMemes: 'Memes',
			catMoves: 'Moves', catClicks: 'Clicks', catDrag: 'Drag', catCustom: 'Custom',
			// trigger rules
			secRules: 'Trigger Rules',
			hintRules: 'Automatically play chosen animations for tool, turn, and other events',
			ruleEmpty: 'No rules yet — create one so the pet reacts to events you care about',
			addRule: 'New rule',
			ruleNoName: 'Untitled rule',
			ruleName: 'Name',
			ruleWhen: 'Conditions (all must match)',
			rulePriority: 'Priority',
			ruleCooldown: 'Cooldown',
			ruleHold: 'Hold',
			ruleSecondsShort: 's',
				ruleConditionJoin: ' and ', ruleActionUnit: ' actions',
				cornerBottomRight: 'Bottom right', cornerBottomLeft: 'Bottom left', cornerTopRight: 'Top right', cornerTopLeft: 'Top left', scopeCurrent: 'Current session', scopeAny: 'All sessions',
			ruleBubble: 'Bubble text',
			hintRulePriority: '0 lowest, 9 highest (can override errors); clicks/drag always win',
				hintRuleCooldown: 'Time before the same rule may fire again',
				hintRuleHold: 'How long the triggered action stays active',
				hintRuleBubble: 'Text shown above the pet when this rule fires',
			addCond: 'Add condition',
			testRule: 'Test',
			lastFired: 'Last fired',
			neverFired: 'Never fired',
			editRule: 'Edit',
			deleteRule: 'Delete',
			cancelRule: 'Cancel',
			saveRule: 'Save rule',
			startFromTemplate: 'Start from a template:',
			tplBlank: 'Custom rule',
			tplToolCall: 'When a tool is called',
			tplToolErr: 'When a tool fails',
			tplAgentErr: 'On agent error',
			tplTurnEnd: 'At turn end',
			tplApproval: 'When awaiting my approval',
			fieldType: 'Event type', fieldTool: 'Tool name', fieldSession: 'Session ID',
			fieldRunning: 'Running', fieldError: 'Error flag', fieldCustom: 'Custom path…',
			fieldCustomPh: 'frame field path, e.g. data.error',
			ruleWhenNatural: 'When', ruleThenNatural: 'the whale will', ruleActionLabel: 'Play actions', toolNameOptional: 'Tool name (optional)', repeatEvery: 's cooldown', ruleActionJoin: ', ',
			chooseTemplate: 'Choose a common scenario', templateHint: 'Then simply choose the actions to play', advancedMode: 'Advanced mode', hideAdvanced: 'Hide advanced mode',
			eventToolCall: 'A tool starts', eventToolResult: 'A tool finishes', eventTurnStart: 'A response starts', eventTurnEnd: 'A response finishes',
			eventStepStart: 'A step starts', eventStepEnd: 'A step finishes', eventAssistantChunk: 'Response content is generated', eventAssistantMessage: 'The agent sends a message',
			eventUserMessage: 'I send a message', eventApprovalRequested: 'The agent needs my approval', eventApprovalResolved: 'Approval is resolved', eventQuestionRequested: 'The agent asks me a question',
			eventQuestionResolved: 'A question is answered', eventSessionQueue: 'A task enters the queue', eventSessionStatus: 'Task status changes', eventAgentError: 'The agent encounters an error',
			opEq: 'equals', opNe: 'not equals', opContains: 'contains', opRegex: 'matches regex', opExists: 'exists',
			invalidRegex: 'Invalid regular expression',
			dangerousRegex: 'Regex risks catastrophic backtracking (nested quantifiers); rewrite it',
			ruleMissingActions: 'No animation selected (falls back to the idle chain)',
				labelSize: 'Size', labelCorner: 'Corner', labelScope: 'Scope',
				labelActivity: 'Activity', hintActivity: 'Controls the overall frequency of idling, actions, and movement', activityQuiet: 'Quiet', activityBalanced: 'Balanced', activityLively: 'Lively',
				hintSize: 'Stage width px; height = width × 9/16',
				hintScope: 'Which session drives events',
				saving: 'Auto-saving…', saved: 'Auto-saved ✓',
				addAction: 'Add', done: 'Done',
				search: 'Search animations…', preview: 'Preview', stopPreview: 'Stop preview',
				removeAction: 'Remove',
				loading: 'Loading…', settingsUnavailable: 'Settings service unavailable',
				loadFailed: 'Failed to read settings', saveFailed: 'Save failed: ',
			},
		};
		// 文字气泡文案池（按意图键，zh/en；意图切换时随机一句，IDLE 低频闲聊）
		var BUBBLES = {
			zh: {
				working: ['工作中…', '加油加油！', '让我看看'],
				coding: ['写代码中…', '这个 bug 有点意思', '代码写得不错嘛'],
				reading: ['阅读中…', '这文件好长呀', '嗯…有道理'],
				researching: ['查资料中…', '让我搜搜看', '网上是这么说的'],
				thinking: ['思考中…', '让我想想…', '嗯——'],
				waitingUser: ['等你回复哦~', '你说呢？', '我在这儿等你'],
				listening: ['你说，我听着~', '嗯嗯，然后呢？'],
				error: ['哎呀，出错了！', '刚才没成功…', '让我再试试！'],
				idle: ['好无聊呀…', '今天天气不错', '你什么时候回来呀', '呼——休息一下'],
			},
			en: {
				working: ['Working…', 'Go go go!', 'Let me see'],
				coding: ['Coding…', 'This bug is interesting', 'Nice code!'],
				reading: ['Reading…', 'This file is long', 'Hmm, makes sense'],
				researching: ['Looking it up…', 'Let me search', 'The web says…'],
				thinking: ['Thinking…', 'Let me think…', 'Hmm—'],
				waitingUser: ['Waiting for you~', 'What do you think?', 'I am right here'],
				listening: ['I am listening~', 'Mhm, and then?'],
				error: ['Oops, something went wrong!', 'That did not work…', 'Let me try again!'],
				idle: ['So bored…', 'Nice weather today', 'When are you back?', 'Phew — taking a break'],
			},
		};

		// 动作名称与描述也注册进同一 locale 命名空间；内部 ID 与资源文件名保持英文。
		ANIMS.forEach((a) => {
			LOCALES.zh['animName_' + a.id] = a.nameZh;
			LOCALES.zh['animDescription_' + a.id] = a.descriptionZh;
			LOCALES.en['animName_' + a.id] = a.name;
			LOCALES.en['animDescription_' + a.id] = a.description;
		});

		// 翻译 hook：订阅 locale 变化重渲染，返回命名空间绑定的 t（无 locale 服务时回退中文）
		function useTranslate(locale) {
			var [, force] = useState(0);
			useEffect(() => {
				if (!locale) return;
				return locale.subscribe(() => force((r) => r + 1));
			}, [locale]);
			if (!locale) return (k) => LOCALES.zh[k] || k;
			return locale.bind(SETTINGS_NS);
		}

		// ---- 图标 ----
		// 优先用官方 primitives 图标组件（React 内联 SVG，fill: currentColor 轮廓路径，
		// 与官方设置卡片同源）；require 失败时回退手写 stroke 版（同尺寸同语义）
		var IconX, IconPlus, IconPlay, IconChevron;
		try {
			var primitives = require('@deepseek-ai/dsh-client-ui-primitives');
			IconX = primitives.IconCloseOutline16;
			IconPlus = primitives.IconPlusOutline16;
			IconPlay = primitives.IconPlayOutline16;
			IconChevron = primitives.IconChevronDownOutline14;
		} catch (e) { /* 环境无 primitives：走手写兜底 */ }
		if (!IconX) IconX = () => h('svg', { className: 'wp-sf-icon', width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none', 'aria-hidden': true, children: h('path', { d: 'M2.5 2.5l7 7M9.5 2.5l-7 7', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round' }) });
		if (!IconPlus) IconPlus = () => h('svg', { className: 'wp-sf-icon', width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': true, children: h('path', { d: 'M7 3v8M3 7h8', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round' }) });
		if (!IconPlay) IconPlay = (playing) => h('svg', { className: 'wp-sf-icon', width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true, children: h('path', { d: 'M4 2.8l5.2 3.2L4 9.2z', fill: 'currentColor' }) });
		if (!IconChevron) IconChevron = ({ className }) => h('svg', { className: className, width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': true, children: h('path', { d: 'M3 5l4 4 4-4', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }) });

		function ActionPicker({ value, options, onChange, t }) {
			// chips 标签 + 搜索选择器：已选项显示为可移除标签，点击"＋添加"展开
			// 带搜索的浮层列表；每项带 ▶ 预览按钮，点击在**该条目下方**展开预览
			// （非浮层顶部）；值域为英文 id，展示英文名称与动作描述
			var [picking, setPicking] = useState(false);
			var [query, setQuery] = useState('');
			var [catFilter, setCatFilter] = useState(null); // 分类过滤：null=全部
			var [preview, setPreview] = useState(null);
			var wrapRef = useRef(null);
			// 点击浮层外部关闭
			useEffect(() => {
				if (!picking) return;
				var onDown = (e) => {
					if (wrapRef.current && !wrapRef.current.contains(e.target)) setPicking(false);
				};
				document.addEventListener('mousedown', onDown);
				return () => document.removeEventListener('mousedown', onDown);
			}, [picking]);
			var q = query.trim();
			// 分类 tab：从 options 派生语义分类；移动、点击、拖拽保留专用运行时分类，
			// custom=用户上传动作。
			var CAT_ORDER = ['idle', 'turn', 'daily', 'work', 'games', 'music', 'food', 'festivals', 'seasonal', 'magic', 'fun', 'special', 'memes', 'moves', 'clicks', 'drag', 'custom'];
			var CAT_KEY = { idle: 'catIdle', turn: 'catTurn', daily: 'catDaily', work: 'catWork', games: 'catGames', music: 'catMusic', food: 'catFood', festivals: 'catFestivals', seasonal: 'catSeasonal', magic: 'catMagic', fun: 'catFun', special: 'catSpecial', memes: 'catMemes', moves: 'catMoves', clicks: 'catClicks', drag: 'catDrag', custom: 'catCustom' };
			var entryOf = (id) => animEntry(id);
			var cats = CAT_ORDER.filter((c) => options.some((id) => { var e = entryOf(id); return e && e.category === c; }));
			// 有搜索词：全量搜索；否则按分类过滤
			var list = q
				? options.filter((id) => { var a = entryOf(id); var haystack = [id, localizedAnimName(id, t), localizedAnimDescription(id, t), a && a.name, a && a.description, a && a.nameZh, a && a.descriptionZh].filter(Boolean).join(' ').toLowerCase(); return haystack.indexOf(q.toLowerCase()) !== -1; })
				: catFilter
					? options.filter((id) => { var e = entryOf(id); return e && e.category === catFilter; })
					: options;
			var toggle = (id) => {
				var next = value.indexOf(id) !== -1 ? value.filter((x) => x !== id) : value.concat([id]);
				onChange(next);
			};
			return h('div', { ref: wrapRef, className: 'wp-sf-pickerWrap', children: [
				h('div', { className: 'wp-sf-chips', children: [
					value.map((id) => h('span', { key: id, className: 'wp-sf-chip', children: [
						localizedAnimName(id, t),
						h('button', { type: 'button', className: 'wp-sf-chipX', 'aria-label': t('removeAction') + localizedAnimName(id, t), onClick: () => onChange(value.filter((x) => x !== id)) }, h(IconX, { className: 'wp-sf-icon' })),
					] })),
					h('button', { type: 'button', className: 'wp-sf-add', onClick: () => { setPicking(!picking); setQuery(''); setPreview(null); }, children: picking ? t('done') : [h(IconPlus, { className: 'wp-sf-icon' }), t('addAction')] }),
				] }),
				picking && h('div', { className: 'wp-sf-picker', children: [
					h('input', { className: 'wp-sf-pickerSearch', placeholder: t('search'), value: query, autoFocus: true, onChange: (e) => setQuery(e.target.value) }),
					// 分类 tab：点击过滤；有搜索词时隐藏（搜索已全量过滤）
				!q && h('div', { className: 'wp-sf-cats', children: [
					h('button', { type: 'button', className: 'wp-sf-cat' + (catFilter === null ? ' wp-sf-catOn' : ''), onClick: () => setCatFilter(null) }, t('catAll') + ' ' + options.length),
					cats.map((c) => h('button', {
						type: 'button',
						key: c,
						className: 'wp-sf-cat' + (catFilter === c ? ' wp-sf-catOn' : ''),
						onClick: () => setCatFilter(catFilter === c ? null : c),
					}, t(CAT_KEY[c]) + ' ' + options.filter((id) => { var e = entryOf(id); return e && e.category === c; }).length)),
				] }),
					h('div', { className: 'wp-sf-pickerList', children: list.map((id) => h('div', { key: id, className: 'wp-sf-pickerEntry', children: [
						h('div', { className: 'wp-sf-pickerRow', children: [
							h('button', {
								type: 'button',
								className: 'wp-sf-previewBtn',
								title: preview === id ? t('stopPreview') : t('preview'),
								'aria-label': (preview === id ? t('stopPreview') : t('preview')) + ' ' + localizedAnimName(id, t),
								onClick: () => setPreview(preview === id ? null : id),
							}, h(IconPlay, { className: 'wp-sf-icon' })),
							h('button', {
								type: 'button',
								className: 'wp-sf-pickerItem',
								'data-on': value.indexOf(id) !== -1,
								onClick: () => toggle(id),
							}, localizedAnimName(id, t)),
						] }),
						// 预览展开在对应条目下方（非浮层顶部）
						preview === id && h('video', {
							key: id + ':preview',
							className: 'wp-sf-previewVideo',
							src: animUrl(id),
							muted: true, autoPlay: true, loop: true, playsInline: true,
						}),
					] })) }),
				] }),
			] });
		}

	// ============================================================================
	// 触发规则—— 共享运行时 + 设置卡片 UI（列表 / 模板 / 条件编辑器）
	// ============================================================================
	// ruleRuntime：宠物（传感器回调、试触发实现）与设置卡片（显示"上次触发"、
	// 发起试触发）之间的解耦点（与 customStore 同款共享实例模式）
	function createRuleRuntime() {
		var firedAt = {};
		var listeners = new Set();
		return {
			notify(id, at) {
				firedAt[id] = at;
				listeners.forEach((fn) => fn(firedAt));
			},
			subscribe(fn) {
				listeners.add(fn);
				return () => listeners.delete(fn);
			},
			get firedAt() { return firedAt; },
			trigger: null,
		};
	}

	// ---- 规则编辑词汇表（字段/op/事件类型下拉数据源） ----
	var FIELD_OPTS = [
		['type', 'fieldType'],
		['toolName', 'fieldTool'],
		['sessionId', 'fieldSession'],
		['running', 'fieldRunning'],
		['data.error', 'fieldError'],
	];
	var OP_OPTS = [
		['eq', 'opEq'],
		['ne', 'opNe'],
		['contains', 'opContains'],
		['regex', 'opRegex'],
		['exists', 'opExists'],
	];
	var EVENT_TYPES = [
		'tool/call', 'tool/result', 'turn/start', 'turn/end', 'step/start', 'step/end',
		'assistant/chunk', 'assistant/message', 'user/message',
		'approval/requested', 'approval/resolved', 'question/requested', 'question/resolved',
		'session/queue', 'host/session-status', 'host/agent-error',
	];
	var EVENT_TYPE_KEYS = {
		'tool/call': 'eventToolCall', 'tool/result': 'eventToolResult',
		'turn/start': 'eventTurnStart', 'turn/end': 'eventTurnEnd',
		'step/start': 'eventStepStart', 'step/end': 'eventStepEnd',
		'assistant/chunk': 'eventAssistantChunk', 'assistant/message': 'eventAssistantMessage',
		'user/message': 'eventUserMessage', 'approval/requested': 'eventApprovalRequested',
		'approval/resolved': 'eventApprovalResolved', 'question/requested': 'eventQuestionRequested',
		'question/resolved': 'eventQuestionResolved', 'session/queue': 'eventSessionQueue',
		'host/session-status': 'eventSessionStatus', 'host/agent-error': 'eventAgentError',
	};
	// 新建规则的模板（预填条件；工具名 regex 留给用户填）
	var RULE_TEMPLATES = [
		['tplToolCall', [{ field: 'type', op: 'eq', value: 'tool/call' }], ['coding']],
		['tplToolErr', [{ field: 'type', op: 'eq', value: 'tool/result' }, { field: 'data.error', op: 'exists' }], ['jump_scare']],
		['tplAgentErr', [{ field: 'type', op: 'eq', value: 'host/agent-error' }], ['startled_awake']],
		['tplTurnEnd', [{ field: 'type', op: 'eq', value: 'turn/end' }], ['happy_hop']],
		['tplApproval', [{ field: 'type', op: 'eq', value: 'approval/requested' }], ['attentive_listening']],
	];

	function fieldLabelOf(f, t) {
		for (var i = 0; i < FIELD_OPTS.length; i++) if (FIELD_OPTS[i][0] === f) return t(FIELD_OPTS[i][1]);
		return f || t('fieldCustom');
	}
	function eventLabelOf(value, t) {
		return EVENT_TYPE_KEYS[value] ? t(EVENT_TYPE_KEYS[value]) : value;
	}
	function opLabelOf(op, t) {
		for (var i = 0; i < OP_OPTS.length; i++) if (OP_OPTS[i][0] === op) return t(OP_OPTS[i][1]);
		return op;
	}
	// 条件摘要（列表行"当 … 且 … → 播放 N 个动画"）
	function condSummary(c, t) {
		if (c.field === 'type' && c.op === 'eq') return eventLabelOf(c.value, t);
		var s = fieldLabelOf(c.field, t) + ' ' + opLabelOf(c.op, t);
		if (c.op === 'exists') return s;
		return s + ' ' + (c.value === '' ? '∅' : c.value);
	}
	// 相对时间（s/m/h/d；通用符号，不做 i18n）
	function relTime(at, now) {
		var s = Math.max(0, Math.round((now - at) / 1000));
		if (s < 60) return s + 's';
		var m = Math.floor(s / 60);
		if (m < 60) return m + 'm';
		var hr = Math.floor(m / 60);
		if (hr < 24) return hr + 'h';
		return Math.floor(hr / 24) + 'd';
	}
	function newRuleId() {
		return 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
	}

	// 规则编辑器：条件行（字段下拉 + op 下拉 + 值）+ 优先级/冷却/保持/气泡 +
	// 动作池（复用 ActionPicker）+ 试触发。校验：≥1 条件、regex 可编译。
	function RuleEditor({ rule, isNew, options, onSave, onCancel, onTest, t }) {
		var [name, setName] = useState(rule.name || '');
		var [conds, setConds] = useState((rule.when || []).map((c) => ({ field: c.field, op: c.op, value: c.value || '' })));
		var [priority, setPriority] = useState(Number(rule.priority) || 3);
		var [cooldownSec, setCooldownSec] = useState(Math.max(1, Math.round((rule.cooldownMs || 30000) / 1000)));
		var [holdSec, setHoldSec] = useState(Math.max(0, Math.round((rule.holdMs || 3000) / 1000)));
		var [bubble, setBubble] = useState(rule.bubble || '');
		var [actions, setActions] = useState((rule.actions || []).slice());
		var [touched, setTouched] = useState(false);
		var simpleRule = (rule.when || []).length >= 1 && (rule.when || []).length <= 2 && (rule.when || []).filter((c) => c.field === 'type' && c.op === 'eq').length === 1 && (rule.when || []).every((c) => (c.field === 'type' && c.op === 'eq') || (c.field === 'toolName' && c.op === 'contains'));
		var [advanced, setAdvanced] = useState(!isNew && !simpleRule);
		var patch = (fn) => { setTouched(true); fn(); };
		var setCond = (i, part) => patch(() => setConds((cs) => {
			var next = cs.map((c, j) => (j === i ? { ...c, ...part } : c));
			if (part.op === 'exists') next[i] = { ...next[i], value: '' };
			return next;
		}));
		var typeCondIndex = conds.findIndex((c) => c.field === 'type' && c.op === 'eq');
		var eventType = typeCondIndex >= 0 ? conds[typeCondIndex].value : 'turn/end';
		var toolCond = conds.find((c) => c.field === 'toolName');
		var setEventType = (value) => patch(() => setConds((cs) => {
			var next = cs.filter((c) => c.field !== 'type' && ((value === 'tool/call' || value === 'tool/result') || c.field !== 'toolName'));
			return [{ field: 'type', op: 'eq', value: value }].concat(next);
		}));
		var setSimpleTool = (value) => patch(() => setConds((cs) => {
			var next = cs.filter((c) => c.field !== 'toolName');
			return value.trim() ? next.concat([{ field: 'toolName', op: 'contains', value: value }]) : next;
		}));
		// 内联 label 子元素：静态数组也统一带 key（消除 React 列表告警）
		var inline = (key0, label, control, hint, unit) => h('label', { className: 'wp-sf-inline', key: key0, title: hint || undefined }, [label, h('span', { key: key0 + '-c', className: unit ? 'wp-rule-controlUnit' : 'wp-rule-control', children: [control, unit ? h('span', { className: 'wp-rule-unit' }, unit) : null] })]);
		// 正则校验：语法错误 / 灾难性回撤形态（嵌套量词），任一命中禁保存
		var regexErr = null;
		conds.forEach((c) => {
			if (regexErr || c.op !== 'regex') return;
			try { new RegExp(c.value); } catch (e) { regexErr = 'syntax'; return; }
			if (!isSafeRegexPattern(c.value)) regexErr = 'danger';
		});
		var canSave = conds.length >= 1 && !regexErr;
		var build = () => normalizeRule({
			id: rule.id,
			enable: rule.enable !== false,
			name: name.trim() || t('ruleNoName'),
			when: conds,
			priority: priority,
			cooldownMs: cooldownSec * 1000,
			holdMs: holdSec * 1000,
			actions: actions,
			bubble: bubble,
		});
		var fieldSelect = (c, i) => {
			var known = FIELD_OPTS.some((f) => f[0] === c.field) || c.field === '';
			return h('select', {
				className: 'wp-sf-select',
				value: known && c.field !== '' ? c.field : (c.field === '' ? '' : '__custom__'),
				onChange: (e) => setCond(i, { field: e.target.value === '__custom__' ? 'data.' : e.target.value }),
			}, FIELD_OPTS.map((f) => h('option', { key: f[0], value: f[0] }, t(f[1]))).concat([
				h('option', { key: '__custom__', value: '__custom__' }, t('fieldCustom')),
			]));
		};
		var valueInput = (c, i) => {
			if (c.op === 'exists') return null;
			if (c.field === 'type') {
				return h('select', { className: 'wp-sf-select', value: c.value, onChange: (e) => setCond(i, { value: e.target.value }) },
					h('option', { key: '', value: '' }, '—'),
					EVENT_TYPES.map((et) => h('option', { key: et, value: et }, eventLabelOf(et, t))));
			}
			return h('input', { className: 'wp-sf-input', value: c.value, onChange: (e) => setCond(i, { value: e.target.value }) });
		};
		if (isNew && !touched) {
			return h('div', { className: 'wp-rule-editor', children: [
				h('div', { className: 'wp-rule-templateBody', children: [
					h('div', { className: 'wp-rule-tplLabel' }, t('chooseTemplate')),
					h('p', { className: 'wp-sf-customHint' }, t('templateHint')),
					h('div', { className: 'wp-rule-tpl', children: RULE_TEMPLATES.map((tpl) => h('button', {
						type: 'button', key: tpl[0], className: 'wp-rule-btn',
						onClick: () => patch(() => { setName(t(tpl[0])); setConds(tpl[1].map((c) => ({ ...c }))); setActions((tpl[2] || []).slice()); }),
					}, t(tpl[0]))).concat([
						h('button', { type: 'button', key: 'blank', className: 'wp-rule-btn', onClick: () => patch(() => { setConds([{ field: 'type', op: 'eq', value: 'turn/end' }]); setAdvanced(true); }) }, t('tplBlank')),
					]) }),
				] }),
				h('div', { className: 'wp-rule-templateActions', children: [
					h('button', { type: 'button', className: 'wp-rule-btn', onClick: onCancel }, t('cancelRule')),
				] }),
			] });
		}
		return h('div', { className: 'wp-rule-editor', children: [
			h('div', { className: 'wp-rule-editorHead', children: [
				h('label', { className: 'wp-rule-editorName', children: [
					t('ruleName'),
					h('input', { className: 'wp-sf-input', value: name, onChange: (e) => patch(() => setName(e.target.value)) }),
				] }),
			] }),
			h('div', { className: 'wp-rule-natural', children: [
				h('div', { className: 'wp-rule-sentenceGroup', children: [
					h('span', { className: 'wp-rule-sentenceWord' }, t('ruleWhenNatural')),
					h('div', { className: 'wp-rule-sentenceControls', children: [
						h('select', { className: 'wp-sf-select', value: eventType, onChange: (e) => setEventType(e.target.value) },
						EVENT_TYPES.map((et) => h('option', { key: et, value: et }, eventLabelOf(et, t)))),
						(eventType === 'tool/call' || eventType === 'tool/result') && h('input', { className: 'wp-sf-input', placeholder: t('toolNameOptional'), value: toolCond ? toolCond.value : '', onChange: (e) => setSimpleTool(e.target.value) }),
					] }),
				] }),
				h('div', { className: 'wp-rule-sentenceGroup wp-rule-resultGroup', children: [
					h('span', { className: 'wp-rule-sentenceWord' }, t('ruleThenNatural')),
					h('div', { className: 'wp-rule-actionPicker', title: t('ruleActionLabel'), children: [
						h(ActionPicker, { value: actions, options, onChange: (v) => patch(() => setActions(v)), t }),
					] }),
				] }),
			] }),
			!actions.length && h('p', { className: 'wp-sf-customHint wp-rule-missing' }, t('ruleMissingActions')),
			h('button', { type: 'button', className: 'wp-rule-btn wp-rule-advanced', 'aria-expanded': advanced, onClick: () => setAdvanced(!advanced) }, advanced ? t('hideAdvanced') : t('advancedMode')),
			advanced && h('div', { key: 'advanced', className: 'wp-rule-advancedPanel', children: [
			h('div', { key: 'conds', className: 'wp-rule-conditions' }, [
				h('div', { key: 'hint', className: 'wp-rule-condTitle' }, t('ruleWhen')),
				conds.map((c, i) => h('div', { className: 'wp-rule-cond', key: i, children: [
					fieldSelect(c, i),
					h('select', { className: 'wp-sf-select', value: c.op, onChange: (e) => setCond(i, { op: e.target.value }) },
						OP_OPTS.map((o) => h('option', { key: o[0], value: o[0] }, t(o[1])))),
					valueInput(c, i),
					// 自定义路径（字段不在预设表）：文本输入点路径（任何 op 下都可编辑）
					!FIELD_OPTS.some((f) => f[0] === c.field)
						? h('input', { className: 'wp-sf-input', placeholder: t('fieldCustomPh'), value: c.field, onChange: (e) => setCond(i, { field: e.target.value }) })
						: null,
					h('button', { type: 'button', className: 'wp-rule-btn', 'aria-label': t('deleteRule'), onClick: () => patch(() => setConds((cs) => cs.filter((_, j) => j !== i))) }, h(IconX, { className: 'wp-sf-icon' })),
				] })),
				h('button', { type: 'button', key: 'addCond', className: 'wp-sf-add', onClick: () => patch(() => setConds((cs) => cs.concat([{ field: 'type', op: 'eq', value: '' }]))) }, [h(IconPlus, { className: 'wp-sf-icon' }), t('addCond')]),
				regexErr === 'syntax' && h('p', { key: 'rxErr', className: 'wp-rule-error' }, t('invalidRegex')),
				regexErr === 'danger' && h('p', { key: 'rxDanger', className: 'wp-rule-error' }, t('dangerousRegex')),
			]),
			h('div', { className: 'wp-rule-timing', children: [
				inline('cd', t('ruleCooldown'), h('input', {
					type: 'number', min: 1, step: 1, className: 'wp-sf-input', value: cooldownSec,
					onChange: (e) => patch(() => setCooldownSec(Math.max(1, parseInt(e.target.value, 10) || 1))),
				}), t('hintRuleCooldown'), t('ruleSecondsShort')),
				advanced && inline('hold', t('ruleHold'), h('input', {
					type: 'number', min: 0, step: 1, className: 'wp-sf-input', value: holdSec,
					onChange: (e) => patch(() => setHoldSec(Math.max(0, parseInt(e.target.value, 10) || 0))),
				}), t('hintRuleHold'), t('ruleSecondsShort')),
				inline('bub', t('ruleBubble'), h('input', {
					className: 'wp-sf-input', value: bubble, maxLength: 50,
					onChange: (e) => patch(() => setBubble(e.target.value)),
				}), t('hintRuleBubble')),
			] }),
			h('label', { className: 'wp-rule-priority', title: t('hintRulePriority'), children: [
				h('span', { className: 'wp-rule-priorityLabel' }, t('rulePriority')),
				h('input', { type: 'range', min: 0, max: 9, step: 1, className: 'wp-rule-prio', value: priority, onChange: (e) => patch(() => setPriority(parseInt(e.target.value, 10) || 0)) }),
				h('span', { className: 'wp-rule-priorityValue' }, String(priority)),
			] }),
			] }),
			h('div', { className: 'wp-rule-actions', children: [
				h('button', { type: 'button', className: 'wp-rule-btn', onClick: () => onTest(build()) }, [h(IconPlay, { className: 'wp-sf-icon' }), t('testRule')]),
				h('div', { className: 'wp-rule-actionEnd', children: [
					h('button', { type: 'button', className: 'wp-rule-btn', onClick: onCancel }, t('cancelRule')),
					h('button', { type: 'button', className: 'wp-rule-btn wp-rule-btnPrimary', disabled: !canSave, onClick: () => { var r = build(); if (r) onSave(r); } }, t('saveRule')),
				] }),
			] }),
		] });
	}

	// 规则列表 + 新建/编辑入口（编辑态本地化在 RulesSection，draft.rules 由
	// SettingsForm 的 onPatch 持有）。ruleUi：{ firedAt, onTest }（来自
	// ruleRuntime；SSR/无运行时环境为安全默认值）
	function RulesSection({ rules, onPatch, t, options, ruleUi }) {
		var [editing, setEditing] = useState(null); // null | { isNew, rule }
		var firedAt = (ruleUi && ruleUi.firedAt) || {};
		var onTest = ruleUi && ruleUi.onTest;
		var update = (next) => onPatch((d) => ({ ...d, rules: next }));
		var now = Date.now();
		return h('div', { key: 'rules' }, [
			!editing && h('div', { key: 'list', className: 'wp-rule-list' }, [
				(rules || []).map((r) => h('div', { key: r.id, className: 'wp-rule-item', children: [
					h('div', { className: 'wp-rule-head', children: [
						h('input', { type: 'checkbox', className: 'wp-sf-checkbox', checked: r.enable !== false, 'aria-label': r.name || t('ruleNoName'), onChange: () => update(rules.map((x) => (x.id === r.id ? { ...x, enable: !(x.enable !== false) } : x))) }),
						h('div', { className: 'wp-rule-titleBlock', children: [
							h('span', { className: 'wp-rule-name' }, r.name || t('ruleNoName')),
						] }),
						h('button', { type: 'button', className: 'wp-rule-btn', onClick: () => setEditing({ isNew: false, rule: { ...r, when: r.when.map((c) => ({ ...c })) } }) }, t('editRule')),
						h('button', { type: 'button', className: 'wp-rule-btn wp-rule-btnDestructive', onClick: () => update(rules.filter((x) => x.id !== r.id)) }, t('deleteRule')),
					] }),
					h('div', { className: 'wp-rule-sum' }, t('ruleWhenNatural') + ' ' + (r.when || []).map((c) => condSummary(c, t)).join(t('ruleConditionJoin')) + ' → ' + t('ruleActionLabel') + ' ' + ((r.actions || []).map((id) => localizedAnimName(id, t)).join(t('ruleActionJoin')) || t('ruleMissingActions'))),
					h('div', { className: 'wp-rule-meta', children: [
						h('span', null, Math.round((r.cooldownMs || 30000) / 1000) + ' ' + t('repeatEvery')),
						h('span', null, t('lastFired') + ' ' + (firedAt[r.id] ? relTime(firedAt[r.id], now) : t('neverFired'))),
						onTest && h('button', { type: 'button', className: 'wp-rule-btn', onClick: () => onTest(r) }, [h(IconPlay, { className: 'wp-sf-icon' }), t('testRule')]),
					] }),
				] })),
				h('button', { type: 'button', key: 'add', className: 'wp-sf-add wp-rule-add', onClick: () => setEditing({ isNew: true, rule: {
					id: newRuleId(), enable: true, name: '', when: [{ field: 'type', op: 'eq', value: 'tool/call' }],
					priority: 3, cooldownMs: 30000, holdMs: 3000, actions: [], bubble: '',
				} }) }, [h(IconPlus, { className: 'wp-sf-icon' }), t('addRule')]),
				!(rules || []).length && h('p', { key: 'empty', className: 'wp-sf-customHint' }, t('ruleEmpty')),
			]),
			editing && h(RuleEditor, {
				rule: editing.rule,
				isNew: editing.isNew,
				options,
				t,
				onTest: onTest || function () {},
				onCancel: () => setEditing(null),
				onSave: (saved) => {
					update(editing.isNew ? rules.concat([saved]) : rules.map((x) => (x.id === saved.id ? saved : x)));
					setEditing(null);
				},
			}),
		]);
	}


	// 设置表单（纯展示）：数据与保存由 SettingsCard 持有，拆出便于 SSR 结构测试。
	// custom：{ ids: 自定义动作 id 数组, display, onRefresh } —— 缺省按空处理。
	// ruleUi：{ firedAt, onTest } —— 规则触发时间戳 + 试触发回调，缺省安全。
	function SettingsForm({ draft, onPatch, saving, savedAt, error, open, onToggle, unsaved, custom, ruleUi, t }) {
		var behavior = draft.behavior || {};
		var customIds = (custom && Array.isArray(custom.ids)) ? custom.ids : [];
		var uploadInputRef = useRef(null);
		var [uploadState, setUploadState] = useState({ busy: false, message: null, error: false });
		var uploadCustomFile = (event) => {
			var file = event.target.files && event.target.files[0];
			event.target.value = '';
			if (!file) return;
			if (!/\.(webm|mp4)$/i.test(file.name) || file.size <= 0) {
				setUploadState({ busy: false, message: t('uploadCustomInvalid'), error: true });
				return;
			}
			if (file.size > 64 * 1024 * 1024) {
				setUploadState({ busy: false, message: t('uploadCustomTooLarge'), error: true });
				return;
			}
			setUploadState({ busy: true, message: t('uploadingCustom'), error: false });
			Promise.resolve(custom && custom.onUpload ? custom.onUpload(file) : Promise.reject(new Error('upload-failed')))
				.then(() => setUploadState({ busy: false, message: t('uploadCustomDone'), error: false }))
				.catch((uploadError) => {
					var code = uploadError ? uploadError.message : 'upload-failed';
					var key = code === 'file-exists' ? 'uploadCustomExists'
						: (code === 'invalid-file-size' || code === 'storage-quota-exceeded') ? 'uploadCustomTooLarge'
						: code === 'invalid-file-name' ? 'uploadCustomInvalid'
						: code === 'upload-api-unavailable' ? 'uploadCustomUnavailable' : 'uploadCustomFailed';
					setUploadState({ busy: false, message: t(key), error: true });
				});
		};
		var deleteCustomAction = (id) => {
			if (!custom || !custom.onDelete) return;
			if (!window.confirm(t('deleteCustomConfirm').replace('{name}', id))) return;
			setUploadState({ busy: true, message: t('deletingCustom'), error: false });
			Promise.resolve(custom.onDelete(id)).then(() => {
				onPatch((d) => ({ ...d,
					intents: Object.fromEntries(Object.entries(d.intents || {}).map(([key, ids]) => [key, (ids || []).filter((x) => x !== id)])),
					pools: Object.fromEntries(Object.entries(d.pools || {}).map(([key, ids]) => [key, (ids || []).filter((x) => x !== id)])),
					rules: (d.rules || []).map((rule) => ({ ...rule, actions: (rule.actions || []).filter((x) => x !== id) })),
				}));
				setUploadState({ busy: false, message: t('deleteCustomDone'), error: false });
			}).catch((deleteError) => {
				var key = deleteError && deleteError.message === 'delete-api-unavailable' ? 'deleteCustomUnavailable' : 'deleteCustomFailed';
				setUploadState({ busy: false, message: t(key), error: true });
			});
		};
			// 字段行（紧凑）：label 左 + 控件右，同一行；提示信息常显在 label 下方
			var field = (labelText, control, hintText, extraClass, tooltipText) => h('div', { className: 'wp-sf-field' + (extraClass ? ' ' + extraClass : ''), children: [
				h('div', { className: 'wp-sf-label', title: tooltipText || hintText || undefined, children: [labelText, hintText && h('span', { className: 'wp-sf-fieldHint' }, hintText)] }),
				h('div', { className: 'wp-sf-control', children: control }),
			] });
			var panel = (title, hint, content, extraClass) => h('section', {
				className: 'wp-sf-panel' + (extraClass ? ' ' + extraClass : ''),
				children: [
					h('div', { className: 'wp-sf-sectionHead', children: [
						h('h3', { className: 'wp-sf-section' }, title),
						hint && h('p', { className: 'wp-sf-sectionHint' }, hint),
					] }),
					content,
				],
			});
			var numInput = (value, onChange, step) => h('input', {
				type: 'number', step: step || '1', className: 'wp-sf-input',
				value: value,
				onChange: (e) => onChange(parseFloat(e.target.value) || 0),
			});
			var singleSelect = (value, options, onChange) => h('select', {
				className: 'wp-sf-select',
				value: value,
				onChange: (e) => onChange(e.target.value),
				children: options.map((o) => h('option', { key: o[0], value: o[0] }, o[1])),
			});
			var setIntent = (key) => (v) => onPatch((d) => ({ ...d, intents: { ...d.intents, [key]: v } }));
			var setPool = (key) => (v) => onPatch((d) => ({ ...d, pools: { ...d.pools, [key]: v } }));

		// 意图映射行：chips 选择器（留空 = 回落自主链）；自定义动作可被意图映射选中
		var intentRows = Object.keys(INTENT_LABELS).map((key) => field(
			t(INTENT_LABELS[key]),
			h(ActionPicker, { value: draft.intents[key] || [], options: ALL_ANIMS.concat(customIds), onChange: setIntent(key), t }),
			null,
			'wp-sf-fieldIntent',
			t(INTENT_HINTS[key])
		));
		// 自主行为池行（自定义动作可加入动作池；移动/点击姿态需专用语义，保持内置）
		var poolLabels = { acts: t('poolActs'), moves: t('poolMoves'), clicks: t('poolClicks') };
		var poolOptions = { acts: ALL_ANIMS.concat(customIds), moves: MOVES, clicks: CLICKS };
		var poolHints = { acts: t('hintActs'), moves: t('hintMoves'), clicks: t('hintClicks') };
		var poolRows = ['acts', 'moves', 'clicks'].map((key) => field(
			poolLabels[key],
			h(ActionPicker, { value: draft.pools[key] || [], options: poolOptions[key], onChange: setPool(key), t }),
			poolHints[key]
		));
			// 显示与行为设置：面向用户的开关、四角位置和活跃程度预设（一行多个控件）
			var activityPresets = {
				quiet: { idleProb: 0.55, turnProb: 0.10, actProb: 0.25, moveProb: 0.10 },
				balanced: { idleProb: 0.30, turnProb: 0.10, actProb: 0.40, moveProb: 0.20 },
				lively: { idleProb: 0.15, turnProb: 0.10, actProb: 0.45, moveProb: 0.30 },
			};
			var activityLevel = Object.keys(activityPresets).reduce((best, key) => {
				var score = ['idleProb', 'turnProb', 'actProb', 'moveProb'].reduce((sum, field) => sum + Math.pow((behavior[field] || 0) - activityPresets[key][field], 2), 0);
				return !best || score < best.score ? { key, score } : best;
			}, null).key;
			var setActivityLevel = (level) => onPatch((d) => ({ ...d, behavior: { ...d.behavior, ...activityPresets[level] } }));
			var toggleItem = (key, label, hint, checked, onChange) => h('label', { key, className: 'wp-sf-toggleItem', children: [
				h('span', { className: 'wp-sf-toggleText', children: [
					h('span', { className: 'wp-sf-toggleTitle' }, label),
					h('span', { className: 'wp-sf-toggleHint' }, hint),
				] }),
				h('input', { type: 'checkbox', className: 'wp-sf-checkbox', checked, onChange }),
			] });
			var settingItem = (key, label, hint, control) => h('label', { key, className: 'wp-sf-settingItem', children: [
				h('span', { className: 'wp-sf-settingLabel', children: [
					h('span', { className: 'wp-sf-settingTitle' }, label),
					hint && h('span', { className: 'wp-sf-settingHint' }, hint),
				] }),
				control,
			] });
			var paramsContent = h('div', { children: [
				h('div', { className: 'wp-sf-toggleGrid', children: [
					toggleItem('visible', t('labelVisible'), t('hintVisible'), !!draft.visible, (e) => onPatch((d) => ({ ...d, visible: e.target.checked }))),
					toggleItem('bubbles', t('labelBubbles'), t('hintBubbles'), !!draft.bubbles, (e) => onPatch((d) => ({ ...d, bubbles: e.target.checked }))),
					toggleItem('meter', t('labelMeter'), t('hintMeter'), !!draft.meter, (e) => onPatch((d) => ({ ...d, meter: e.target.checked }))),
				] }),
				h('div', { className: 'wp-sf-settingGrid', children: [
					settingItem('size', t('labelSize'), t('hintSize'), numInput(draft.size, (v) => onPatch((d) => ({ ...d, size: v })), '10')),
					settingItem('corner', t('labelCorner'), null, singleSelect(draft.position, [['bottom-right', t('cornerBottomRight')], ['bottom-left', t('cornerBottomLeft')], ['top-right', t('cornerTopRight')], ['top-left', t('cornerTopLeft')]], (v) => onPatch((d) => ({ ...d, position: v })))),
					settingItem('scope', t('labelScope'), t('hintScope'), singleSelect(draft.scope, [['current', t('scopeCurrent')], ['any', t('scopeAny')]], (v) => onPatch((d) => ({ ...d, scope: v })))),
				] }),
				h('div', { className: 'wp-sf-activityRow', children: [
					h('div', { className: 'wp-sf-activityText', children: [
						t('labelActivity'),
						h('span', { className: 'wp-sf-toggleHint' }, t('hintActivity')),
					] }),
					h('div', { className: 'wp-sf-segments', role: 'group', 'aria-label': t('labelActivity'), children: [
						['quiet', t('activityQuiet')],
						['balanced', t('activityBalanced')],
						['lively', t('activityLively')],
					].map((option) => h('button', {
						type: 'button', key: option[0], className: 'wp-sf-segment',
						'aria-pressed': activityLevel === option[0],
						onClick: () => setActivityLevel(option[0]),
					}, option[1])) }),
				] }),
			] });
			var customContent = h('div', { className: 'wp-sf-field wp-sf-customField', children: [
				h('div', { className: 'wp-sf-label', title: t('hintCustomDir'), children: [
					t('labelCustomDir'),
					h('span', { className: 'wp-sf-fieldHint' }, t('hintCustomDir')),
				] }),
				h('div', { className: 'wp-sf-control', children: [
					h('div', { className: 'wp-sf-customDir', children: [
						h('span', { className: 'wp-sf-customPath', title: (custom && custom.display) || undefined }, (custom && custom.display) || '…'),
						h('input', { ref: uploadInputRef, type: 'file', className: 'wp-sf-fileInput', accept: '.webm,.mp4,video/webm,video/mp4', onChange: uploadCustomFile }),
						h('button', { type: 'button', className: 'wp-sf-add', disabled: uploadState.busy, onClick: () => uploadInputRef.current && uploadInputRef.current.click() }, [h(IconPlus, { className: 'wp-sf-icon' }), uploadState.busy ? t('uploadingCustom') : t('uploadCustom')]),
						h('button', { type: 'button', className: 'wp-sf-add', onClick: (custom && custom.onRefresh) || function () {} }, t('refreshCustom')),
					] }),
					h('p', { className: 'wp-sf-customHint', children: customIds.length ? customIds.length + ' · ' + t('hintCustomCategory') : t('customEmpty') }),
					h('div', { className: 'wp-sf-customList', children: customIds.map((id) => h('div', {
						key: id, className: 'wp-sf-customItem', children: [
							h('span', { title: id }, id),
							h('button', { type: 'button', className: 'wp-rule-btn wp-rule-btnDestructive', disabled: uploadState.busy, onClick: () => deleteCustomAction(id) }, t('deleteCustom')),
						],
					})) }),
					uploadState.message && h('p', { className: 'wp-sf-uploadStatus' + (uploadState.error ? ' wp-sf-uploadError' : ''), role: 'status' }, uploadState.message),
				] }),
			] });

			return h('li', { className: 'wp-sf-card' + (open ? ' wp-sf-cardOpen' : ''), children: [
				h('button', {
					type: 'button',
					className: 'wp-sf-header',
					'aria-expanded': open,
					onClick: onToggle,
					children: [
						h('span', { className: 'wp-sf-headText', children: [
							h('span', { className: 'wp-sf-name' }, t('title')),
							h('span', { className: 'wp-sf-desc' }, t('desc')),
						] }),
						saving && h('span', { className: 'wp-sf-badge' }, t('saving')),
						!saving && unsaved && h('span', { className: 'wp-sf-badge' }, t('unsaved')),
						!saving && !unsaved && savedAt > 0 && h('span', { className: 'wp-sf-badge' }, t('saved')),
						h(IconChevron, {
							className: 'wp-sf-chevron' + (open ? ' wp-sf-chevronOpen' : ''),
						}),
					],
				}),
			open && h('div', { className: 'wp-sf-body', children: [
				panel(t('secParams'), null, paramsContent),
				panel(t('secIntents'), null, h('div', { className: 'wp-sf-fieldGrid', children: intentRows })),
				panel(t('secPools'), null, h('div', { className: 'wp-sf-fieldGrid wp-sf-fieldGridPools', children: poolRows })),
				panel(t('secCustom'), t('hintCustomCategory'), customContent),
				panel(t('secRules'), t('hintRules'), h(RulesSection, { rules: draft.rules || [], onPatch, t, options: ALL_ANIMS.concat(customIds), ruleUi })),
				error && h('div', { className: 'wp-sf-footer', children: [
					h('p', { className: 'wp-sf-error', role: 'status' }, error),
				] }),
			] }),
			] });
		}

	function SettingsCard({ api, store, locale, customStore, ruleRuntime }) {
		var [draft, setDraft] = useState(null);  // 编辑中的配置（mergeConfig 合并）
		var [saving, setSaving] = useState(false);
		var [savedAt, setSavedAt] = useState(0);
		var [error, setError] = useState(null);
		var [open, setOpen] = useState(false);   // 卡片折叠（对齐官方 PluginCard）
		var t = useTranslate(locale);
		// 规则触发时间戳：订阅共享运行时（规则命中时传感器回调 notify）
		var [, ruleTick] = useState(0);
		useEffect(() => {
			if (!ruleRuntime) return;
			return ruleRuntime.subscribe(() => ruleTick((x) => x + 1));
		}, [ruleRuntime]);
		var ruleUi = {
			firedAt: ruleRuntime ? ruleRuntime.firedAt : {},
			onTest: ruleRuntime ? (rule) => {
				if (rule && ruleRuntime.trigger) ruleRuntime.trigger(rule.actions, rule.bubble);
			} : null,
		};
		// 未保存跟踪：上次保存/加载时的 draft 快照；不同则显示"未保存"徽章
		var savedKeyRef = useRef(null);
		var saveInFlightRef = useRef(false);
		var queuedSaveRef = useRef(null);
		// 自定义动作清单：订阅 store，卡片打开/点刷新时重拉（文件增删同步）
		var [customActions, setCustomActions] = useState(customStore ? customStore.get() : { actions: [], display: null });
		useEffect(() => {
			if (!customStore) return;
			setCustomActions(customStore.get());
			var un = customStore.subscribe((v) => setCustomActions(v));
			customStore.load();
			return un;
		}, [customStore]);
		useEffect(() => {
			if (!store) return;
			store.load();
		}, [store]);

			// 加载：describe → 找到 whale-pet 命名空间 → 合并为可编辑配置
			useEffect(() => {
				if (!api || !api.settings) { setError(t('settingsUnavailable')); return; }
				var cancelled = false;
				api.settings.describe({})
					.then((res) => {
						if (cancelled) return;
						var payload = (res && res.result && res.result.ok) ? res.result.value : null;
						var list = (payload && payload.namespaces) || [];
						var ns = list.find((n) => n.ns === SETTINGS_NS);
						var loaded = mergeConfig(ns ? ns.value : null);
						setDraft(loaded);
						savedKeyRef.current = JSON.stringify(loaded);
						setError(null);
					})
					.catch(() => { if (!cancelled) setError(t('loadFailed')); });
				return () => { cancelled = true; };
			}, [api]);

		// 表单修改后立即广播给桌宠；持久化仍保持下方 600ms 防抖与串行写入。
		useEffect(() => {
			if (draft && store && store.set) store.set(draft);
		}, [draft, store]);

		// 防抖自动保存：请求串行执行；保存途中产生的新修改排队补交最新快照。
		var persistDraft = (nextDraft) => {
			if (!nextDraft || !api || !api.settings) return;
			var key = JSON.stringify(nextDraft);
			if (key === savedKeyRef.current) return;
			if (saveInFlightRef.current) { queuedSaveRef.current = nextDraft; return; }
			saveInFlightRef.current = true;
			setSaving(true);
			setError(null);
			api.settings.update({ ns: SETTINGS_NS, patch: {
				visible: nextDraft.visible,
				bubbles: nextDraft.bubbles,
				meter: nextDraft.meter,
				size: nextDraft.size,
				position: nextDraft.position,
				scope: nextDraft.scope,
				behavior: nextDraft.behavior,
				intents: nextDraft.intents,
				pools: nextDraft.pools,
				rules: nextDraft.rules,
			} }).then(() => {
				savedKeyRef.current = key;
				setSavedAt(Date.now());
				if (store) store.load();
			}).catch((e) => setError(t('saveFailed') + ((e && e.message) || '?')))
				.finally(() => {
					saveInFlightRef.current = false;
					var queued = queuedSaveRef.current;
					queuedSaveRef.current = null;
					if (queued && JSON.stringify(queued) !== savedKeyRef.current) persistDraft(queued);
					else setSaving(false);
				});
		};
		useEffect(() => {
			if (!draft || savedKeyRef.current === null) return;
			if (saveInFlightRef.current) { queuedSaveRef.current = draft; return; }
			if (JSON.stringify(draft) === savedKeyRef.current) return;
			var timer = setTimeout(() => persistDraft(draft), 600);
			return () => clearTimeout(timer);
		}, [draft, api]);

		var unsaved = !!draft && savedKeyRef.current !== null && savedKeyRef.current !== JSON.stringify(draft);
		if (!api || !api.settings) {
			return h(SettingsForm, { draft: mergeConfig(null), onPatch: () => {}, saving: false, savedAt: 0, unsaved: false, error: t('settingsUnavailable'), open: true, onToggle: () => {}, ruleUi, t });
		}
		if (!draft) {
			return h(SettingsForm, { draft: mergeConfig(null), onPatch: () => {}, saving: false, savedAt: 0, unsaved: false, error: error || t('loading'), open: true, onToggle: () => {}, ruleUi, t });
		}
		return h(SettingsForm, {
			draft, saving, savedAt, error, open, unsaved, t, ruleUi,
		custom: {
			ids: (customActions && customActions.actions || []).map((a) => a.id),
			display: customActions && customActions.display,
				onRefresh: customStore ? function () { customStore.load(); } : undefined,
				onUpload: customStore ? function (file) { return customStore.upload(file); } : undefined,
				onDelete: customStore ? function (id) { return customStore.remove(id); } : undefined,
			},
			onPatch: setDraft,
			// 展开卡片时顺带刷新自定义动作清单（文件增删后重新打开即同步）
			onToggle: () => {
				var next = !open;
				setOpen(next);
				if (next && customStore) customStore.load();
			},
		});
	}

		// ============================================================================
		// 插件主体（Cordis 插件三件套：name / inject / apply）
		// ============================================================================
		var name = 'whale-pet';       // 插件行 id（与 cordis.patch.yml 一致）
		var inject = ['slots'];       // 需要注入的服务：slots（槽位注册表）

		// apply：插件被激活时调用
		function apply(ctx, config) {
			// connection 服务（可选获取）：提供 api.events 事件流用于活动感知、
			// api.settings 用于设置读写；缺失时宠物退化为纯自主链（仍可正常使用）
			var connection = ctx.get('connection');
			var api = connection ? connection.api : undefined;
			// locale 服务（可选获取）：国际化字典注册（中/英）；缺失时回退中文
			var locale = ctx.get('locale');
			if (locale) locale.register(SETTINGS_NS, LOCALES);
		// 配置存储：加载设置命名空间 + 订阅热更新（宠物与设置卡片共享）
		var store = api && api.settings ? createConfigStore(api) : null;
		if (store) store.load();
		// 自定义动作存储（资源层）：宠物与设置卡片共享一个实例
		var customStore = createCustomStore();
		customStore.load();
		// 规则共享运行时：传感器命中回调（上次触发时间戳）+ 试触发
		// 实现（宠物注册），设置卡片消费；两者解耦
		var ruleRuntime = createRuleRuntime();
			// 官方"叠加式"注册模式：slots.inject 等槽位被声明后，再注册我们的条目。
			// generator + yield 形式不会替换其他条目，而是叠加进列表槽。
		ctx.slots.inject('shell.overlay', function* () {
			yield ctx.slots.register({
				name: 'shell.overlay',
				id: 'whale-pet',   // 列表槽的条目 id（唯一）
				order: 1000,       // 排序（大 = 靠后渲染）
			}, (ownerProps) => h(WhalePet, { config, api, store, locale, customStore, ruleRuntime, ...ownerProps }));
		});
		// 设置卡片：官方"设置 → 插件"页，键 = 设置命名空间
		ctx.slots.inject('settings.plugin.item', function* () {
			yield ctx.slots.register({
				name: 'settings.plugin.item',
				key: SETTINGS_NS,
			}, (ownerProps) => h(SettingsCard, { api, store, locale, customStore, ruleRuntime, ...ownerProps }));
		});
		}

		// 导出插件三件套（Cordis Loader 需要）
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		// 意图系统/配置纯函数导出（供单元测试使用；浏览器运行时无副作用）
		exports.__internals = {
			INTENT, INTENT_PRIORITY, TOOL_INTENTS, INTENT_ACTIONS,
			emptyIntentState, highestIntent, applyFrame, createArbiter,
			startActivitySensor,
			DEFAULT_CONFIG, mergeConfig, createConfigStore, INTENT_CFG_KEY, SETTINGS_NS, ALL_ANIMS,
			ANIMS, ANIM_BY_ID, ANIM_BY_NAME, animUrl, animName, normalizeAnimId, animFacingTransform,
			LOCALES, SettingsForm, ActionPicker, WhalePet,
			// 交互增强
			clickZoneIndex, estimateVelocity,
			pickFrom, ANIM_FAIL_COOLDOWN_MS, failedAnims,
			DOUBLE_CLICK_MS, DOUBLE_ANIM, FOLLOW_CHANCE, INERTIA_MIN_SPEED,
			TARGET_MOVE_ANIM, GREET_ANIM, WALK_ANIM, RUN_ANIM, BUILTIN_ASSET_REVISIONS,
			// 资源层
			setCustomAnims, animEntry, createCustomStore,
			// 余额：会话模型选择解析（session.models 响应 → {route,model}）
			parseSessionModelSelection,
			// 触发规则
			RULE_PREFIX, COND_OPS, EVENT_TYPES, RULE_TEMPLATES,
			getPath, condMatch, safeRegexTest, ruleFrameOf, matchRules,
			normalizeRule, normalizeRules, intentPriorityOf,
			isSafeRegexPattern, isRuleIntent, intentActionIsOnce,
			createRuleRuntime, RulesSection, RuleEditor, relTime, condSummary,
		};
		return module.exports;
	}
});
