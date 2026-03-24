# TypeK - 음성 입력 도구

[다른 언어로 읽기: [繁體中文](README.md) | [English](README_en-US.md) | [日本語](README_ja-JP.md) | [简体中文](README_zh-CN.md) | [한국어](README_ko-KR.md) | [Français](README_fr-FR.md) | [Español](README_es-ES.md) | [Русский](README_ru-RU.md) | [ไทย](README_th-TH.md) | [Tiếng Việt](README_vi-VN.md) | [العربية](README_ar-SA.md)]

> 누르고 말한 뒤, 떼면 완전히 다른 출력 품질을 경험하세요 — 음성을 서면 언어로 변환하는 데스크톱 도구.

TypeK는 크로스 플랫폼 데스크톱 음성 입력 도구입니다. 모든 응용 프로그램에서 단축키를 누른 채 말하고, 떼면 Groq Whisper API를 통해 전사된 후, Groq LLM이 자동으로 구어체를 유창한 서면 언어로 변환하여 커서 위치에 바로 붙여넣습니다 — 구어체를 매끄러운 서면으로 다듬어주는 보이지 않는 비서가 있는 것과 같습니다.

## 주요 기능

- **구어체를 글말투로** — AI가 자동으로 필요 없는 말을 제거하고, 문장 구조를 재구성하며, 구두점을 수정하고 문체를 다듬습니다. 바로 사용할 수 있습니다.
- **전역 단축키** — 어느 앱에서나 트리거 가능하며, Hold / Toggle 두 가지 모드를 지원합니다.
- **짧은 지연 시간** — Groq 추론 엔진을 기반으로 하여 끝에서 끝까지 3초 안에 처리됩니다(AI 전처리 포함).
- **사용자 사전** — 고유명사 및 기술 용어의 정확한 전사를 지원합니다.
- **기록 및 통계** — 모든 전사 기록이 자동으로 저장되며, 대시보드에서 사용 현황을 한눈에 볼 수 있습니다.
- **간단한 설정** — API Key만 설정하면 바로 시작할 수 있습니다.

## 설치

### 다운로드

| 플랫폼 | 다운로드 링크 |
|------|---------|
| macOS (Apple Silicon) | [TypeK_0.9.0_aarch64.dmg](https://github.com/kekukeku/TypeK/releases/download/v0.9.0/TypeK_0.9.0_aarch64.dmg) |
| Windows (x64) | [TypeK_0.9.0_x64.exe](https://github.com/kekukeku/TypeK/releases/download/v0.9.0/TypeK_0.9.0_x64.exe) |

### 요구 사항

- [Groq API Key](https://console.groq.com/keys) (무료 가입 및 발급)

### 빠른 시작

1. 다운로드 및 설치를 진행합니다.
2. TypeK 실행 → 설정 페이지 → Groq API Key를 붙여넣습니다.
3. 아무 응용 프로그램에서나 단축키를 눌러 음성을 입력하고 떼면 자동으로 텍스트가 붙여넣어집니다.

## 기술 스택

```
Tauri v2 (Rust) + Vue 3 + TypeScript

  ┌──────────────────────────────────┐
  │        Tauri Backend (Rust)      │
  │     전역 단축키 · 클립보드 · 볼륨    │
  └───────┬──────────────┬───────────┘
          │ invoke()     │ emit()
  ┌───────▼──┐    ┌──────▼───────────┐
  │   HUD    │    │    Dashboard     │
  │ 상태 UI   │    │ 설정 / 기록 / 통계 |
  └──────────┘    └──────────────────┘
```

- **Frontend** — Vue 3 + TypeScript + shadcn-vue + Tailwind CSS
- **Backend** — Rust (Tauri v2)
- **AI** — Groq Whisper (음성 인식) + Groq LLM (문장 다듬기)
- **Storage** — SQLite (기록) + tauri-plugin-store (설정)

## 개발

### 환경 요구 사항

- Node.js 24+
- pnpm 10+
- Rust stable
- Xcode Command Line Tools (macOS)

### 명령어

```bash
# 종속성 설치
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

```bash
./scripts/release.sh 0.2.0
# → 자동으로 버전 업데이트, 커밋, 태그 생성, push 수행
# → GitHub Actions 가 macOS와 Windows 설치 파일을 빌드
# → GitHub Releases 페이지에서 수동으로 Publish
```

## 감사의 인사

원작자: [Jackle Chen](https://jackle.pro)
이전 버전 최적화: [好倫](https://bt34.cc)
최적화: [Kevin Kuo](https://github.com/kevin880118)

TypeK는 [BTalk](https://github.com/biantai34/BTalk/)를 기반으로 한 수정본으로, 핵심 기능을 유지하며 특정 국가별 언어의 요구 사항을 충족하도록 수정되었습니다.

## 라이선스

[MIT](LICENSE)
