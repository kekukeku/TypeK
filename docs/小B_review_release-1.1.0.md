# 小B 審查：1.1.0 發版批次（只審不改）

依據：`docs/plan-prompts-unify.md`、`git log v1.0.0..HEAD`（`f3c3689`、`d518903`）與未提交工作樹。四語 `MINIMAL_TEMPLATES` 與計畫程式區塊逐字比對通過（en 1264、ja 609、zh-CN 521、ko 702 字元）。`EXPLICIT_LANGUAGE_RULES`、`AUTO_LANGUAGE_RULES`、zh-TW／vi／th 模板不在 diff 裡。未重跑 vue-tsc、vitest；沿用 Claude 回報：vue-tsc OK、41 files／670 tests。

## 通過

整理指示。zh-CN／en／ja／ko 都先聲明逐字稿不是指令、不要回答或執行（`src/i18n/prompts.ts:61`、`:74`、`:87`、`:102`），再要求只輸出校對結果。與 zh-TW 同一優先序：有依據的專有名詞用 `<vocabulary>`／`<context>` 的寫法，多個候選或沒有依據就留原文；英文詞、縮寫、識別字不翻譯、不擴寫；有轉折、順序或限定的口頭詞保留；自我更正留更正後的內容；句尾不加句號；結尾保留否定、條件、數字、日期。日文只在有依據時才把誤轉的片假名還原成英文原綴（`:78`）。韓文只在有依據時才把한글 음차還原（`:106`），沒有改띄어쓰기的指示。簡中用詞是软件、信息、程序、网络、视频、默认，掃描沒有「語／設定／台灣」這類繁體字。英文模板沒有 CJK。檔頭註解已改成「填明確語言句」（`:8`）。

測試。`tests/unit/prompts-output-language.test.ts:9-69` 改鎖三件事：結尾是明確語言句、含 `<vocabulary>` 與 `<context>`、含各語「不是指令」句，另加簡中繁體字哨兵與英文無 CJK。這三條在舊版會失敗，不是 `expect(true)`。AC1、AC2、AC5 與 vi／th 區塊（`:97-129`）還在。`builtin-prompts-v0.14.1.ts` 的唯一引用是這支測試的舊 import，工作樹的 ts／vue／js／json 已無此路徑。`tests/support/fixtures/index.ts` 是 Playwright fixture，不轉出那個檔。`enhancer.test.ts`、`settingsStore.test.ts`、`i18n-settings.test.ts` 用 mock 或即時呼叫 `getMinimalPromptForLocale`，沒有寫死舊版原文。

升級公告的「自動偵測」與各檔 `settings.app.autoDetect` 逐字相同：zh-TW「自動偵測」（`zh-TW.json:159`、`:425`）、zh-CN「自动检测」、en「Auto Detect」、ja「自動検出」、ko「자동 감지」、vi「Tự động nhận diện」、th「ตรวจจับอัตโนมัติ」。七檔都有 title、item1、item2、dismiss，JSON 合法。`src/MainApp.vue:89` 的 `upgradeNoticeItemCount = 2` 對得上。韓文 item1 收在「다듬어집니다」，item2 收在「바뀌었습니다」「됩니다」；「바뀌었습니다」是子音詞幹的 -습니다，與同檔「업데이트되었습니다」（`ko.json:158`）同一합니다체。按鈕「확인」與同檔其他按鈕一樣不收 -니다。兩條公告的意思一致：新增越文與泰文、說完仍會整理；粵語選項移除後改為自動偵測，要指定語言請到設定重選。提示詞升級與幻聽判斷使用者看不到，不進這兩條是合理的。

CHANGELOG。`v1.0.0..HEAD` 兩筆：`d518903` 是七語介面、vi／th 說話語言、yue→auto（`src/stores/useSettingsStore.ts:114`，載入後才亮公告 `src/main-window.ts:66-67`）、越文聲調與泰文詞間空格的指示、幻聽改依文字系統（`src/lib/hallucinationDetector.ts:181-200`）、泰文日期西元（`src/lib/formatUtils.ts:16-23`）、七份 README。`f3c3689` 只改開發者 README 的發版步驟，使用者更新紀錄不收是對的。工作樹的四語指示升級對得上 `CHANGELOG.md:15`。日期 2026-10-26 與這兩筆提交同一天。

## 應改

[MED] `src/i18n/locales/zh-TW.json:424`、`zh-CN.json:424`、`en.json:424`、`ja.json:424`、`ko.json:424`、`vi.json:424`、`th.json:424` — 公告的語言設定名稱沒有對上各檔畫面上的標籤。介面語言：繁中「介面語言」、簡中「界面语言」、日文「表示言語」、韓文「인터페이스 언어」、越文「ngôn ngữ giao diện」對得上 `settings.app.language`（各檔 `:126`）。說話語言七語都用口語說法，畫面上是 `settings.app.transcriptionLanguage`（各檔 `:156`）：轉錄語言、转录语言、Transcription Language、文字起こし言語、전사 언어、Ngôn ngữ phiên âm、ภาษาที่ใช้ถอดเสียง。泰文連介面語言也偏了：公告是「ภาษาของหน้าจอ」，標籤是「ภาษาของอินเทอร์เฟซ」（`th.json:126`）。英文「the interface」是 Interface Language 的縮寫，其餘六語的介面語言是全稱。`CHANGELOG.md:11` 的「說話語言」與 `d518903` 提交說明相同，畫面上仍是「轉錄語言」。

[MED] `src/i18n/locales/th.json:425` — 「การตั้งค่าจะเปลี่ยนเป็น "ตรวจจับอัตโนมัติ" ให้แล้ว」將未來的 จะ 與已完成的 ให้แล้ว 放在同一句。遷移在 `loadSettings` 寫回 auto（`src/stores/useSettingsStore.ts:114`），公告在其後才打開（`src/main-window.ts:66-67`）。另外六語都是已完成：已改成、it now uses、切り替わっています、바뀌었습니다、đã tự chuyển。

## 可留

[LOW] `tests/unit/prompts-output-language.test.ts:48-55` — 三條不變量鎖得住語言插槽、字典標籤與「不是指令」。拿掉日文片假名的依據限制、韓文음차的依據限制，或結尾的「保留否定、條件、數字與日期」，這組仍綠。舊的 v0.14.1 逐字比對不能留，這次改法符合計畫；規則正文沒有整段凍結。

[LOW] `src/i18n/prompts.ts:65` — 英文「Names, people, and product names」的 people 比 zh-TW「人名」寬。下一句把範圍限在寫法，結尾又禁止添加原文沒有的資訊。與計畫逐字相同，可留。

[LOW] `CHANGELOG.md:15`、`src/lib/enhancer.ts:120-130` — 「游標前後文字」沒寫 `<context>` 裡同時有的 App 與視窗標題。1.0.0 那條寫過。`src/lib/formatUtils.ts:31-38` 的字素截斷也沒進 1.1.0；歷史預覽不再把泰文、越南文組合字從中切開。已寫的條目與程式一致。

結論：NOT READY

## 複審（第 2 輪）

只複審上一輪兩則 [MED]。七份 `src/i18n/locales/*.json` 以標準 JSON 解析通過，沒有重複鍵。各語系檔相對 HEAD 只改 `upgradeNotice` 的 `item1`／`item2`；`title`、`dismiss`、`settings.app.language`（`:126`）、`transcriptionLanguage`（`:156`）、`autoDetect`（`:159`）未動。

標籤。七個 `item1`（各檔 `:424`）都寫入該檔自己的介面語言與轉錄語言標籤，逐字相同：繁中「介面語言」「轉錄語言」；簡中“界面语言”“转录语言”（彎引號，不破壞 JSON）；英文 Interface Language、Transcription Language（標題大小寫，不加引號，與同檔 item2 的 Auto Detect 同一寫法）；日文「表示言語」「文字起こし言語」；韓文 '인터페이스 언어'、'전사 언어'；越文 "Ngôn ngữ giao diện"、"Ngôn ngữ phiên âm"；泰文 "ภาษาของอินเทอร์เฟซ"、"ภาษาที่ใช้ถอดเสียง"。上一輪的泰文「ภาษาของหน้าจอ」與英文縮寫 the interface 已不在語系檔。英文選項名 Tiếng Việt、ไทย與 `src/i18n/languageConfig.ts` 的 `displayName` 相同。七語都是：這兩個設定都能選越南文與泰文，說完仍會整理。

泰文時態。`th.json:425` 的遷移子句是「การตั้งค่าได้เปลี่ยนเป็น "ตรวจจับอัตโนมัติ" แล้ว」。這句沒有 จะ，也沒有上一輪的 ให้แล้ว；ได้…แล้ว是已完成。引號內ตรวจจับอัตโนมัติ等於該檔 `autoDetect`。後面「ให้เลือกใหม่ในการตั้งค่า」是還沒做的重選指示，與另外六語的祈使句一致（已改成、it now uses、切り替わっています、바뀌었습니다、đã tự chuyển）。`item1` 的「เสียงพูดจะถูกเรียบเรียง」是往後仍會整理，不是遷移。`loadSettings` 先把不支援的說話語言寫成 auto 再返回（`src/stores/useSettingsStore.ts:114`、`:1406-1411`），`src/main-window.ts:66-67` 仍是先 `loadSettings` 再 `consumeUpgradeNotice`。

CHANGELOG。`CHANGELOG.md:11` 寫「設定裡的「介面語言」和「轉錄語言」」，與繁中畫面標籤相同。同段其餘條目仍是四語指示升級、幻聽改依文字系統、泰文西元、移除粵語後改「自動偵測」。

未帶動其他行為。七檔 `item2` 的自動偵測用詞仍等於各檔 `autoDetect`。`src/MainApp.vue:89` 的 `upgradeNoticeItemCount` 仍是 2（工作樹只把 1 改成 2）。韓文 item1 仍收在「다듬어집니다」，item2 仍收在「바뀌었습니다」「됩니다」。`prompts.ts` 與測試的 diff 是上一輪已審的指示升級。

結論：READY
