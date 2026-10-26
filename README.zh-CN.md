# TypeK

[繁體中文](README.md) | **简体中文** | [English](README.en.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Tiếng Việt](README.vi.md) | [ไทย](README.th.md)

> 按住说话，松开粘贴 — 语音转书面语桌面工具

TypeK 是一款桌面语音输入工具。在任何应用中按住快捷键说话，松开后语音经 Groq Whisper 转录，再由 AI 根据你正在输入的应用和光标前后的文字，整理成通顺的书面语，直接粘贴到光标位置。

TypeK 是开源项目 [SayIt](https://github.com/chenjackle45/SayIt) 的 fork，依 [MIT 许可证](LICENSE)修改与分发。

## 特色

- **口语到书面语** — AI 自动去除赘词、修正同音字与标点，说完即可用
- **上下文感知**（macOS）— 整理时参考当前的应用、窗口标题和光标前后的文字，专有名词更容易改对；不读取密码框，可在设置中关闭
- **全局快捷键** — 在任何应用中触发，支持 Hold / Toggle 两种模式
- **自定义词汇词典** — 确保专有名词、技术术语正确转录，并从你的修改中学习新词
- **历史记录与统计** — 自动保存所有转录，Dashboard 一览使用情况

## 安装

### 下载

| 平台 | 下载链接 |
|------|---------|
| macOS（Apple Silicon：M1／M2／M3／M4…） | [TypeK-mac-arm64.dmg](https://github.com/kekukeku/TypeK/releases/latest/download/TypeK-mac-arm64.dmg) |
| Windows | [TypeK-windows-x64.exe](https://github.com/kekukeku/TypeK/releases/latest/download/TypeK-windows-x64.exe) |

macOS 版只支持 Apple Silicon（M1／M2／M3／M4…）；从 1.3.3 起不再提供 Intel Mac 版本。

### macOS 安装步骤

TypeK 使用自签名证书“TypeK Code Signing”签名，但**没有 Apple Developer ID，也没有经过公证**，所以第一次打开会被 macOS 拦下，这是正常的，只需要处理一次：

1. 打开下载的 `.dmg`，把 **TypeK** 拖进“应用程序”文件夹
2. 在“应用程序”文件夹中双击 TypeK，macOS 会显示“无法验证开发者”或“Apple 无法验证 TypeK 是否包含恶意软件”，点“完成”或“取消”
3. 打开“系统设置 → 隐私与安全性”，向下滚动到“安全性”，看到“已阻止 TypeK”，点“**仍要打开**”，再输入密码确认
4. 之后就能正常打开，不会再问

如果出现“TypeK 已损坏，无法打开”，在“终端”执行下面这行再打开一次：

```bash
xattr -dr com.apple.quarantine /Applications/TypeK.app
```

### macOS 权限

TypeK 第一次使用时会请求两项权限，都要允许：

- **麦克风**：录下你说的话
- **辅助功能**（系统设置 → 隐私与安全性 → 辅助功能）：检测快捷键、把文字粘贴到光标位置、读取输入框前后的文字

从 1.3.3 起每个版本都用同一张证书签名，**App 内更新后会保留这两项权限，无需重新授权**。从 1.3.1 及更早版本更新上来时，需要最后一次在“辅助功能”列表中把 TypeK 移除（−），再重新添加（＋）并打开。

如果快捷键仍然没反应（系统设置显示已打开，实际却不起作用），先退出 TypeK，在“终端”执行下面这行：它会清除 TypeK 旧的辅助功能授权并打开设置页，再把 TypeK 添加回列表并打开、重新启动 App 即可。这行只重置 TypeK，不会影响其他 App。

```bash
tccutil reset Accessibility com.kekukeku.typek && open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
```

### 更新

1.3.0 起可以直接在 App 内更新：侧边栏的“检查更新”，或等 App 自动通知。1.2.2 以前的使用者请下载新版覆盖安装一次（不用先删除 App）。

macOS：TypeK 要放在“应用程序”文件夹才能自动更新。更新后权限会保留；如果快捷键没反应，见上方“macOS 权限”的故障排除。

### Windows 安装步骤

运行 `.exe` 时如果出现“Windows 已保护你的电脑”，点“更多信息”→“仍要运行”。

### 前置条件

- [Groq API Key](https://console.groq.com/keys) — 语音转录（免费额度）
- [Gemini API Key](https://aistudio.google.com/apikey) — 文字整理默认使用 Gemini 3.1 Flash-Lite（免费额度）；也可在设置中改用 Groq、OpenAI 或 Anthropic

### 快速开始

1. 按上面的步骤下载并安装
2. 打开 TypeK → 设置页面 → 粘贴 Groq API Key 和 Gemini API Key
3. 在任何应用中按住 `Fn` 键说话，松开后文字自动粘贴

## 技术架构

```
Tauri v2 (Rust) + Vue 3 + TypeScript

  ┌──────────────────────────────────┐
  │        Tauri Backend (Rust)      │
  │  全局热键 · 剪贴板 · 输入上下文  │
  └───────┬──────────────┬───────────┘
          │ invoke()     │ emit()
  ┌───────▼──┐    ┌──────▼───────────┐
  │   HUD    │    │    Dashboard     │
  │ 状态浮窗  │    │ 设置/历史/统计   │
  └──────────┘    └──────────────────┘
```

- **Frontend** — Vue 3 + TypeScript + shadcn-vue + Tailwind CSS
- **Backend** — Rust (Tauri v2)
- **AI** — Groq Whisper（语音转文字）+ Gemini／Groq／OpenAI／Anthropic（文字整理）
- **Storage** — SQLite（历史记录）+ tauri-plugin-store（设置）

## 开发

### 环境要求

- Node.js 24+
- pnpm 10+
- Rust stable
- Xcode Command Line Tools (macOS)

### 命令

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm tauri dev

# 构建
pnpm tauri build

# 测试
pnpm test

# 类型检查
npx vue-tsc --noEmit
```

### 发布

自动更新已启用（1.3.0 起）：App 会从 GitHub Releases 检查更新；密钥与发版步骤见 [docs/deployment-guide.md](docs/deployment-guide.md)。

```bash
./scripts/release.sh X.Y.Z
# → 自动更新版本号、commit、tag、push
# → GitHub Actions 构建 macOS + Windows 安装包
# → 打包成功后自动公开 GitHub Release
```

## License

[MIT](LICENSE)。TypeK 修改自 SayIt，依 MIT 许可证保留原作者的版权声明。
