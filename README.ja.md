# TypeK

[繁體中文](README.md) | [简体中文](README.zh-CN.md) | [English](README.en.md) | **日本語** | [한국어](README.ko.md) | [Tiếng Việt](README.vi.md) | [ไทย](README.th.md)

> 押しながら話して、離すと貼り付け — 話し言葉を書き言葉にするデスクトップツール

TypeK はデスクトップ向けの音声入力ツールです。どのアプリでもショートカットキーを押しながら話し、離すと Groq Whisper が音声を文字起こしします。続いて AI が、入力中のアプリとカーソル前後のテキストを参考にして自然な書き言葉に整え、カーソル位置にそのまま貼り付けます。

TypeK はオープンソースプロジェクト [SayIt](https://github.com/chenjackle45/SayIt) の fork で、[MIT ライセンス](LICENSE)に基づいて改変・配布しています。

## 特長

- **話し言葉から書き言葉へ** — AI がフィラーを取り除き、同音異義語や句読点を直すので、話し終えたらすぐに使えます
- **コンテキスト認識**（macOS）— 整形時に現在のアプリ、ウィンドウタイトル、カーソル前後のテキストを参考にするため、固有名詞が正しくなりやすくなります。パスワード欄は読み取りません。設定でオフにできます
- **グローバルショートカット** — どのアプリでも使え、Hold／Toggle の 2 つのモードに対応
- **カスタム辞書** — 固有名詞や専門用語を正しく文字起こしし、あなたの修正から新しい語を学習します
- **履歴と統計** — すべての文字起こしを自動保存し、Dashboard で利用状況をひと目で確認できます

## インストール

### ダウンロード

| プラットフォーム | ダウンロード |
|------|---------|
| macOS（Apple シリコン：M1／M2／M3／M4…） | [TypeK-mac-arm64.dmg](https://github.com/kekukeku/TypeK/releases/latest/download/TypeK-mac-arm64.dmg) |
| Windows | [TypeK-windows-x64.exe](https://github.com/kekukeku/TypeK/releases/latest/download/TypeK-windows-x64.exe) |

macOS 版は Apple シリコン（M1／M2／M3／M4…）のみ対応です。Intel Mac 版は 1.3.3 から提供していません。

### macOS でのインストール

TypeK は現在 **Apple の署名と公証を受けていない**ため、初めて開くときに macOS にブロックされます。これは想定どおりの動作です：

1. ダウンロードした `.dmg` を開き、**TypeK** を「アプリケーション」フォルダにドラッグします
2. 「アプリケーション」フォルダで TypeK をダブルクリックすると、「開発元を検証できません」または「TypeK にマルウェアが含まれていないことを Apple は検証できませんでした」と表示されるので、「完了」または「キャンセル」をクリックします
3. 「システム設定 → プライバシーとセキュリティ」を開き、「セキュリティ」までスクロールします。「TypeK はブロックされました」の横にある「**このまま開く**」をクリックし、パスワードを入力して確定します
4. 以降は確認なしで普通に開けます

「“TypeK”は壊れているため開けません」と表示された場合は、「ターミナル」で次の 1 行を実行してから、もう一度開いてください：

```bash
xattr -dr com.apple.quarantine /Applications/TypeK.app
```

### macOS の権限

TypeK は初回使用時に 2 つの権限を求めます。どちらも許可してください：

- **マイク**：話した内容を録音するため
- **アクセシビリティ**（システム設定 → プライバシーとセキュリティ → アクセシビリティ）：ショートカットキーの検出、カーソル位置への貼り付け、入力欄の前後テキストの読み取りのため

署名がないため、**新しいバージョンにアップデートするとアクセシビリティ権限が無効になることがあります**。ショートカットキーが反応しない場合は、「アクセシビリティ」の一覧から TypeK を削除（−）し、もう一度追加（＋）してオンにしてください。

### アップデート

1.3.0 からアプリ内で更新できます。サイドバーの「更新を確認」を使うか、自動通知を待ってください。1.2.2 以前の場合は、新しいバージョンをダウンロードして上書きインストールしてください（アプリを先に削除する必要はありません）。

macOS では、自動更新には TypeK が「アプリケーション」フォルダにある必要があります。更新後にショートカットキーが反応しない場合は、システム設定 → プライバシーとセキュリティ → アクセシビリティで TypeK を削除してから、もう一度追加してオンにしてください。

### Windows でのインストール

`.exe` の実行時に「Windows によって PC が保護されました」と表示された場合は、「詳細情報」→「実行」をクリックしてください。

### 必要なもの

- [Groq API Key](https://console.groq.com/keys) — 音声の文字起こし（無料枠あり）
- [Gemini API Key](https://aistudio.google.com/apikey) — テキストの整形は既定で Gemini 3.1 Flash-Lite を使用（無料枠あり）。設定で Groq、OpenAI、Anthropic に切り替えることもできます

### クイックスタート

1. 上の手順でダウンロードしてインストールします
2. TypeK を開き → 設定画面 → Groq API Key と Gemini API Key を貼り付けます
3. どのアプリでも `Fn` キーを押しながら話し、離すとテキストが自動で貼り付けられます

## 技術構成

```
Tauri v2 (Rust) + Vue 3 + TypeScript

  ┌──────────────────────────────────┐
  │        Tauri Backend (Rust)      │
  │ ホットキー · クリップボード · 入力コンテキスト │
  └───────┬──────────────┬───────────┘
          │ invoke()     │ emit()
  ┌───────▼──┐    ┌──────▼───────────┐
  │   HUD    │    │    Dashboard     │
  │ 状態表示  │    │ 設定/履歴/統計   │
  └──────────┘    └──────────────────┘
```

- **Frontend** — Vue 3 + TypeScript + shadcn-vue + Tailwind CSS
- **Backend** — Rust (Tauri v2)
- **AI** — Groq Whisper（音声認識）+ Gemini／Groq／OpenAI／Anthropic（テキスト整形）
- **Storage** — SQLite（履歴）+ tauri-plugin-store（設定）

## 開発

### 必要な環境

- Node.js 24+
- pnpm 10+
- Rust stable
- Xcode Command Line Tools (macOS)

### コマンド

```bash
# 依存関係のインストール
pnpm install

# 開発モード
pnpm tauri dev

# ビルド
pnpm tauri build

# テスト
pnpm test

# 型チェック
npx vue-tsc --noEmit
```

### リリース

自動アップデートは 1.3.0 から有効です。App が GitHub Releases を確認して更新します。署名鍵とリリース手順は [docs/deployment-guide.md](docs/deployment-guide.md) を参照してください。

```bash
./scripts/release.sh X.Y.Z
# → バージョン番号の更新、commit、tag、push を自動で実行
# → GitHub Actions が macOS + Windows のインストーラーをビルド
# → ビルドが成功すると GitHub Release が自動で公開される
```

## License

[MIT](LICENSE)。TypeK は SayIt を改変したもので、MIT ライセンスに従い原作者の著作権表示を残しています。
