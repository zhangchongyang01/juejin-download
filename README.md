<h1 align="center">juejin-download</h1>

<p align="center">掘金小册下载工具</p>

推荐使用 浏览器插件 [掘金助手](https://github.com/findmio/juejin-helper)，操作更加方便

## 功能特性

### 核心功能

- ✅ **交互式下载** - 通过 `main.js` 交互式选择并下载单本小册
- ✅ **批量下载** - 通过 `batch-download.js` 自动下载所有小册
- ✅ **内容更新检测** - 基于 SHA256 哈希自动检测文件内容更新，避免重复下载
- ✅ **图片处理** - 自动下载 Markdown 中的图片并替换为本地路径
- ✅ **图片缓存** - 已下载的图片自动使用缓存，不重复下载
- ✅ **智能清理** - 自动清理不再使用的图片文件，节省空间
- ✅ **缺失图片修复** - 自动检测并重新下载缺失的图片

### 高级特性

- 🔄 **增量更新** - 只下载新增或更新的章节
- 📦 **智能缓存** - 图片和文件内容智能缓存机制
- 🔍 **更新检测** - 文件内容变化自动识别并重新下载
- 🧹 **自动清理** - 清理未使用的图片文件
- 📝 **详细日志** - 按日期分类的详细日志记录
- ⚙️ **配置管理** - 支持环境变量配置

## 使用方法

### 安装依赖

```bash
npm install
```

### 获取 Cookie

- 安装 [Chrome](https://chrome.google.com/webstore/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm) 或 [Firefox](https://addons.mozilla.org/en-US/firefox/addon/cookie-editor/) 的 Cookie-Editor 扩展
- 打开 [掘金](https://juejin.cn)
- 点击 Cookie-Editor 扩展程序
- 点击右下角的 "Export" -> "Export as JSON" (保存到剪贴板)
- 把剪贴板上的内容粘贴到 `cookies.json` 文件中

### 执行脚本

#### 1. 交互式下载单本小册

```bash
npm run download
# 或
node main.js
```

#### 2. 批量下载所有小册

```bash
npm run download:batch
# 或
node batch-download.js
```

#### 3. 处理图片（下载并替换链接）

```bash
npm run process:images
# 或
node process-images.js
```

#### 4. 修复缺失的图片

```bash
npm run fix:images
# 或
node fix-missing-images.js
```

#### 5. 测试 API 连接

```bash
npm run test:api
# 或
node test-api.js
```

## 工作流程

### 完整工作流程

1. **下载小册内容**
   ```bash
   npm run download:batch
   ```
   - 自动下载所有小册到 `downloads/` 目录
   - 支持内容更新检测，只下载新增或更新的章节

2. **处理图片**
   ```bash
   npm run process:images
   ```
   - 从 `downloads/` 读取 Markdown 文件
   - 下载所有图片到本地
   - 替换图片链接为本地路径
   - 输出到 `downloads-with-images/` 目录

3. **修复缺失图片（可选）**
   ```bash
   npm run fix:images
   ```
   - 扫描并重新下载缺失的图片

## 配置说明

### 环境变量

可以通过环境变量自定义配置：

```bash
# 网络配置
export NETWORK_TIMEOUT=30000        # 请求超时时间（毫秒）
export RETRY_COUNT=3                # 重试次数
export REQUEST_DELAY=1000           # 请求之间的延迟（毫秒）

# 并发配置
export MAX_CONCURRENT=5             # 最大并发下载数

# 日志配置
export LOG_LEVEL=INFO              # 日志级别：DEBUG, INFO, WARN, ERROR
export ENABLE_FILE_LOGGING=true    # 是否启用文件日志
```

### 配置文件

主要配置在 `lib/config.js` 中，支持通过环境变量覆盖。

## 目录结构

```
juejin-download/
├── downloads/                    # 原始下载的 Markdown 文件
│   └── [小册名称]/
│       └── *.md
├── downloads-with-images/       # 处理后的文件（图片已本地化）
│   └── [小册名称]/
│       ├── *.md                 # 处理后的 Markdown
│       ├── images/               # 本地图片目录
│       ├── mapping.json          # 图片映射关系
│       └── missing-images.json   # 缺失图片记录（如果有）
├── log/                         # 日志文件目录
│   ├── batch-download-YYYY-MM-DD.log
│   ├── process-images-YYYY-MM-DD.log
│   └── fix-images-YYYY-MM-DD.log
├── lib/                         # 公共模块
│   ├── config.js                # 配置管理
│   └── logger.js                # 日志系统
├── main.js                      # 交互式下载脚本
├── batch-download.js            # 批量下载脚本
├── process-images.js            # 图片处理脚本
├── fix-missing-images.js        # 图片修复脚本
├── utils.js                     # 工具函数
└── cookies.json                 # Cookie 配置（需要自行配置）
```

## 功能说明

### 内容更新检测

- 使用 SHA256 哈希算法检测文件内容变化
- 文件不存在 → 下载
- 文件存在但内容不同 → 重新下载（标记为更新）
- 文件存在且内容相同 → 跳过

### 图片处理

- 支持 Markdown 和 HTML 格式的图片
- 自动下载图片到本地 `images/` 目录
- 替换图片链接为相对路径
- 已存在的图片使用缓存，不重复下载
- 自动清理不再使用的图片文件

### 日志系统

- 按日期分类的日志文件
- 支持日志级别（DEBUG, INFO, WARN, ERROR）
- 同时输出到控制台和文件

## 常见问题

### Q: 下载失败怎么办？

A: 
1. 检查 `cookies.json` 是否有效
2. 运行 `npm run test:api` 测试 API 连接
3. 查看日志文件了解详细错误信息

### Q: 图片下载失败怎么办？

A:
1. 运行 `npm run fix:images` 尝试重新下载
2. 查看各文件夹下的 `missing-images.json` 了解缺失的图片
3. 检查网络连接

### Q: 如何只下载新增的小册？

A: 直接运行 `npm run download:batch`，脚本会自动检测已下载的内容并跳过。

### Q: 如何更新已下载的小册？

A: 脚本会自动检测内容更新。如果小册内容有变化，会自动重新下载更新的章节。

## 预览
<img width="960" src="./video.gif" alt="video">

## 声明

本项目只做个人学习研究之用，不得用于商业用途！
