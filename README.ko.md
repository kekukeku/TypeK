# TypeK

[繁體中文](README.md) | [简体中文](README.zh-CN.md) | [English](README.en.md) | [日本語](README.ja.md) | **한국어** | [Tiếng Việt](README.vi.md) | [ไทย](README.th.md)

> 누르고 말하고, 떼면 붙여넣기 — 말을 글로 바꿔 주는 데스크톱 도구

TypeK는 데스크톱 음성 입력 도구입니다. 어떤 앱에서든 단축키를 누른 채 말하고 손을 떼면 Groq Whisper가 음성을 받아쓰고, AI가 지금 입력 중인 앱과 커서 앞뒤의 텍스트를 참고해 자연스러운 글로 다듬은 뒤 커서 위치에 바로 붙여넣습니다.

TypeK는 오픈소스 프로젝트 [SayIt](https://github.com/chenjackle45/SayIt)의 fork이며, [MIT 라이선스](LICENSE)에 따라 수정·배포합니다.

## 특징

- **말에서 글로** — AI가 군더더기 말을 없애고 동음이의어와 문장 부호를 고쳐 주므로, 말을 마치면 바로 쓸 수 있습니다
- **문맥 인식**(macOS) — 다듬을 때 현재 앱, 창 제목, 커서 앞뒤의 텍스트를 참고하므로 고유명사가 더 정확해집니다. 비밀번호 입력란은 읽지 않으며, 설정에서 끌 수 있습니다
- **전역 단축키** — 어떤 앱에서든 사용할 수 있으며 Hold / Toggle 두 가지 모드를 지원합니다
- **사용자 사전** — 고유명사와 전문 용어를 정확하게 받아쓰고, 사용자의 수정에서 새 단어를 학습합니다
- **기록과 통계** — 모든 받아쓰기를 자동으로 저장하고, Dashboard에서 사용 현황을 한눈에 볼 수 있습니다

## 설치

### 다운로드

| 플랫폼 | 다운로드 |
|------|---------|
| macOS (Apple Silicon: M1/M2/M3/M4…) | [TypeK-mac-arm64.dmg](https://github.com/kekukeku/TypeK/releases/latest/download/TypeK-mac-arm64.dmg) |
| Windows | [TypeK-windows-x64.exe](https://github.com/kekukeku/TypeK/releases/latest/download/TypeK-windows-x64.exe) |

macOS 버전은 Apple Silicon(M1/M2/M3/M4…)만 지원합니다. Intel Mac 버전은 1.3.3부터 제공하지 않습니다.

### macOS 설치 방법

TypeK는 현재 **Apple의 서명과 공증을 받지 않았기** 때문에 처음 열 때 macOS가 차단합니다. 정상적인 동작입니다.

1. 다운로드한 `.dmg`를 열고 **TypeK**를 '응용 프로그램' 폴더로 드래그합니다
2. '응용 프로그램' 폴더에서 TypeK를 더블 클릭하면 '확인되지 않은 개발자' 또는 'Apple은 TypeK에 악성 코드가 없음을 확인할 수 없습니다'라는 메시지가 나타납니다. '완료' 또는 '취소'를 클릭합니다
3. '시스템 설정 → 개인정보 보호 및 보안'을 열고 '보안'까지 스크롤합니다. 'TypeK이(가) 차단되었습니다' 옆의 '**그래도 열기**'를 클릭하고 암호를 입력해 확인합니다
4. 이후에는 다시 묻지 않고 정상적으로 열립니다

''TypeK'이(가) 손상되었기 때문에 열 수 없습니다'라는 메시지가 나오면 '터미널'에서 아래 한 줄을 실행한 뒤 다시 열어 주세요.

```bash
xattr -dr com.apple.quarantine /Applications/TypeK.app
```

### macOS 권한

TypeK는 처음 사용할 때 두 가지 권한을 요청합니다. 둘 다 허용해 주세요.

- **마이크**: 말하는 내용을 녹음합니다
- **손쉬운 사용**(시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용): 단축키를 감지하고, 커서 위치에 텍스트를 붙여넣고, 입력란 앞뒤의 텍스트를 읽습니다

서명이 없기 때문에 **새 버전으로 업데이트하면 손쉬운 사용 권한이 풀릴 수 있습니다**. 단축키가 반응하지 않으면 '손쉬운 사용' 목록에서 TypeK를 제거(−)한 뒤 다시 추가(＋)하고 켜 주세요.

### 업데이트

1.3.0부터 앱 안에서 업데이트할 수 있습니다. 사이드바의 '업데이트 확인'을 누르거나 자동 알림을 기다리세요. 1.2.2 이전 버전은 새 버전을 내려받아 한 번 덮어쓰면 됩니다(앱을 먼저 삭제할 필요 없음).

macOS에서는 자동 업데이트를 하려면 TypeK가 '응용 프로그램' 폴더에 있어야 합니다. 업데이트 후 단축키가 작동하지 않으면 시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용에서 TypeK를 제거한 뒤 다시 추가하고 켜세요.

### Windows 설치 방법

`.exe`를 실행할 때 'Windows의 PC 보호' 화면이 나오면 '추가 정보' → '실행'을 클릭하세요.

### 준비물

- [Groq API Key](https://console.groq.com/keys) — 음성 받아쓰기(무료 사용량 제공)
- [Gemini API Key](https://aistudio.google.com/apikey) — 텍스트 다듬기는 기본으로 Gemini 3.1 Flash-Lite를 사용합니다(무료 사용량 제공). 설정에서 Groq, OpenAI, Anthropic으로 바꿀 수도 있습니다

### 빠른 시작

1. 위의 방법대로 다운로드하고 설치합니다
2. TypeK를 열고 → 설정 화면 → Groq API Key와 Gemini API Key를 붙여넣습니다
3. 어떤 앱에서든 `Fn` 키를 누른 채 말하고, 손을 떼면 텍스트가 자동으로 붙여넣어집니다

## 기술 구성

```
Tauri v2 (Rust) + Vue 3 + TypeScript

  ┌──────────────────────────────────┐
  │        Tauri Backend (Rust)      │
  │ 전역 단축키 · 클립보드 · 입력 문맥 │
  └───────┬──────────────┬───────────┘
          │ invoke()     │ emit()
  ┌───────▼──┐    ┌──────▼───────────┐
  │   HUD    │    │    Dashboard     │
  │ 상태 표시 │    │ 설정/기록/통계   │
  └──────────┘    └──────────────────┘
```

- **Frontend** — Vue 3 + TypeScript + shadcn-vue + Tailwind CSS
- **Backend** — Rust (Tauri v2)
- **AI** — Groq Whisper(음성 인식) + Gemini/Groq/OpenAI/Anthropic(텍스트 다듬기)
- **Storage** — SQLite(기록) + tauri-plugin-store(설정)

## 개발

### 환경 요구 사항

- Node.js 24+
- pnpm 10+
- Rust stable
- Xcode Command Line Tools (macOS)

### 명령어

```bash
# 의존성 설치
pnpm install

# 개발 모드
pnpm tauri dev

# 빌드
pnpm tauri build

# 테스트
pnpm test

# 타입 검사
npx vue-tsc --noEmit
```

### 배포

자동 업데이트는 1.3.0부터 켜져 있습니다. App이 GitHub Releases에서 업데이트를 확인합니다. 서명 키와 배포 방법은 [docs/deployment-guide.md](docs/deployment-guide.md)를 참고하세요.

```bash
./scripts/release.sh X.Y.Z
# → 버전 번호 업데이트, commit, tag, push를 자동으로 실행
# → GitHub Actions가 macOS + Windows 설치 파일을 빌드
# → 빌드가 성공하면 GitHub Release가 자동으로 공개됨
```

## License

[MIT](LICENSE). TypeK는 SayIt을 수정한 것으로, MIT 라이선스에 따라 원저작자의 저작권 고지를 유지합니다.
