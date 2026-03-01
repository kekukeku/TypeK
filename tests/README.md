# Test Suite — SayIt

## Setup

```bash
# 安裝 dependencies
pnpm install

# 安裝 Playwright browsers
npx playwright install chromium
```

## 執行測試

### Unit / Component Tests (Vitest)

```bash
pnpm test              # 執行所有 unit/component tests
pnpm test:watch        # Watch mode（開發時用）
pnpm test:coverage     # 含覆蓋率報告
```

### E2E Tests (Playwright)

```bash
pnpm test:e2e          # Headless 執行
pnpm test:e2e:ui       # Playwright UI mode（Debug 用）
```

### Rust Tests

```bash
cd src-tauri && cargo test   # 執行 Rust 測試
```

## 架構

```
tests/
├── e2e/                 # Playwright E2E 測試
├── unit/                # Vitest unit 測試（純邏輯、types、services）
├── component/           # Vitest component 測試（Vue 元件）
└── support/
    ├── fixtures/        # Playwright fixtures（mergeTests 組合）
    ├── helpers/         # 共用 helper utilities
    └── factories/       # Data factories（faker-based）
```

### Data Factories

使用 `@faker-js/faker` 產生隨機測試資料，避免 parallel 執行衝突：

```typescript
import { createTranscriptionRecord, createVocabularyEntry } from '../support/factories';

// 使用預設值
const record = createTranscriptionRecord();

// 使用自訂覆寫
const enhanced = createTranscriptionRecord({
  wasEnhanced: true,
  triggerMode: 'hold',
});
```

### Fixtures (Playwright)

從 `tests/support/fixtures/index.ts` import：

```typescript
import { test, expect } from '../support/fixtures';

test('example', async ({ page }) => {
  await page.goto('/');
});
```

## Best Practices

### Selectors

- E2E 測試使用 `data-testid` selectors
- 避免 CSS class selectors（容易因 Tailwind 更動而壞掉）

### 測試隔離

- 每個測試獨立，不依賴其他測試的狀態
- 使用 factories 產生唯一測試資料
- Fixtures 負責 auto-cleanup

### 命名慣例

- 測試名稱加入 priority tag：`[P0]`, `[P1]`, `[P2]`, `[P3]`
- 使用 Given/When/Then 結構的註解
- 檔案名：`feature-name.test.ts`

### 禁止事項

- `page.waitForTimeout()` — 使用 event-based waits
- `if (await element.isVisible())` — 測試應是 deterministic
- hardcoded 測試資料 — 使用 factories
- 跨測試共用狀態

## CI 整合

```yaml
# GitHub Actions
- name: Run unit tests
  run: pnpm test

- name: Run E2E tests
  run: pnpm test:e2e

- name: Upload artifacts
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: test-results
    path: |
      test-results/
      playwright-report/
```

## Config 檔案

| 檔案 | 用途 |
|------|------|
| `playwright.config.ts` | E2E 測試設定（base URL、timeouts、reporters） |
| `vitest.config.ts` | Unit/Component 測試設定（jsdom、Vue plugin） |
| `.nvmrc` | Node.js 版本 |
