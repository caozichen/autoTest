# AutoTest 从零环境搭建与运行指南

本文面向第一次接触项目开发的读者。即使你刚开始学习计算机，只要按操作系统对应的章节逐步执行，也可以在一台全新的 Windows 或 Mac 电脑上完成 AutoTest 的下载、安装、启动和基本验证。

本文只介绍本地开发和运行环境。项目功能、内置脚本行为以及脚本可能产生的数据副作用，请继续阅读根目录的 `README.md`。

## 1. 最终会启动什么

AutoTest 不是单独的网页文件。标准启动命令会运行三个只允许本机访问的服务：

```text
浏览器
  |
  +-- Web 管理端（Vue + Vite）-------- http://127.0.0.1:5174
          |
          +-- 调用 Runner ------------ http://127.0.0.1:4310
          |       |
          |       +-- Google Chrome 无头模式
          |               |
          |               +-- 执行 Playwright 脚本并访问被测网站
          |
          +-- 请求 Supervisor -------- http://127.0.0.1:4311
```

三个服务的作用如下：

| 服务 | 作用 | 默认地址 |
| --- | --- | --- |
| Web | 登录、环境管理、脚本管理、流水线和运行记录界面 | `http://127.0.0.1:5174` |
| Runner | 接收运行请求，通过 Playwright 启动 Google Chrome 执行脚本 | `http://127.0.0.1:4310` |
| Supervisor | 启动 Web/Runner、持续恢复 Web，并供页面请求恢复 Runner | `http://127.0.0.1:4311` |

这些地址都绑定在 `127.0.0.1`，只能从当前电脑访问，不会自动开放给局域网或互联网。

## 2. 环境要求总览

### 2.1 必须安装的软件

| 软件 | 项目要求 | 本项目已验证版本 | 用途 |
| --- | --- | --- | --- |
| 操作系统 | Windows 10/11 64 位，或较新的 macOS | macOS 开发环境 | 运行项目 |
| Node.js | `>= 22.0.0` | `22.23.2` | 运行 Web 工具、Runner 和 Supervisor |
| npm | 项目未单独限制；使用 Node.js 22 自带版本即可 | `10.9.8` | 安装依赖和执行项目命令 |
| Git | 当前稳定版 Git 2.x；项目未限制最低版本 | `2.55.0` | 从 GitHub 下载和更新代码 |
| Google Chrome | 当前稳定版官方 Google Chrome；项目未锁定具体版本 | Chrome Stable | Playwright 指定使用 `channel: 'chrome'` 执行脚本 |

推荐使用 Node.js 22.x。高于 22 的新版本理论上满足项目的版本约束，但提交代码前应重新执行本文的完整校验命令。

### 2.2 建议的电脑配置

以下不是代码中的硬性限制，只是为了让安装和运行更顺畅：

- 至少 4 GB 内存，建议 8 GB 或更多。
- 至少预留 1 GB 可用磁盘空间。当前 `node_modules` 大约需要数百 MB，运行脚本还会产生截图、上传样例和日志。
- 能访问 GitHub、npm Registry 和实际被测网站的网络。
- 项目目录需要有普通用户的读写权限。

### 2.3 不需要安装的东西

本项目当前不需要以下组件：

- 不需要 Docker。
- 不需要 MySQL、PostgreSQL、Redis 或其他数据库。
- 不需要 Java、Python、.NET SDK。
- 不需要全局安装 Vue、Vite、TypeScript 或 Playwright。
- 不需要创建 `.env` 文件。
- 不需要执行 `npx playwright install` 或 `npx playwright install chromium`。

项目明确启动系统安装的 Google Chrome。只安装 Edge、Chromium 或 Playwright 自带浏览器不能替代官方 Google Chrome。

### 2.4 网络与端口要求

安装时需要访问：

- `https://github.com/`：克隆项目。
- `https://registry.npmjs.org/`：下载 npm 依赖。
- `https://www.google.com/chrome/`：下载 Google Chrome。

执行内置真实脚本时，还需要能访问环境管理中配置的 Web/API。项目预设环境指向 `lx.admin.lingxi.tech` 相关站点。

以下端口必须未被其他程序占用：

| 端口 | 用途 | 是否可随意修改 |
| --- | --- | --- |
| `5174` | Web 开发服务 | 不建议，Vite 使用严格端口，Runner CORS 也依赖它 |
| `4310` | Playwright Runner | 不建议，Web 和 Supervisor 固定连接这个端口 |
| `4311` | Supervisor | 不建议，Web 固定连接这个端口 |
| `4173` | Web 生产构建预览 | 只在执行 preview 命令时使用 |

Runner 代码虽然支持 `AUTOTEST_RUNNER_PORT`，但 Web 与 Supervisor 目前仍固定访问 `4310`。新手不要设置这个环境变量，否则页面会连接不到 Runner。

## 3. npm 依赖及版本

你不需要逐个安装下面的 npm 包。后文的 `npm ci` 会读取根目录 `package-lock.json`，一次安装根项目、`apps/web` 和 `apps/api` 三部分所需的全部依赖。

### 3.1 运行时和界面依赖

| 依赖 | `package.json` 声明 | 当前锁定版本 | 用途 |
| --- | --- | --- | --- |
| Vue | `^3.5.13` | `3.5.41` | Web 界面框架 |
| Vue Router | `^4.5.0` | `4.6.4` | 页面路由 |
| Pinia | `^3.0.1` | `3.0.4` | 前端状态管理 |
| Element Plus | `^2.9.6` | `2.14.4` | UI 组件库 |
| Element Plus Icons | `^2.3.1` | `2.3.2` | 图标组件 |
| ECharts | `^6.1.0` | `6.1.0` | 图表 |
| Playwright Test | `^1.62.1` | `1.62.1` | Google Chrome 自动化和断言 |
| concurrently | `^10.0.4` | `10.0.4` | 开发工具依赖 |

### 3.2 构建和测试依赖

| 依赖 | `package.json` 声明 | 当前锁定版本 | 用途 |
| --- | --- | --- | --- |
| TypeScript | `~5.7.2` | `5.7.3` | 类型检查和编译 |
| Vite | `^6.2.2` | `6.4.3` | Web 开发服务和构建 |
| Vite Vue Plugin | `^5.2.3` | `5.2.4` | 编译 Vue 单文件组件 |
| Vitest | `^3.0.8` | `3.2.7` | Web 单元测试 |
| vue-tsc | `^2.2.8` | `2.2.12` | Vue TypeScript 类型检查 |
| jsdom | `^26.0.0` | `26.1.0` | Web 测试 DOM 环境 |
| `@types/node` | `^22.13.10` | `22.20.1` | Node.js 类型定义 |
| `@tsconfig/node22` | `^22.0.0` | `22.0.5` | Node.js 22 TypeScript 配置 |
| `@vue/tsconfig` | `^0.7.0` | `0.7.0` | Vue TypeScript 配置 |

“声明版本”允许 npm 在兼容范围内选择版本；“当前锁定版本”是本仓库 `package-lock.json` 记录的实际版本。全新克隆后使用 `npm ci`，才能最稳定地复现锁定版本。

`apps/api` 没有单独声明第三方依赖，它使用 Node.js 原生 HTTP 模块和根项目安装的 Playwright。`playwright`、`playwright-core` 会作为 `@playwright/test` 的依赖一并安装，当前锁定版本同为 `1.62.1`。

## 4. 开始前先认识两个概念

### 4.1 终端是什么

终端是输入命令的窗口：

- Windows 使用 PowerShell。
- macOS 使用“终端”应用，默认 Shell 为 zsh。

本文代码块中的命令需要逐条执行。每输入一条命令，就按一次回车。不要把代码块上方的说明文字一起输入。

### 4.2 什么是项目根目录

项目根目录是克隆后名为 `autoTest` 的文件夹，其中能看到：

```text
package.json
package-lock.json
README.md
apps/
scripts/
```

除非命令特别说明，本文所有 npm 命令都必须在这个根目录执行。不要分别进入 `apps/web` 和 `apps/api` 再安装依赖。

---

## 5. Windows 10/11 从零搭建

### W1. 打开 PowerShell

1. 按键盘上的 Windows 键。
2. 输入 `PowerShell`。
3. 打开“Windows PowerShell”或“PowerShell”。
4. 后续项目命令不需要“以管理员身份运行”。只有安装软件时，安装器可能请求管理员权限。

建议使用 Windows 自带 PowerShell 5.1 或更新版本。Windows Terminal 和 PowerShell 7 可以安装，但不是项目必需品。

### W2. 安装 Git

#### 图形安装方式（推荐新手）

1. 打开 `https://git-scm.com/download/win`。
2. 下载当前稳定版 Git for Windows 64 位安装器。
3. 运行安装器，保持默认选项即可。
4. 安装完成后关闭并重新打开 PowerShell。

也可以用 Windows Package Manager 安装：

```powershell
winget install --id Git.Git -e --source winget
```

验证安装：

```powershell
git --version
```

看到类似 `git version 2.x.x` 就表示成功。

### W3. 安装 Node.js 和 npm

#### 图形安装方式（推荐新手）

1. 打开 `https://nodejs.org/dist/latest-v22.x/`。
2. 普通 Intel/AMD 64 位 Windows 下载文件名以 `-x64.msi` 结尾的安装器。
3. Windows on ARM 设备下载文件名以 `-arm64.msi` 结尾的安装器。
4. 运行安装器，保持 `npm package manager` 和 `Add to PATH` 选项启用。
5. 安装完成后关闭并重新打开 PowerShell。

如果使用 `winget` 安装当前 Node.js LTS，也可以执行：

```powershell
winget install --id OpenJS.NodeJS.LTS -e --source winget
```

安装后必须确认版本不低于 22：

```powershell
node --version
npm.cmd --version
node -p "Number(process.versions.node.split('.')[0]) >= 22"
```

预期结果：

- `node --version` 显示 `v22.x.x` 或更高版本。
- `npm.cmd --version` 通常显示 `10.x.x` 或更高版本。
- 最后一条命令显示 `true`。

Windows 章节统一写 `npm.cmd`，这是为了避开 PowerShell 可能禁止执行 `npm.ps1` 的常见问题，不需要为了运行项目修改系统执行策略。

### W4. 安装 Google Chrome

1. 打开 `https://www.google.com/chrome/`。
2. 下载并安装官方稳定版 Google Chrome。
3. 安装后手动打开一次 Chrome，让它完成首次启动和更新。

可以在 PowerShell 检查常见安装位置：

```powershell
Test-Path "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
Test-Path "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
Test-Path "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
```

通常至少一行会显示 `True`。Google Chrome 可以正常从开始菜单打开时，Playwright 一般能够自动找到它。

### W5. 一次检查全部基础环境

关闭旧 PowerShell，重新打开一个新窗口，然后执行：

```powershell
git --version
node --version
npm.cmd --version
```

如果任意命令提示“无法将其识别为 cmdlet”或“不是内部或外部命令”，先不要继续克隆项目，请到“Windows 常见问题”查找 PATH 相关解决方法。

### W6. 下载项目

建议将代码放在简短、纯英文、非 OneDrive 同步目录中，减少路径、权限和文件同步问题。

```powershell
New-Item -ItemType Directory -Force -Path C:\Projects | Out-Null
Set-Location C:\Projects
git clone https://github.com/caozichen/autoTest.git
Set-Location .\autoTest
```

确认自己位于项目根目录：

```powershell
Get-Location
Test-Path .\package.json
```

第二条命令必须显示 `True`。如果 `C:\Projects\autoTest` 已经存在，不要再次执行 `git clone`，直接执行：

```powershell
Set-Location C:\Projects\autoTest
```

### W7. 安装项目依赖

全新克隆后推荐执行：

```powershell
npm.cmd ci
```

这个命令会读取 `package-lock.json`，同时安装根项目、Web 和 API workspace 的依赖。根据网络速度，第一次安装可能需要几分钟。

安装完成后可以查看顶层依赖：

```powershell
npm.cmd ls --depth=0 --workspaces --include-workspace-root
```

注意：

- 不要运行 `sudo`，Windows 也没有这个项目步骤。
- 不要全局安装 Vue、Vite、TypeScript 或 Playwright。
- 不要分别进入 `apps/web` 和 `apps/api` 执行安装。
- 不要执行 `npx playwright install`，本项目使用系统 Google Chrome。
- 日后主动修改依赖时才使用 `npm.cmd install`；单纯搭建或还原环境优先使用 `npm.cmd ci`。

### W8. 启动项目

仍在 `C:\Projects\autoTest` 根目录执行：

```powershell
npm.cmd run dev
```

这个窗口必须保持打开。正常情况下会看到类似日志：

```text
[supervisor] 本地服务管理器: http://127.0.0.1:4311
[runner] Playwright runner: http://127.0.0.1:4310
Local: http://127.0.0.1:5174/
```

启动后打开页面：

```powershell
Start-Process "http://127.0.0.1:5174"
```

也可以手动在浏览器地址栏输入：

```text
http://127.0.0.1:5174
```

本地管理端登录账号：

```text
用户名：admin
密码：admin123
```

这是本机界面的固定开发账号，不是远端业务系统账号，也不是生产级认证方案。

### W9. 确认三个服务正常

不要关闭正在运行 `npm.cmd run dev` 的窗口。再打开一个 PowerShell 窗口，执行：

```powershell
Invoke-RestMethod http://127.0.0.1:4310/health
Invoke-RestMethod http://127.0.0.1:4311/health
Test-NetConnection 127.0.0.1 -Port 5174
```

正确结果：

- Runner 返回 `ok = True`，service 为 `autotest-playwright-runner`。
- Supervisor 返回 `ok = True`，service 为 `autotest-local-supervisor`。
- `Test-NetConnection` 显示 `TcpTestSucceeded : True`。
- 浏览器能打开登录页并使用 `admin / admin123` 登录。

做到这里，Windows 本地运行环境已经搭建完成。

### W10. 停止项目

回到运行 `npm.cmd run dev` 的 PowerShell 窗口，按：

```text
Ctrl + C
```

等待 Web、Runner 和 Supervisor 结束。如果 PowerShell 询问是否终止批处理，输入 `Y` 后按回车。

Windows 不要执行 `npm.cmd run install:supervisor`，该命令只支持 macOS。Windows 日常使用时需要保持 `npm.cmd run dev` 的窗口开启。

### W11. 排障时分别启动 Web 和 Runner

标准用法优先使用 `npm.cmd run dev`。只有排查某个服务的错误时，才打开两个 PowerShell 窗口分别执行：

窗口 1：

```powershell
Set-Location C:\Projects\autoTest
npm.cmd run dev:web
```

窗口 2：

```powershell
Set-Location C:\Projects\autoTest
npm.cmd run dev:api
```

这种方式没有启动 Supervisor，因此 `4311` 不在线，页面里的“启动 Runner”按钮也不能拉起一个已停止的 Runner。只要 `4310` 在线，脚本运行功能本身仍可使用。

### Windows 常见问题

#### WQ1. `git`、`node` 或 `npm` 无法识别

先关闭全部 PowerShell 窗口，再打开一个新窗口。检查程序路径：

```powershell
where.exe git
where.exe node
where.exe npm
```

仍然没有结果时，重新运行对应安装器，并确认启用了“Add to PATH”或命令行支持。

#### WQ2. `npm.ps1 cannot be loaded because running scripts is disabled`

使用本文中的 `npm.cmd`：

```powershell
npm.cmd ci
npm.cmd run dev
```

不建议新手为了这个问题执行 `Set-ExecutionPolicy Unrestricted`。

#### WQ3. 出现 `npm WARN EBADENGINE`

检查：

```powershell
node --version
where.exe node
```

如果是 Node 18 或 20，请卸载旧版本或修正 PATH，直到 `node --version` 至少为 `v22.0.0`。

#### WQ4. 出现 `EADDRINUSE` 或 `Port 5174 is already in use`

通常是之前启动的 AutoTest 还没有停止。先找到原来的 PowerShell 窗口并按 `Ctrl + C`。也可以只读查询端口：

```powershell
Get-NetTCPConnection -LocalPort 5174,4310,4311 -ErrorAction SilentlyContinue |
  Select-Object LocalPort, State, OwningProcess
```

确认 PID 是自己之前启动的 Node 进程后，才可以执行：

```powershell
# 下面以 PID 12345 为例，请替换成查询到的真实数字
Stop-Process -Id 12345
```

不要在没有确认进程用途时终止它。

#### WQ5. 页面打不开

- 确认 `npm.cmd run dev` 的窗口仍然打开。
- 地址必须是 `http://127.0.0.1:5174`，不是 `https://`。
- 执行 W9 的三个健康检查，判断是 Web、Runner 还是 Supervisor 没有启动。
- 查看启动窗口最早出现的错误，不要只看最后一行。

#### WQ6. 页面能打开，但显示 Runner 离线

```powershell
Invoke-RestMethod http://127.0.0.1:4310/health
```

如果请求失败，回到标准启动窗口按 `Ctrl + C`，然后重新执行 `npm.cmd run dev`。只启动 Web 时，自动化脚本无法执行。

#### WQ7. 找不到 Chrome 或 `channel chrome` 启动失败

确认安装的是官方 Google Chrome Stable，不是只有 Microsoft Edge。手动启动 Chrome 一次并完成更新，然后重新启动 AutoTest。

#### WQ8. npm 下载超时或证书错误

```powershell
npm.cmd config get registry
npm.cmd cache verify
```

Registry 通常应为 `https://registry.npmjs.org/`。检查代理、VPN、公司网络和证书配置。不要通过关闭 npm 的 SSL 校验来绕过公司证书问题。

#### WQ9. `EPERM`、文件被占用或依赖目录异常

先按 `Ctrl + C` 停止项目，关闭正在占用项目文件的终端或编辑器，再回到项目根目录执行：

```powershell
npm.cmd ci
```

`npm ci` 会按照锁文件重新建立依赖目录。执行前再次确认当前目录是 `C:\Projects\autoTest`。

#### WQ10. 登录失败

本地登录固定使用：

```text
admin / admin123
```

不要在这里输入 GitHub 密码或远端测试环境账号。

---

## 6. macOS 从零搭建

### M1. 打开终端

1. 按 `Command + 空格` 打开聚焦搜索。
2. 输入“终端”或 `Terminal`。
3. 按回车打开。
4. 后续命令按顺序逐条执行。

项目没有声明 macOS 最低版本。建议使用 macOS 13 或更新版本。Apple Silicon（M1/M2/M3/M4 等）和 Intel Mac 均可运行。

### M2. 安装 Git 和命令行工具

执行：

```bash
xcode-select --install
```

系统弹出窗口后选择“安装”。这里只需要 Xcode Command Line Tools，不需要安装完整 Xcode。

安装完成后检查：

```bash
xcode-select -p
git --version
```

看到类似 `git version 2.x.x` 就表示成功。如果系统提示工具已经安装，可以直接继续。

### M3. 安装 Homebrew

Homebrew 不是项目运行依赖，它只是方便安装 Node.js 和 Google Chrome 的软件管理器。

执行 Homebrew 官方安装命令：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

安装过程可能要求输入当前 Mac 用户密码。终端输入密码时不会显示星号，这是正常现象，输入完成后按回车。

查看芯片架构：

```bash
uname -m
```

如果显示 `arm64`，执行：

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
eval "$(/opt/homebrew/bin/brew shellenv)"
```

如果显示 `x86_64`，执行：

```bash
echo 'eval "$(/usr/local/bin/brew shellenv)"' >> "$HOME/.zprofile"
eval "$(/usr/local/bin/brew shellenv)"
```

验证：

```bash
brew --version
```

### M4. 安装 Node.js 22 和 npm

```bash
brew install node@22
echo 'export PATH="$(brew --prefix node@22)/bin:$PATH"' >> "$HOME/.zshrc"
source "$HOME/.zshrc"
```

检查版本：

```bash
node --version
npm --version
node -p "Number(process.versions.node.split('.')[0]) >= 22"
```

预期 Node 显示 `v22.x.x`，最后一条命令显示 `true`。

Apple Silicon 用户可以检查 Node 是否为原生 ARM 版本：

```bash
uname -m
node -p "process.arch"
```

Apple Silicon 的正常结果应都是 `arm64`。如果一个显示 `arm64`、另一个显示 `x64`，请退出 Rosetta 模式的终端后重新安装 Node。

不想安装 Homebrew 时，也可以从 `https://nodejs.org/dist/latest-v22.x/` 下载官方 macOS 安装包。无论采用哪种方式，都以 `node --version` 至少为 `v22.0.0` 为准。

### M5. 安装 Google Chrome

使用 Homebrew：

```bash
brew install --cask google-chrome
```

也可以从 `https://www.google.com/chrome/` 下载官方安装包。

安装后从“应用程序”手动打开一次 Google Chrome，让 macOS 完成首次安全验证。检查默认安装位置：

```bash
test -d "/Applications/Google Chrome.app" && echo "Google Chrome 已安装"
```

应该显示“Google Chrome 已安装”。不要执行 `npx playwright install chromium`，项目不会使用它来替代系统 Chrome。

### M6. 下载项目

```bash
mkdir -p "$HOME/Projects"
cd "$HOME/Projects"
git clone https://github.com/caozichen/autoTest.git
cd autoTest
```

确认当前目录：

```bash
pwd
test -f package.json && echo "当前位于项目根目录"
```

正常会显示以 `/Projects/autoTest` 结尾的路径和“当前位于项目根目录”。如果目录已经存在，不要再次克隆，直接执行：

```bash
cd "$HOME/Projects/autoTest"
```

### M7. 安装项目依赖

全新克隆后执行：

```bash
npm ci
```

根目录使用 npm workspaces，这一条命令会安装根项目、Web 和 API 的全部依赖。

验证顶层依赖：

```bash
npm ls --depth=0 --workspaces --include-workspace-root
```

注意：

- 不要使用 `sudo npm ci` 或 `sudo npm install`。
- 不要分别进入 `apps/web` 和 `apps/api` 安装。
- 不要全局安装 Vue、Vite、TypeScript 或 Playwright。
- 不要执行 `npx playwright install`。
- 日后主动修改依赖时才使用 `npm install`；搭建和还原环境优先使用 `npm ci`。

### M8. 启动项目

在项目根目录执行：

```bash
npm run dev
```

保持终端窗口打开。正常会看到 Web `5174`、Runner `4310` 和 Supervisor `4311` 的启动日志。

使用默认浏览器打开：

```bash
open "http://127.0.0.1:5174"
```

登录账号：

```text
用户名：admin
密码：admin123
```

### M9. 确认三个服务正常

不要关闭运行项目的终端。再打开一个终端，执行：

```bash
curl http://127.0.0.1:4310/health
curl http://127.0.0.1:4311/health
curl -I http://127.0.0.1:5174
```

正确结果：

- 前两个命令返回包含 `"ok":true` 的 JSON。
- Web 请求返回 `HTTP/1.1 200 OK`。
- 浏览器能打开登录页并使用 `admin / admin123` 登录。

做到这里，macOS 本地运行环境已经搭建完成。

### M10. 停止项目

回到执行 `npm run dev` 的终端，按：

```text
Control + C
```

等待 Web、Runner 和 Supervisor 停止。

### M11. 可选：安装 macOS 登录自启服务

新手应先按 M8-M10 确认前台运行正常。需要登录 Mac 后自动启动 AutoTest 时：

1. 先用 `Control + C` 停止前台运行的项目。
2. 在项目根目录执行：

```bash
npm run install:supervisor
```

该命令会创建并加载：

```text
~/Library/LaunchAgents/tech.lingxi.autotest.supervisor.plist
```

Supervisor 会在用户登录后启动并保持运行，日志写入：

```text
outputs/local-supervisor.log
outputs/local-supervisor.error.log
```

重要注意事项：

- 这个安装器只支持 macOS，Windows 不可使用。
- 配置记录当前 Node 可执行文件和项目目录的绝对路径。
- 以后移动项目、删除当前 Node.js 版本或改变 Node 安装位置后，需要重新执行安装命令。
- 安装自启后不需要保持 Terminal 窗口打开。

只停止当前自动服务可以执行：

```bash
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/tech.lingxi.autotest.supervisor.plist"
```

### M12. 排障时分别启动 Web 和 Runner

标准用法优先使用 `npm run dev`。排障时可打开两个终端：

终端 1：

```bash
cd "$HOME/Projects/autoTest"
npm run dev:web
```

终端 2：

```bash
cd "$HOME/Projects/autoTest"
npm run dev:api
```

这种方式不会启动 `4311` Supervisor，页面里的“启动 Runner”按钮因此不可用。

### macOS 常见问题

#### MQ1. `command not found: brew`

按照 M3 中的芯片类型重新执行对应的 `brew shellenv` 命令，然后关闭并重新打开终端。

#### MQ2. `command not found: node`

```bash
source "$HOME/.zshrc"
which node
node --version
```

仍然找不到时，重新执行 M4 的 Node 安装和 PATH 配置。

#### MQ3. 出现 `npm ERR! EBADENGINE`

```bash
node --version
which node
```

确保终端实际使用的 Node 至少为 `v22.0.0`。

#### MQ4. 找不到 Google Chrome

确认应用存在：

```bash
ls -ld "/Applications/Google Chrome.app"
```

如果不存在，重新执行 `brew install --cask google-chrome` 或从官网下载。安装后手动打开一次。

#### MQ5. 端口被占用

逐个检查：

```bash
lsof -nP -iTCP:5174 -sTCP:LISTEN
lsof -nP -iTCP:4310 -sTCP:LISTEN
lsof -nP -iTCP:4311 -sTCP:LISTEN
```

先回到原来运行 AutoTest 的终端按 `Control + C`。只有确认 PID 是自己之前启动的 Node 进程时，才执行：

```bash
# 下面以 PID 12345 为例，请替换成查询到的真实数字
kill 12345
```

#### MQ6. 页面能打开但 Runner 离线

```bash
curl http://127.0.0.1:4310/health
```

如果连接失败，停止并重新执行 `npm run dev`。只启动 Web 时无法执行自动化脚本。

#### MQ7. npm 安装出现 `EACCES`

不要改用 `sudo npm install`。确认项目位于自己的用户目录，例如 `$HOME/Projects/autoTest`，然后执行：

```bash
cd "$HOME/Projects/autoTest"
npm ci
```

#### MQ8. npm 下载失败

```bash
npm config get registry
npm cache verify
```

Registry 通常应为 `https://registry.npmjs.org/`。检查网络、代理、VPN 和公司证书，不要关闭 SSL 校验。

#### MQ9. Apple Silicon 架构不一致

```bash
uname -m
node -p "process.arch"
```

Apple Silicon 正常应都显示 `arm64`。关闭“使用 Rosetta 打开”的终端后重新安装 Node。

#### MQ10. macOS 自动启动异常

检查日志：

```bash
tail -n 100 outputs/local-supervisor.log
tail -n 100 outputs/local-supervisor.error.log
```

如果移动过项目或更换过 Node 安装位置，请在新的项目根目录重新执行 `npm run install:supervisor`。

## 7. 第一次运行时应该做什么

成功登录后，建议按以下顺序熟悉项目：

1. 打开“系统设置”，确认 Runner 显示在线。
2. 打开“环境管理”，查看预设环境，但先不要修改凭据。
3. 打开“脚本管理”和“自动化配置”，只查看已有内容。
4. 打开“运行记录”，了解本地记录结构。

不要把“页面可以打开”和“业务脚本可以安全执行”当成同一件事。内置脚本会访问远端测试环境，其中一些操作会：

- 创建和发布真实表单。
- 上传文件。
- 提交真实数据。
- 修改现有提报。

只有在确认你拥有目标系统授权、了解脚本说明和副作用后，才运行这些脚本。仅验证环境安装是否成功，不需要运行任何业务脚本。

Google Chrome 使用无头模式运行。点击脚本运行后没有弹出 Chrome 窗口是正常现象，应在 AutoTest 的日志和运行记录中查看结果。

## 8. 开发、测试和构建命令

### Windows PowerShell

```powershell
# 类型检查
npm.cmd run typecheck

# Web 单元测试，不启动 Chrome
npm.cmd run test --workspace @autotest/web

# 完整测试，包括会启动 Google Chrome 的 API 测试
npm.cmd test

# 构建 Web，产物位于 apps\web\dist
npm.cmd run build
```

### macOS Terminal

```bash
# 类型检查
npm run typecheck

# Web 单元测试，不启动 Chrome
npm run test --workspace @autotest/web

# 完整测试，包括会启动 Google Chrome 的 API 测试
npm test

# 构建 Web，产物位于 apps/web/dist
npm run build
```

完整测试中的 API 用例会启动本机 Google Chrome。普通 Terminal 或 PowerShell 可以直接运行。如果在带有浏览器沙箱限制的自动化编码工具中运行 macOS Chrome 测试，需要允许它在沙箱外启动 Chrome；不要修改 `scripts/support/google-chrome.mjs` 来绕过保护。

API 使用 `.mjs` 源码直接运行，没有单独编译产物。根目录 `npm run build` 只构建 Web。

## 9. 预览生产构建

普通本地开发请继续使用 `npm run dev`。需要检查 Web 的生产构建时，先执行构建，然后分别启动 Web preview 和 Runner。

### Windows

PowerShell 窗口 1：

```powershell
npm.cmd run build
npm.cmd run preview --workspace @autotest/web
```

PowerShell 窗口 2：

```powershell
npm.cmd run start --workspace @autotest/api
```

### macOS

终端 1：

```bash
npm run build
npm run preview --workspace @autotest/web
```

终端 2：

```bash
npm run start --workspace @autotest/api
```

访问 `http://127.0.0.1:4173`。预览模式不会启动 Supervisor，因此页面无法通过 `4311` 自动拉起 Runner，必须保持第二个终端中的 API 在线。

## 10. 项目数据保存在哪里

当前版本没有数据库：

- 环境和流水线保存在浏览器 `localStorage`。
- 登录状态、Token 和运行时变量保存在浏览器 `sessionStorage`。
- 脚本基础配置保存在项目 `config/scripts/`，每个脚本一个 JSON 文件。
- 运行记录保存在项目 `data/run-records/`，每个运行批次一个 JSON 文件。
- 脚本生成的截图、临时文件和 Supervisor 日志写在项目根目录 `outputs/`。

因此：

- 清除浏览器网站数据会清除环境、流水线或登录状态，但不会删除脚本配置和运行记录文件。
- `config/scripts/` 应随 Git 提交，可以随代码迁移；`data/run-records/` 默认被 Git 忽略，需要单独备份才能迁移历史记录。
- `outputs/` 需要保持可写，但它不应作为数据库或长期备份。

## 11. 关于环境变量

完成基础安装和启动时，不需要创建 `.env`，也不需要设置任何操作系统环境变量。

脚本编辑器和流水线中出现的 `HEADER_IMAGE_PATH`、`SUBMISSION_ID`、`FORM_ID`、`SUBMISSION_ASSERTIONS`、`SUBMISSION_EDIT_VALUES` 等，是每次脚本运行的输入参数或运行时变量，不是安装 Node.js 时要配置的 `.env` 内容。

预设环境的 Token 由“环境管理”中的登录配置获取，安装阶段不需要把 Token 写入文件。

## 12. 日后更新项目

先停止正在运行的 AutoTest，然后进入项目根目录。

Windows：

```powershell
Set-Location C:\Projects\autoTest
git pull
npm.cmd ci
npm.cmd run dev
```

macOS：

```bash
cd "$HOME/Projects/autoTest"
git pull
npm ci
npm run dev
```

如果 `git pull` 提示本地修改会被覆盖，不要删除文件或强制重置。先运行 `git status`，保存自己的改动并向项目维护者确认合并方式。

## 13. 搭建完成检查表

逐项确认：

- [ ] `git --version` 能显示 Git 2.x。
- [ ] `node --version` 至少为 `v22.0.0`。
- [ ] npm 能显示版本号。
- [ ] 官方 Google Chrome 已安装并能手动打开。
- [ ] 已从 GitHub 克隆 `autoTest`。
- [ ] 已在项目根目录成功执行 `npm ci`。
- [ ] `npm run dev` 或 `npm.cmd run dev` 保持运行。
- [ ] `http://127.0.0.1:5174` 能打开。
- [ ] 能使用 `admin / admin123` 登录。
- [ ] Runner `4310/health` 返回 `ok: true`。
- [ ] Supervisor `4311/health` 返回 `ok: true`。
- [ ] 已了解内置业务脚本可能修改远端真实数据，不会在未授权时运行。

全部完成后，这台电脑已经具备从源码运行和继续开发 AutoTest 的完整基础环境。
