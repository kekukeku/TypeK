# TypeK - Herramienta de Entrada de Voz

[Leer en otros idiomas: [繁體中文](README.md) | [English](README_en-US.md) | [日本語](README_ja-JP.md) | [简体中文](README_zh-CN.md) | [한국어](README_ko-KR.md) | [Français](README_fr-FR.md) | [Español](README_es-ES.md) | [Русский](README_ru-RU.md) | [ไทย](README_th-TH.md) | [Tiếng Việt](README_vi-VN.md) | [العربية](README_ar-SA.md)]

> Mantén presionado para hablar, suelta para experimentar una calidad de salida completamente diferente — una herramienta de escritorio de voz a texto.

TypeK es una herramienta de entrada de voz de escritorio multiplataforma. Mantén presionada la tecla de acceso directo para hablar en cualquier aplicación, suelta para transcribir a través de la API de Groq Whisper y, a continuación, el Groq LLM transformará automáticamente tu lenguaje hablado en un texto escrito y fluido, pegándolo directamente en la posición de tu cursor, como si tuvieras un secretario de edición invisible que convierte tu voz en escritura formal.

## Características

- **De Hablado a Escrito** — La IA elimina automáticamente las palabras de relleno, reorganiza la estructura de las oraciones, corrige la puntuación y refina la redacción. Listo para usar inmediatamente.
- **Teclas de Acceso Directo Globales** — Actívala en cualquier aplicación, con soporte para los modos Hold (Mantener) / Toggle (Alternar).
- **Baja Latencia** — Impulsado por el motor de inferencia Groq, de extremo a extremo en menos de 3 segundos (incluyendo el procesamiento de IA).
- **Diccionario de Vocabulario Personalizado** — Garantiza la transcripción exacta de nombres propios y términos técnicos.
- **Historial y Estadísticas** — Guarda automáticamente todas las transcripciones, con un Dashboard para ver el uso de un vistazo.
- **Configuración Minimalista** — Solo configura una clave de la API (API Key) para comenzar.

## Instalación

### Descarga

| Plataforma | Enlace de Descarga |
|------|---------|
| macOS (Apple Silicon) | [TypeK_0.9.0_aarch64.dmg](https://github.com/kekukeku/TypeK/releases/download/v0.9.0/TypeK_0.9.0_aarch64.dmg) |
| Windows (x64) | [TypeK_0.9.0_x64.exe](https://github.com/kekukeku/TypeK/releases/download/v0.9.0/TypeK_0.9.0_x64.exe) |

### Requisitos

- [Groq API Key](https://console.groq.com/keys) (Regístrate y solicítalo gratis)

### Inicio Rápido

1. Descarga e instala.
2. Abre TypeK → Página de Configuración → Pega tu Groq API Key.
3. Mantén presionado el acceso directo en cualquier aplicación para hablar y suelta para que el texto se pegue automáticamente.

## Arquitectura Técnica

```
Tauri v2 (Rust) + Vue 3 + TypeScript

  ┌──────────────────────────────────┐
  │        Tauri Backend (Rust)      │
  │ Atajos Globales · Portapapeles   │
  └───────┬──────────────┬───────────┘
          │ invoke()     │ emit()
  ┌───────▼──┐    ┌──────▼───────────┐
  │   HUD    │    │    Dashboard     │
  │ Estado   │    │ Historial/Estads │
  └──────────┘    └──────────────────┘
```

- **Frontend** — Vue 3 + TypeScript + shadcn-vue + Tailwind CSS
- **Backend** — Rust (Tauri v2)
- **AI** — Groq Whisper (Voz a Texto) + Groq LLM (Refinamiento de Texto)
- **Almacenamiento** — SQLite (Historial) + tauri-plugin-store (Configuraciones)

## Desarrollo

### Requisitos del Entorno

- Node.js 24+
- pnpm 10+
- Rust stable
- Xcode Command Line Tools (macOS)

### Comandos

```bash
# Instalar dependencias
pnpm install

# Modo de desarrollo
pnpm tauri dev

# Construir (Build)
pnpm tauri build

# Probar
pnpm test

# Verificación de tipos
npx vue-tsc --noEmit
```

### Versión

```bash
./scripts/release.sh 0.2.0
# → Actualiza automáticamente versión, commit, etiqueta, push
# → GitHub Actions compila instaladores para macOS + Windows
# → Ve a GitHub Releases para Publicar manualmente
```

## Agradecimientos

Autor Original: [Jackle Chen](https://jackle.pro)
Optimizador de la Versión Anterior: [好倫](https://bt34.cc)
Optimizador: [Kevin Kuo](https://github.com/kevin880118)

TypeK es una versión modificada basada en [BTalk](https://github.com/biantai34/BTalk/), que conserva todas las funciones principales y está adaptada a los requisitos de localización de idiomas específicos.

## Licencia

[MIT](LICENSE)
