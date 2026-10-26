# TypeK

[繁體中文](README.md) | [简体中文](README.zh-CN.md) | [English](README.en.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | **Tiếng Việt** | [ไทย](README.th.md)

> Giữ để nói, thả để dán — công cụ chuyển giọng nói thành văn bản viết trên máy tính

TypeK là công cụ nhập bằng giọng nói trên máy tính. Trong bất kỳ ứng dụng nào, bạn giữ phím tắt và nói; khi thả ra, giọng nói được Groq Whisper phiên âm, sau đó AI dựa vào ứng dụng bạn đang nhập và văn bản quanh con trỏ để tinh chỉnh thành văn viết trôi chảy và dán thẳng vào vị trí con trỏ.

TypeK là bản fork của dự án mã nguồn mở [SayIt](https://github.com/chenjackle45/SayIt), được phát triển và phân phối theo [giấy phép MIT](LICENSE).

## Tính năng

- **Từ khẩu ngữ sang văn viết** — AI tự động loại bỏ từ thừa, sửa từ đồng âm và dấu câu, nói xong là dùng được ngay
- **Nhận biết ngữ cảnh** (macOS) — khi tinh chỉnh, AI tham khảo ứng dụng hiện tại, tiêu đề cửa sổ và văn bản quanh con trỏ nên sửa danh từ riêng chính xác hơn; ô mật khẩu không bị đọc, có thể tắt trong Cài đặt
- **Phím tắt toàn cục** — kích hoạt trong bất kỳ ứng dụng nào, hỗ trợ cả chế độ Hold / Toggle
- **Từ điển thuật ngữ tùy chỉnh** — bảo đảm danh từ riêng, thuật ngữ kỹ thuật được phiên âm chính xác, đồng thời học từ mới từ những lần bạn sửa
- **Lịch sử và thống kê** — tự động lưu mọi bản phiên âm, xem tổng quan tình hình sử dụng trên Dashboard

## Cài đặt

### Tải xuống

| Nền tảng | Liên kết tải |
|------|---------|
| macOS (Apple Silicon: M1/M2/M3/M4…) | [TypeK-mac-arm64.dmg](https://github.com/kekukeku/TypeK/releases/latest/download/TypeK-mac-arm64.dmg) |
| Windows | [TypeK-windows-x64.exe](https://github.com/kekukeku/TypeK/releases/latest/download/TypeK-windows-x64.exe) |

Bản macOS chỉ hỗ trợ Apple Silicon (M1/M2/M3/M4…); từ 1.3.3 không còn cung cấp bản cho Mac Intel.

### Các bước cài đặt trên macOS

Hiện tại TypeK **chưa được Apple ký và công chứng**, lần đầu mở sẽ bị macOS chặn, đây là hiện tượng bình thường:

1. Mở tệp `.dmg` đã tải, kéo **TypeK** vào thư mục「Ứng dụng (Applications)」
2. Vào thư mục「Ứng dụng (Applications)」nhấp đúp vào TypeK, macOS sẽ hiển thị「Không thể xác minh nhà phát triển」hoặc「Apple không thể xác nhận TypeK không chứa phần mềm độc hại」, hãy nhấn「Xong (Done)」hoặc「Hủy (Cancel)」
3. Mở「Cài đặt Hệ thống (System Settings) → Quyền riêng tư & Bảo mật (Privacy & Security)」, cuộn xuống mục「Bảo mật (Security)」, thấy「Đã chặn TypeK」thì nhấn「**Vẫn mở (Open Anyway)**」, rồi nhập mật khẩu để xác nhận
4. Sau đó có thể mở bình thường, sẽ không hỏi lại nữa

Nếu xuất hiện「TypeK đã bị hỏng, không thể mở」, hãy chạy dòng dưới đây trong「Terminal」rồi mở lại:

```bash
xattr -dr com.apple.quarantine /Applications/TypeK.app
```

### Quyền trên macOS

Lần đầu sử dụng, TypeK sẽ yêu cầu hai quyền, cả hai đều phải cho phép:

- **Micrô (Microphone)**: ghi lại lời bạn nói
- **Trợ năng (Accessibility)** (Cài đặt Hệ thống → Quyền riêng tư & Bảo mật → Trợ năng): phát hiện phím tắt, dán văn bản vào vị trí con trỏ, đọc văn bản trước và sau ô nhập

Vì chưa được ký, **sau khi cập nhật lên phiên bản mới, quyền Trợ năng có thể mất hiệu lực**. Nếu phím tắt không phản hồi, hãy vào danh sách「Trợ năng (Accessibility)」gỡ TypeK (−), rồi thêm lại (＋) và bật lên.

### Cập nhật

Từ 1.3.0, bạn có thể cập nhật ngay trong ứng dụng: dùng "Kiểm tra cập nhật" ở thanh bên hoặc chờ thông báo tự động. Nếu đang dùng 1.2.2 hoặc cũ hơn, hãy tải bản mới và cài đè một lần (không cần xóa ứng dụng trước).

Trên macOS, TypeK phải nằm trong thư mục Ứng dụng thì mới tự động cập nhật. Nếu phím tắt không phản hồi sau khi cập nhật, hãy vào Cài đặt Hệ thống → Quyền riêng tư & Bảo mật → Trợ năng, xóa TypeK rồi thêm lại và bật lên.

### Các bước cài đặt trên Windows

Khi chạy tệp `.exe` nếu xuất hiện「Windows đã bảo vệ PC của bạn (Windows protected your PC)」, hãy nhấn「Thông tin khác (More info)」→「Vẫn chạy (Run anyway)」.

### Yêu cầu trước khi dùng

- [Groq API Key](https://console.groq.com/keys) — phiên âm giọng nói (hạn mức miễn phí)
- [Gemini API Key](https://aistudio.google.com/apikey) — tinh chỉnh văn bản mặc định dùng Gemini 3.1 Flash-Lite (hạn mức miễn phí); cũng có thể đổi sang Groq, OpenAI hoặc Anthropic trong Cài đặt

### Bắt đầu nhanh

1. Tải và cài đặt theo các bước ở trên
2. Mở TypeK → trang Cài đặt → dán Groq API Key và Gemini API Key
3. Trong bất kỳ ứng dụng nào, giữ phím `Fn` và nói, khi thả ra văn bản sẽ tự động được dán

## Kiến trúc kỹ thuật

```
Tauri v2 (Rust) + Vue 3 + TypeScript

  ┌──────────────────────────────────┐
  │        Tauri Backend (Rust)      │
  │  全域熱鍵 · 剪貼簿 · 輸入上下文  │
  └───────┬──────────────┬───────────┘
          │ invoke()     │ emit()
  ┌───────▼──┐    ┌──────▼───────────┐
  │   HUD    │    │    Dashboard     │
  │ 狀態浮窗  │    │ 設定/歷史/統計   │
  └──────────┘    └──────────────────┘
```

- **Frontend** — Vue 3 + TypeScript + shadcn-vue + Tailwind CSS
- **Backend** — Rust (Tauri v2)
- **AI** — Groq Whisper (chuyển giọng nói thành văn bản) + Gemini／Groq／OpenAI／Anthropic (tinh chỉnh văn bản)
- **Storage** — SQLite (lịch sử) + tauri-plugin-store (cài đặt)

## Phát triển

### Yêu cầu môi trường

- Node.js 24+
- pnpm 10+
- Rust stable
- Xcode Command Line Tools (macOS)

### Lệnh

```bash
# 安裝依賴
pnpm install

# 開發模式
pnpm tauri dev

# 建構
pnpm tauri build

# 測試
pnpm test

# 型別檢查
npx vue-tsc --noEmit
```

### Phát hành

Tính năng tự động cập nhật đã bật từ 1.3.0: ứng dụng kiểm tra GitHub Releases để cập nhật. Các bước về khóa ký và phát hành xem tại [docs/deployment-guide.md](docs/deployment-guide.md).

```bash
./scripts/release.sh X.Y.Z
# → 自動更新版本號、commit、tag、push
# → GitHub Actions 建構 macOS + Windows 安裝檔
# → 打包成功後自動公開 GitHub Release
```

## Giấy phép

[MIT](LICENSE). TypeK được phát triển từ SayIt, giữ nguyên tuyên bố bản quyền của tác giả gốc theo giấy phép MIT.
