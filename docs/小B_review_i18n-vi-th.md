# 小B 審查：i18n vi/th 實作（只審不改）

依據：`docs/plan-i18n-vi-th.md` v3 對照未提交工作樹。Node 量過字素（7／11／18／20）、`Ấy` 與咖啡句的 NFC／NFD 長度、`th` 加 `calendar`／`numberingSystem` 後為西元。未重跑 vue-tsc、eslint、vitest。

生產碼：步驟 1–2、4–7、9 與計畫一致（`yue`→`auto` 的兩個載入入口、缺值不改寫碟規則、不經 `saveTranscriptionLocale`、Layer 1 整段分類與門檻、`normalizeForOverlap`、日期 options、字素截斷、`ES2022.Intl`、七語系文件）。`src/` 無 `yue`。未改字型、`src-tauri`、`whisperPrompt.ts`。vi／th 精簡模板與計畫逐字相同。七份 README 切換列、下載 URL，以及 `README.vi.md`／`README.th.md` 的程式碼區塊與 `README.md` 相同。

## 必須改

[HIGH] `README.vi.md:37` — 「**Mở bằng (Open Anyway)**」不是 macOS 越南文按鈕。Apple 越南文說明該步是「Vẫn mở」。Mở bằng 是「打開方式」（Open With），安裝步驟會指到另一個指令。

[HIGH] `README.th.md:37` — 「**เปิดบังคับ (Open Anyway)**」不是系統按鈕。Apple 泰文說明同一步是「ยืนยันจะเปิด」（前一步的「เปิด」才是 Open）。這是把繁中「強制打開」直譯，畫面上沒有這個字。

## 應改

[MED] `src/i18n/locales/vi.json:219`、`src/i18n/locales/vi.json:220` — `totalRecordingTime` 為「Tổng thời gian đọc」、`totalCharacters` 為「Số ký tự đã đọc」。zh-TW 是「總口述時間」「口述字數」。đọc 是閱讀。同兩鍵泰文是 พูด，語意對。

[MED] `tests/unit/i18n-settings.test.ts:436`、`src/i18n/index.ts:21` — 步驟 2 要求測 `src/i18n/index.ts` 匯出的實例：`messages` 有 `vi`、`th`，切過去 `t("common.save")` 不等於 en。現況只 import JSON。`index.ts:21` 有註冊，但拿掉註冊這組測試仍綠，畫面落到 `fallbackLocale: "en"`（`src/i18n/index.ts:14`）。`tests/component/i18n-smoke.test.ts:18` 仍只塞 zh-TW／en。

[MED] `tests/unit/hallucination-detector.test.ts:532`、`src/lib/hallucinationDetector.ts:81` — 長度爆炸用「Tôi muốn uống cà phê」：NFC 20 碼元、NFD 27，比 1.35，不到 2 倍。拿掉 `.normalize("NFC")` 這則仍綠。會被舊算法判爆的是「Ấy」（NFC 2、NFD 4）。

## 可留

[LOW] `tests/unit/use-voice-flow-store.test.ts:2131`、`tests/unit/use-voice-flow-store.test.ts:2292` — 即時與重送用越文／泰文當原文。OpenCC 不改這兩段，貼上原文證明不了「不簡轉繁」。歷史路徑有把 `"vi"` 傳進 transform。生產碼 `src/stores/useVoiceFlowStore.ts:93` 只在有效語言為 zh-TW 時轉。

[LOW] `tests/unit/use-settings-store.test.ts:705`、`src/stores/useSettingsStore.ts:1406` — 刷新路徑的 `yue` 遷移只斷言 `store.set`，沒斷言 `store.save`。載入路徑 `tests/unit/use-settings-store.test.ts:656` 有。生產碼有 `save`。

結論：NOT READY

## 複審（第 2 輪）

只核對上一輪五項必須改／應改是否修完，以及兩項可留是否仍照原判。對過 Apple `vi-vn`／`th-th` 的 mac-help `mchleab3a043` 與 `102445`（2026-09-14）。重跑 `i18n-settings`、`hallucination-detector`、`use-settings-store` 三檔，132 項通過。未重跑整份 vitest 與 vue-tsc；Claude 回報為 41 files／666 tests、vue-tsc OK。本輪只追加本節。

[HIGH] `README.vi.md:37` 已是「**Vẫn mở (Open Anyway)**」。Apple 越南文該步是「Bấm vào Vẫn mở」（`vi-vn/102445` 作「nút Vẫn mở」）。括號裡的英文沿用同檔「Xong (Done)」寫法。全文已無「Mở bằng」。同段其餘步驟與 `xattr` 程式碼區塊維持原樣。

[HIGH] `README.th.md:37` 已是「**ยืนยันจะเปิด (Open Anyway)**」。Apple 泰文該步是「คลิก ยืนยันจะเปิด」（`th-th/102445` 作「ปุ่มยืนยันจะเปิด」）。全文已無「เปิดบังคับ」。同段其餘步驟與程式碼區塊維持原樣。

[MED] `src/i18n/locales/vi.json:219-220` 已是「Tổng thời gian nói」「Số ký tự đã nói」。nói 對應 zh-TW「總口述時間」「口述字數」，並與泰文「เวลาพูดทั้งหมด」「จำนวนตัวอักษรที่พูด」同向。同檔其餘「đọc」是讀取游標旁文字，語意分開，這次沒有被改到。

[MED] `tests/unit/i18n-settings.test.ts:512`「正式 i18n 實例」動態 import `src/i18n`。`availableLocales` 含 `vi`、`th`；切到這兩語後 `t("common.save")` 等於該語系 JSON（「Lưu」「บันทึก」），也不同於 en 的「Save」。拿掉 `src/i18n/index.ts:21` 的註冊，`availableLocales` 會失敗；註冊空物件則落到 `fallbackLocale: "en"`，`not.toBe` 會失敗。`finally` 會把 locale 設回進入測試前的值。`tests/component/i18n-smoke.test.ts:18` 仍只塞 zh-TW／en；正式入口已由這條單元測試鎖住。

[MED] `tests/unit/hallucination-detector.test.ts:532` 已改用「Ấy」。實測 NFC 2 碼元（U+1EA4 U+0079）、NFD 4 碼元（U+0041 U+0302 U+0301 U+0079）。`ENHANCEMENT_LENGTH_EXPLOSION_RATIO` 為 2 且用 `>=`，NFD 放在增強側、不先 NFC 會判 length-explosion。生產碼 `src/lib/hallucinationDetector.ts:81` 仍先 `normalize("NFC")` 再 `trim()`，寫入值不變。反向（NFD 原文、NFC 增強）即使不 NFC 也不會爆，正向斷言會紅。咖啡句留在上一則 overlap 測試，兩道守衛分開鎖。

[LOW] `tests/unit/use-settings-store.test.ts:720` 刷新路徑已斷言 `mockStoreSave`。`refreshCrossWindowSettings` 裡唯一的 `store.save()` 在 `shouldPersist` 分支（`src/stores/useSettingsStore.ts:1406`）。此例不呼叫 `loadSettings`，`beforeEach` 會清掉 mock。拿掉該 `save()` 會紅。載入路徑 `tests/unit/use-settings-store.test.ts:656` 的斷言還在。`src/` 仍無 `yue`。

[LOW] `tests/unit/use-voice-flow-store.test.ts:2131`、`tests/unit/use-voice-flow-store.test.ts:2292` 維持原樣：即時越文與重送泰文仍用原文斷言貼上內容。OpenCC 不改這兩段。生產碼 `src/lib/transcriptTextTransforms.ts:18` 仍只在有效語言為 zh-TW 時簡轉繁。依上一輪可留。

結論：READY
