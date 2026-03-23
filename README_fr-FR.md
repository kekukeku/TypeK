# TypeK - Outil de Saisie Vocale

[Lire dans d'autres langues: [繁體中文](README.md) | [English](README_en-US.md) | [日本語](README_ja-JP.md) | [简体中文](README_zh-CN.md) | [한국어](README_ko-KR.md) | [Français](README_fr-FR.md) | [Español](README_es-ES.md) | [Русский](README_ru-RU.md) | [ไทย](README_th-TH.md) | [Tiếng Việt](README_vi-VN.md) | [العربية](README_ar-SA.md)]

> Maintenez pour parler, relâchez pour une qualité de transcription inédite — l'outil de bureau de voix-à-texte.

TypeK est un outil de saisie vocale de bureau multiplateforme. Maintenez le raccourci enfoncé pour parler dans n'importe quelle application. En relâchant, l'API Groq Whisper retranscrit la voix en texte, puis le LLM de Groq transforme automatiquement vos propos spontanés en un texte rédigé avec perfection et l'insère directement — comme si un secrétaire invisible rédigeait vos paroles à la perfection.

## Fonctionnalités

- **De l'Oral à l'Écrit** — L'IA supprime automatiquement les mots de remplissage, réorganise la syntaxe, corrige la ponctuation et améliore le vocabulaire.
- **Raccourcis Globaux** — Déclenchez l'outil depuis n'importe quelle application, supporte les modes Maintenir ou Basculer.
- **Faible Latence** — Propulsé par le moteur d'inférence de Groq, pour une exécution de bout en bout en moins de 3 secondes (traitement de l'IA inclus).
- **Dictionnaire Personnalisé** — Assure la bonne transcription de termes techniques ou de noms propres.
- **Historique et Statistiques** — Sauvegarde toutes vos transcriptions avec un Tableau de bord pour consulter votre utilisation.
- **Configuration Minimaliste** — Entrez simplement votre clé API pour commencer.

## Installation

### Téléchargement

| Plateforme | Lien de téléchargement |
|------|---------|
| macOS (Apple Silicon) | [TypeK_0.9.0_aarch64.dmg](https://github.com/kekukeku/TypeK/releases/download/v0.9.0/TypeK_0.9.0_aarch64.dmg) |

### Pré-requis

- [Groq API Key](https://console.groq.com/keys) (Demande et enregistrement gratuits)

### Démarrage Rapide

1. Téléchargez et installez.
2. Ouvrez TypeK → Paramètres → Collez votre Clé API Groq.
3. Dans n'importe quelle application, maintenez le raccourci enfoncé pour parler et relâchez pour que le texte soit collé automatiquement.

## Architecture Technique

```
Tauri v2 (Rust) + Vue 3 + TypeScript

  ┌──────────────────────────────────┐
  │        Tauri Backend (Rust)      │
  │ Raccourcis globaux · Presse-pap  │
  └───────┬──────────────┬───────────┘
          │ invoke()     │ emit()
  ┌───────▼──┐    ┌──────▼───────────┐
  │   HUD    │    │    Dashboard     │
  │ Statut   │    │ Historique/Stats │
  └──────────┘    └──────────────────┘
```

- **Frontend** — Vue 3 + TypeScript + shadcn-vue + Tailwind CSS
- **Backend** — Rust (Tauri v2)
- **AI** — Groq Whisper (Speech-to-Text) + Groq LLM (Affinement de Texte)
- **Stockage** — SQLite (Historique) + tauri-plugin-store (Paramètres)

## Développement

### Environnement

- Node.js 24+
- pnpm 10+
- Rust stable
- Xcode Command Line Tools (macOS)

### Commandes

```bash
# Installation des dépendances
pnpm install

# Mode développeur
pnpm tauri dev

# Construction (Build)
pnpm tauri build

# Tests
pnpm test

# Vérification du typage
npx vue-tsc --noEmit
```

### Publier

```bash
./scripts/release.sh 0.2.0
# → Mise à jour du numéro de version, commit, tag, push
# → GitHub Actions compile les installateurs macOS + Windows
# → Allez sur GitHub Releases pour publier manuellement
```

## Remerciements

Auteur original : [Jackle Chen](https://jackle.pro)
Optimiseur de la version précédente : [好倫](https://bt34.cc)
Optimiseur : [Kevin Kuo](https://github.com/kevin880118)

TypeK est une version modifiée basée sur [BTalk](https://github.com/biantai34/BTalk/), conservant toutes ses fonctionnalités essentielles, adaptée aux besoins spécifiques selon les langues.

## Licence

[MIT](LICENSE)
