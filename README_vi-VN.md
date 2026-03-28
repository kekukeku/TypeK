# TypeK - Công cụ Nhập liệu bằng Giọng nói

[Đọc bằng ngôn ngữ khác: [繁體中文](README.md) | [English](README_en-US.md) | [日本語](README_ja-JP.md) | [简体中文](README_zh-CN.md) | [한국어](README_ko-KR.md) | [Français](README_fr-FR.md) | [Español](README_es-ES.md) | [Русский](README_ru-RU.md) | [ไทย](README_th-TH.md) | [Tiếng Việt](README_vi-VN.md) | [العربية](README_ar-SA.md)]

> Nhấn giữ để nói, thả ra để trải nghiệm chất lượng đầu ra hoàn toàn khác biệt — một công cụ chuyển giọng nói thành văn bản trên máy tính.

TypeK là một công cụ nhập liệu bằng giọng nói đa nền tảng trên máy tính. Nhấn và giữ phím tắt để nói trong bất kỳ ứng dụng nào, thả ra để ghi âm qua Groq Whisper API, sau đó Groq LLM tự động chuyển đổi ngôn ngữ nói thành văn bản trôi chảy, viết hoàn chỉnh và dán trực tiếp tại vị trí con trỏ chuột của bạn—giống như một thư ký biên tập vô hình.

## Tính năng nổi bật

- **Nói sang Viết** — AI tự động loại bỏ các từ thừa, tổ chức lại cấu trúc câu, sửa dấu câu chữ và tinh chỉnh ngôn ngữ. Sẵn sàng để sử dụng ngay lập tức.
- **Phím Tắt Global** — Kích hoạt qua bất kỳ ứng dụng nào, hỗ trợ hai chế độ Giữ (Hold) / Bật tắt (Toggle).
- **Độ trễ thấp** — Dựa vào bộ máy Groq, từ đầu đến cuối chưa đến 3 giây (bao gồm cả quá trình biên dịch AI).
- **Từ điển tùy chỉnh** — Đảm bảo chuyển đổi âm thành chữ chính xác với các danh từ cụ thể/thiết bị kỹ thuật.
- **Lịch sử và Thống kê** — Tự động lưu tất cả các lần ghi âm, Dashboard cho phép xem mọi thống kê dễ dàng.
- **Cài đặt cực kỳ nhỏ gọn** — Chỉ cần API Key là có thể dùng được.

## Cài đặt

### Tải ngay

| Hệ Điều Hành | Link tải về |
|------|---------|
| macOS (Apple Silicon) | [TypeK_0.9.1_aarch64.dmg](https://github.com/kekukeku/TypeK/releases/download/v0.9.1/TypeK_0.9.1_aarch64.dmg) |
| Windows (x64) | [TypeK_0.9.1_x64.exe](https://github.com/kekukeku/TypeK/releases/download/v0.9.1/TypeK_0.9.1_x64.exe) |

> **⚠️ Lưu ý cài đặt macOS (Lỗi "Ứng dụng bị hỏng"):**
> Nếu bạn thấy lỗi "Bị hỏng" khi mở ứng dụng trên Mac, vui lòng tải xuống và chạy tập lệnh [Unlock_TypeK.command](https://raw.githubusercontent.com/kekukeku/TypeK/main/%E8%A7%A3%E9%8E%96TypeK.command) để tự động xóa giới hạn cách ly hoặc mở Terminal và chạy: `sudo xattr -cr /Applications/TypeK.app`.

### Yêu cầu

- [Groq API Key](https://console.groq.com/keys) (Đăng ký miễn phí)

### Bắt đầu Nhanh

1. Tải ứng dụng và cài đặt.
2. Mở TypeK → Đi đến Cài đặt → Dán Groq API Key.
3. Giữ phím tắt ở bất cứ đâu để nói, thả ra để văn bản tự dán vào.

## Cấu trúc Hệ Thống

```
Tauri v2 (Rust) + Vue 3 + TypeScript

  ┌──────────────────────────────────┐
  │        Tauri Backend (Rust)      │
  │   Phím tắt · Clipboard · Media   │
  └───────┬──────────────┬───────────┘
          │ invoke()     │ emit()
  ┌───────▼──┐    ┌──────▼───────────┐
  │   HUD    │    │    Dashboard     │
  │ Trạng.T  │    │ Cài đặt/Lịch sử  │
  └──────────┘    └──────────────────┘
```

- **Frontend** — Vue 3 + TypeScript + shadcn-vue + Tailwind CSS
- **Backend** — Rust (Tauri v2)
- **AI** — Groq Whisper (Speech-to-Text) + Groq LLM (Làm đẹp câu văn)
- **Storage** — SQLite (Lịch sử) + tauri-plugin-store (Cài đặt)

## Phát triển

> **⚠️ Lưu ý cài đặt macOS (Lỗi "Ứng dụng bị hỏng"):**
> Nếu bạn thấy lỗi "Bị hỏng" khi mở ứng dụng trên Mac, vui lòng tải xuống và chạy tập lệnh [Unlock_TypeK.command](https://raw.githubusercontent.com/kekukeku/TypeK/main/%E8%A7%A3%E9%8E%96TypeK.command) để tự động xóa giới hạn cách ly hoặc mở Terminal và chạy: `sudo xattr -cr /Applications/TypeK.app`.

### Yêu cầu Môi Trường

- Node.js 24+
- pnpm 10+
- Rust stable
- Xcode Command Line Tools (macOS)

### Lệnh xử lý

```bash
# Cài đặt thành phần
pnpm install

# Mở chế độ lập trình viên
pnpm tauri dev

# Tạo Build
pnpm tauri build

# Kiểm tra
pnpm test

# Chấm lỗi phân loại TypeScript
npx vue-tsc --noEmit
```

### Triển khai Phiên Bản Mới

```bash
./scripts/release.sh 0.2.0
# → Cập nhật tự động mã phiên bản / commit / tag / push
# → GitHub Actions tạo bản macOS + Windows
# → Quay lại GitHub Releases nhấn Publish
```

## Lời Cảm Ơn

Tác giả gốc: [Jackle Chen](https://jackle.pro)
Người dùng đóng góp cho phiên bản trước: [好倫](https://bt34.cc)
Người tối ưu: [Kevin Kuo](https://github.com/kevin880118)

TypeK là phiên bản được sửa đổi dựa trên [BTalk](https://github.com/biantai34/BTalk/), bảo lưu toàn bộ chức năng cốt lõi và phù hợp với yêu cầu về mỗi ngôn ngữ riêng biệt.

## Giấy phép

[MIT](LICENSE)
