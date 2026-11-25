/**
 * 发布门禁：校验 `npm pack --dry-run --json` 的产物清单。
 *
 * 只读检查，不落盘、不发布。断言三件事：
 * 1. 运行必需的入口、图标、动画与语言包都在包里；
 * 2. 源码、文档、未压缩 Logo、锁文件等不参与运行的内容没有混进包；
 * 3. 解包后的总体积低于 60 MiB。
 *
 * 用法：`node scripts/check-pack.mjs`（`prepublishOnly` 与 CI 都会调用）。
 * 失败时打印全部原因并以退出码 1 结束。
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

const SIZE_LIMIT_BYTES = 60 * 1024 * 1024; // 60 MiB
const MIN_ANIMATIONS = 95; // 内置 WebM 动画
const MIN_STATIC_FRAMES = 95; // Safari / WebKit 兜底静态帧
const LOCALE_FILE_COUNT = 8; // DSH 内置的 8 种界面语言

const REQUIRED_FILES = ['lib/client.js', 'lib/index.js', 'assets/icon.png', 'cordis.patch.yml'];
const FORBIDDEN_FILES = ['assets/plugin-logo.png', 'package-lock.json'];
const FORBIDDEN_PREFIXES = ['src/', 'docs/', 'materials/'];

/** 从可能混有 npm notice 的输出里截出第一段完整 JSON 文档。 */
function firstJsonDocument(text) {
    const start = String(text).search(/[[{]/);
    if (start === -1) throw new Error('npm pack 输出里找不到 JSON 清单');
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
        const char = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') inString = true;
        else if (char === '[' || char === '{') depth += 1;
        else if (char === ']' || char === '}') {
            depth -= 1;
            if (depth === 0) return JSON.parse(text.slice(start, i + 1));
        }
    }
    throw new Error('npm pack 输出的 JSON 清单不完整');
}

/** 返回 npm 12 的对象格式或旧版数组格式中的第一份打包清单。 */
function parsePackReport(stdout) {
    const parsed = firstJsonDocument(stdout);
    const reports = Array.isArray(parsed) ? parsed : Object.values(parsed);
    const report = reports.find((item) => item && Array.isArray(item.files));
    if (!report) throw new Error('npm pack 输出里没有 files 清单');
    return report;
}

/** npm 12 起清单路径不带 `package/` 前缀；旧版带前缀，统一去掉后比较。 */
function normalizePath(path) {
    return String(path).replace(/^package\//, '');
}

function runPack() {
    const args = ['pack', '--dry-run', '--json'];
    const npmExecPath = process.env.npm_execpath;
    try {
        if (npmExecPath) {
            // 由 npm 生命周期脚本调用时，直接用当前 npm 的 JS 入口，避免 PATH 差异。
            return parsePackReport(
                execFileSync(process.execPath, [npmExecPath, ...args], {
                    cwd: root,
                    encoding: 'utf8',
                    maxBuffer: 8 * 1024 * 1024,
                })
            );
        }
        return parsePackReport(
            execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
                cwd: root,
                encoding: 'utf8',
                maxBuffer: 8 * 1024 * 1024,
                shell: process.platform === 'win32',
            })
        );
    } catch (error) {
        const detail = error.stderr ? String(error.stderr).trim() : error.message;
        throw new Error('npm pack --dry-run --json 执行失败：' + detail);
    }
}

function formatSize(bytes) {
    return (bytes / (1024 * 1024)).toFixed(2) + ' MiB';
}

function main() {
    const report = runPack();
    const entries = report.files.map((file) => ({
        path: normalizePath(file.path),
        size: Number(file.size) || 0,
    }));
    const paths = new Set(entries.map((entry) => entry.path));
    const errors = [];

    for (const required of REQUIRED_FILES) {
        if (!paths.has(required)) errors.push('缺少必需文件：' + required);
    }
    for (const path of paths) {
        if (FORBIDDEN_FILES.includes(path)) errors.push('不应打包含有：' + path);
        for (const prefix of FORBIDDEN_PREFIXES) {
            if (path.startsWith(prefix)) errors.push('不应打包目录 ' + prefix + '（发现 ' + path + '）');
        }
        if (path.startsWith('assets/') && !path.startsWith('assets/thumb/') && path !== 'assets/icon.png') {
            errors.push('assets 只应包含 assets/thumb/ 与 assets/icon.png（发现 ' + path + '）');
        }
    }

    const animations = entries.filter((entry) => /^assets\/thumb\/.+\.webm$/.test(entry.path)).length;
    const staticFrames = entries.filter((entry) => /^assets\/thumb\/.+\.webp$/.test(entry.path)).length;
    const localeFiles = entries.filter((entry) => /^locale\/[^/]+\.json$/.test(entry.path)).length;
    if (animations < MIN_ANIMATIONS) {
        errors.push('WebM 动画不足：' + animations + ' < ' + MIN_ANIMATIONS);
    }
    if (staticFrames < MIN_STATIC_FRAMES) {
        errors.push('静态帧不足：' + staticFrames + ' < ' + MIN_STATIC_FRAMES);
    }
    if (localeFiles !== LOCALE_FILE_COUNT) {
        errors.push('语言包数量不对：' + localeFiles + ' != ' + LOCALE_FILE_COUNT);
    }

    const unpackedSize = Number(report.unpackedSize) || entries.reduce((sum, entry) => sum + entry.size, 0);
    if (!(unpackedSize < SIZE_LIMIT_BYTES)) {
        errors.push('包体积超限：' + formatSize(unpackedSize) + ' >= ' + formatSize(SIZE_LIMIT_BYTES));
    }

    if (errors.length > 0) {
        console.error('check-pack 失败（' + errors.length + ' 项）：');
        for (const error of errors) console.error('  ✗ ' + error);
        console.error('修复 package.json 的 files 清单后重试；`npm pack --dry-run` 可查看完整清单。');
        process.exit(1);
    }

    console.log(
        'check-pack 通过：' +
            entries.length +
            ' 个文件 / ' +
            formatSize(unpackedSize) +
            '（上限 ' +
            formatSize(SIZE_LIMIT_BYTES) +
            '）'
    );
    console.log('  WebM ' + animations + ' · 静态帧 ' + staticFrames + ' · 语言包 ' + localeFiles);
}

main();
