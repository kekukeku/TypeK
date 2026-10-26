# TypeK UI 刷新驗收報告：方案 D 繽紛少女風（Option D · Colourful Girly Pop）

> **驗收執行者**：小A（Antigravity，三師姊 / 峨嵋派Antigravity）  
> **審查基準**：
> - 拍板原型稿：[`docs/demos/ui-refresh/option-d.html`](file:///Users/kevinkuo/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/Github%20project/TypeK/docs/demos/ui-refresh/option-d.html)
> - 落地映射手冊：[`docs/demos/ui-refresh/option-d-mapping.md`](file:///Users/kevinkuo/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/Github%20project/TypeK/docs/demos/ui-refresh/option-d-mapping.md)
> - 專案 UI 規範：[`.claude/rules/ui.md`](file:///Users/kevinkuo/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/Github%20project/TypeK/.claude/rules/ui.md)
> - 真實畫面截圖：`docs/demos/ui-refresh/screens/`（Light & Dark 雙模式真實前端畫面）
> - 程式碼審查範圍：`src/` 變更之 21 個檔案與 `tests/component/NotchHud.test.ts`
> 
> **驗收日期**：2026-10-26

---

## 1. 執行摘要

小D（DeepSeek）依據映射規格手冊進行了紮實且全面的實作，整體視覺氛圍非常亮眼！在淺色模式下，棉花糖奶霜白（`#fff6fa`）與濃郁黑醋栗葡萄深紫（`#3c1945`）達成了極高的對比度（> 12:1），純白卡片在柔和果凍微光陰影下展現出甜美且專業的質感；深色模式下，午夜星空黑曜深紫（`#150d22`）搭配紫水晶卡片（`#221434`）與星塵粉白文字，護眼且極具魔法感。

Notch HUD 的彩虹軟糖 6 色波形、心跳愛心律動、旋轉魔法星芒、薄荷綠漸變勳章以及無障礙動效降級（`prefers-reduced-motion`）全數落實到位，且嚴格遵守「不手寫替代控制項」、「全域唯一使用 Lucide 圖標」、「不任意新增業務文案與 Emoji」等專案規範。

目前僅存在 **2 處「⚠️ 部分符合」的次要視覺對齊項**（側邊欄 Active 項文字與圖標粉色高光被 shadcn-vue 內部樣式權重覆蓋、統計卡片「分鐘」單位文字未分離套用粉紅高光）以及 **2 處微調優化項**。修復難度極低，請小D依本報告第 4 節之指示修正。

---

## 2. 逐項驗收清單（對照 Option D Mapping 第 4 節）

### 4.1 全域與主外殼（Main Shell & Navigation）

| 驗收項目 | 模式 | 判定結果 | 實測佐證與觀察細節 |
| :--- | :---: | :---: | :--- |
| **1. 圓角一致性**<br>所有卡片、對話框呈現 20px 飽滿圓角（`--radius: 1.25rem`），按鈕與標籤為全圓角膠囊（Pill） | Light & Dark | ✅ 符合 | • `src/style.css:58, 60` 定義 `--radius: 1.25rem`<br>• `src/components/ui/card/Card.vue:15` 繼承 `rounded-[var(--radius)]`<br>• `src/components/ui/button/index.ts:7`、`src/components/ui/badge/index.ts:7`、`src/components/ui/input/Input.vue:27`、`src/components/ui/select/SelectTrigger.vue:24` 全數標配 `rounded-full`<br>• 截圖 `light-dashboard.jpg`、`dark-dashboard.jpg`、`dark-history.jpg`、`dark-dictionary.jpg` 中所有卡片與控制項圓角圓潤飽滿。 |
| **2. 淺色畫布氛圍**<br>棉花糖奶霜粉白底色（`#fff6fa`），漫射彩虹微光感，非死白。本文文字對比度 ≥ 12:1 | Light | ✅ 符合 | • 截圖 `light-dashboard.jpg`、`light-settings.jpg`<br>• `src/style.css:61-64` 設定 `--background: #fff6fa`、`--foreground: #3c1945`<br>• `src/MainApp.vue:344` 套用 `.dreamy-aura-bg` 漫射微光背景<br>• 本文色彩為黑醋栗深紫，文字清晰銳利，對比度實測 > 12:1。 |
| **3. 深色畫布氛圍**<br>魔法少女午夜星空深紫（`#150d22`），晶瑩紫水晶果凍卡片（`#221434`），星塵粉白文字 | Dark | ✅ 符合 | • 截圖 `dark-dashboard.jpg`、`dark-settings.jpg`、`dark-history.jpg`、`dark-dictionary.jpg`<br>• `src/style.css:132-137` 設定深色底色與卡片底色，搭配霓虹粉邊框微光<br>• 通透不沉悶，深邃且具備魔法氛圍。 |
| **4. 側邊欄導航**<br>選中項呈現粉紫漸變全圓角膠囊，圖標與文字高亮粉色，懸浮帶有微位移（`translate-x-1`） | Light & Dark | ⚠️ 部分符合 | • `src/MainApp.vue:291-296` 已加上膠囊與位移 class<br>• **問題所在**：截圖 `light-dashboard.jpg` 顯示「儀表板」選中時文字與圖標為黑紫色（`#2d1035`）；`dark-dashboard.jpg` 顯示選中時背景為純深紫（`#26123b`）、文字與圖標為純白（`#ffffff`），均**未呈現主題粉色高光**。原因為 `src/components/ui/sidebar/index.ts:39` 的 `sidebarMenuButtonVariants` 帶有 `data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground`，其屬性選擇器權重覆蓋了 `MainApp.vue` 傳入的 `text-primary` 與背景漸變。需明確提升權重修復（見第 4 節 Fix 1）。 |
| **5. 標題列**<br>固定頂部拖曳列與側邊欄色彩無縫銜接，字體呈現親和圓體質感 | Light & Dark | ✅ 符合 | • `src/MainApp.vue:270-272` 設定 `border-b border-sidebar-border bg-sidebar/90 backdrop-blur-md`<br>• 標題文字置中，套用 `SF Pro Rounded` 字體棧<br>• 截圖 `light-dashboard.jpg`、`dark-dashboard.jpg` 頂部銜接自然一體。 |

---

### 4.2 儀表板頁面（DashboardView）

| 驗收項目 | 模式 | 判定結果 | 實測佐證與觀察細節 |
| :--- | :---: | :---: | :--- |
| **1. 6 格統計卡片**<br>每張卡片具備雙層果凍微光陰影（`--jelly-shadow`），懸浮柔和浮起（`hover:-translate-y-0.5`） | Light & Dark | ✅ 符合 | • `src/views/DashboardView.vue:185, 196, 207, 218, 229, 243` 每張卡片均套用 `shadow-jelly rounded-[var(--radius)] border-border bg-card transition-all duration-200 hover:-translate-y-0.5`<br>• 截圖 `light-dashboard.jpg`、`dark-dashboard.jpg` 呈現柔和雙層光暈。 |
| **2. 等寬數值排印**<br>數字採用 `tabular-nums`，字級飽滿（`text-3xl`），單位文字高亮為主題草莓粉 | Light & Dark | ⚠️ 部分符合 | • 截圖 `light-dashboard.jpg`、`dark-dashboard.jpg`：Card 2（口述字數）、Card 4（總使用次數）、Card 5（平均每次字數）均成功將單位「字」、「次」以 `<span class="text-primary font-semibold text-sm">` 呈現鮮豔草莓粉色，數字為等寬 `tabular-nums text-3xl`（30px）。<br>• **問題所在**：Card 1（總口述時間）與 Card 3（節省時間）因直接渲染 `formatDurationFromMs(...)` 回傳之單一字串，導致「0 分鐘」的「分鐘」留在段落預設的 `text-foreground`，未獨立高亮粉色（見第 4 節 Fix 2）。 |
| **3. 今日額度進度條**<br>呈現三色果凍彩虹漸變（蜜桃粉 → 薰衣草紫 → 天空藍），進度槽為全圓角 | Light & Dark | ✅ 符合 | • `src/views/DashboardView.vue:256-262`<br>• `src/style.css:231-244` 定義 `.rainbow-track` 與 `.rainbow-fill`<br>• 截圖 `light-dashboard.jpg`、`dark-dashboard.jpg` Card 6 清楚可見 100% 飽滿之彩虹漸變果凍條，過渡平滑且帶有霓虹外光暈。 |
| **4. 使用趨勢圖**<br>Unovis 漸變層與折線呈現通透蜜桃草莓粉光暈，無生硬毛刺或軸線截斷 | Light & Dark | ✅ 符合 | • `src/components/DashboardUsageChart.vue:22-27` 設定 `<linearGradient id="fillCount">` 為 `var(--chart-1)` 至 `var(--chart-2)` 淡出<br>• 折線綁定 `var(--chart-1)`，線寬 2.5px<br>• 截圖為空狀態（瀏覽器無後端 DB），程式碼中 SVG 配置與容器樣式皆完全符合規範。 |
| **5. 最近轉錄項目**<br>歷史記錄以圓角膠囊列排布，AI 精修徽章呈現晶透果凍質感 | Light & Dark | ✅ 符合 | • `src/views/DashboardView.vue:382-404`<br>• 記錄按鈕套用 `rounded-2xl border border-border bg-card p-3.5 hover:translate-x-1 hover:bg-accent/60`<br>• 精修標籤使用 `<Badge class="badge-jelly">`<br>• `src/style.css:217-228` 正確定義 `.badge-jelly`。 |

---

### 4.3 偏好設定頁面（SettingsView）

| 驗收項目 | 模式 | 判定結果 | 實測佐證與觀察細節 |
| :--- | :---: | :---: | :--- |
| **1. AI 平臺選擇**<br>選中平臺卡片外圈呈現草莓粉高光聚焦環與淺粉底色，未選中項邊框柔和 | Light & Dark | ✅ 符合 | • `src/views/SettingsView.vue:1424-1428`<br>• 選中狀態套用 `border-2 border-primary bg-gradient-to-br from-card to-accent font-bold text-primary shadow-jelly`<br>• 截圖 `light-settings.jpg`、`dark-settings.jpg` 中的分段按鈕（簡易 / 自訂、Hold / Toggle）在選中時亦呈現高飽和泡泡糖粉紅底色與純白文字。 |
| **2. 金鑰與文字輸入框**<br>輸入框為全圓角膠囊造型，Focus 聚焦環為草莓粉柔光 | Light & Dark | ✅ 符合 | • `src/components/ui/input/Input.vue:27-28` 標配 `rounded-full border px-4 shadow-xs` 與 `focus-visible:border-ring focus-visible:ring-ring/50`<br>• 截圖 `dark-history.jpg`、`dark-dictionary.jpg`、`light-settings.jpg` 下拉選單與輸入框全為膠囊造型。 |
| **3. 快捷鍵與錄製**<br>熱鍵以手帳果凍標籤呈現，錄製按鈕造型圓潤 | Light & Dark | ✅ 符合 | • `src/views/SettingsView.vue:1115-1123`<br>• 自訂熱鍵顯示套用 `.badge-jelly`，錄製按鈕套用 `rounded-full` 搭配呼吸燈動畫。 |
| **4. Switch 開關**<br>開啟狀態呈現粉紫彩虹漸變，滑動阻尼手感滑順，關閉狀態為柔和淡霧灰紫 | Light & Dark | ✅ 符合 | • `src/components/ui/switch/Switch.vue:27-34`<br>• 開啟狀態使用 `data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-primary data-[state=checked]:to-chart-2`<br>• 滑塊使用高光純白圓鈕 `bg-primary-foreground shadow-md rounded-full`。 |
| **5. 隱私守護區塊**<br>上下文感知下方呈現淡粉紫手帳專屬底盒，邊框精緻 | Light & Dark | ✅ 符合 | • `src/views/SettingsView.vue:1820`<br>• 套用 `rounded-[var(--radius)] border border-border bg-secondary/50 p-3.5 text-xs leading-relaxed text-foreground`。 |

---

### 4.4 轉錄歷史、自訂詞庫與指南（History, Dictionary & Guide）

| 驗收項目 | 模式 | 判定結果 | 實測佐證與觀察細節 |
| :--- | :---: | :---: | :--- |
| **1. 搜尋框與動作按鈕**<br>全數呈現全圓角膠囊外觀，聚焦色彩統一 | Light & Dark | ✅ 符合 | • 截圖 `dark-history.jpg`：搜尋框為全圓角膠囊<br>• 截圖 `dark-dictionary.jpg`：「0 詞彙」Badge、匯出、匯入按鈕、新詞輸入框、新增按鈕皆為圓潤膠囊，聚焦與色彩一致。 |
| **2. 表格細節**<br>詞庫表格行選取為淡淡櫻花高光，權重 Badge 呈現雙色糖果層次 | Light & Dark | ✅ 符合 | • `src/views/DictionaryView.vue:50-54, 327, 330`<br>• `TableRow` 套用 `hover:bg-accent/40 transition-colors`<br>• 高權重（≥30）套用 `chart-1` 粉紅，次權重（≥10）套用 `chart-2` 薰衣草紫。 |
| **3. 使用指南卡片**<br>卡片排版圓潤，圖標具備粉紫微底座，閱讀節奏舒適 | Light & Dark | ✅ 符合 | • `src/views/FeatureGuideView.vue:36-42`<br>• 每張指南卡片套用 `shadow-jelly rounded-[var(--radius)] hover:scale-[1.01]`<br>• 圖標底座為 `rounded-lg bg-secondary text-primary`。 |

---

### 4.5 Notch HUD 實體狀態（NotchHud.vue + src/style.css）

> *註：HUD 需搭配 macOS Tauri 原生視窗與後端運作，無法直接在無後端瀏覽器環境中截圖，本章節全面審查 `src/components/NotchHud.vue`、`src/style.css` 原始碼及 `tests/component/NotchHud.test.ts` 單元測試。*

| 驗收項目 | 模式 | 判定結果 | 實測佐證與觀察細節 |
| :--- | :---: | :---: | :--- |
| **1. 外殼造型**<br>深莓黑夜琉璃外殼貼合螢幕缺口，邊緣具備草莓粉氛圍柔光與微星芒點綴 | HUD 專屬深色外殼 | ✅ 符合 | • `src/components/NotchHud.vue:476-509`<br>• 背景使用 `var(--notch-bg)`（`#281232`），邊框 `rgba(244, 114, 182, 0.3)`，外陰影 `drop-shadow(var(--notch-glow))` 帶有草莓粉柔光<br>• 左右兩側配置 `Sparkles` 圖標搭配 `twinkle` 關鍵影格動畫。 |
| **2. 錄音中狀態**<br>中央 6 根波形條呈現彩虹軟糖 6 色分段，隨即時音量彈跳；左側愛心輕柔律動；右側計時器數字清晰 | 錄音狀態 | ✅ 符合 | • `src/components/NotchHud.vue:393-417, 572-598`<br>• 左側 Lucide `Heart` 搭配 `heartBeat` 動畫<br>• 6 根波形條分別賦予 6 檔糖果色變數（`--notch-wave-1` 到 `--notch-wave-6`）與交錯 delay<br>• 右側計時器使用 `.elapsed-timer.badge-jelly` 等寬排印。 |
| **3. 整理中狀態**<br>魔法星芒（Sparkles）平滑旋轉，傳遞精靈潤飾意象 | 整理狀態 | ✅ 符合 | • `src/components/NotchHud.vue:399-404, 614-621`<br>• Lucide `Sparkles` 搭配 `spinMagic` 360 度旋轉動畫<br>• 脈衝波形轉換為滑動點（`waveform-dot`）。 |
| **4. 已貼上狀態**<br>薄荷綠漸變勳章平滑滑入，伴隨柔和光澤與完成時間 | 成功狀態 | ✅ 符合 | • `src/components/NotchHud.vue:418-420, 668-709`<br>• `.success-medal` 套用薄荷綠漸變 `from-notch-success-from to-notch-success-to` 搭配 `medalPop` 動畫<br>• 外層加入 `.notch-wrapper-success` 邊緣綠光漣漪光暈。 |
| **5. 錯誤狀態**<br>紅色多汁草莓泡泡提示與糖果膠囊按鈕，具備晃動回饋 | 錯誤狀態 | ✅ 符合 | • `src/components/NotchHud.vue:443-452, 460-462, 854-865`<br>• 錯誤訊息字色為西瓜軟糖粉白 `var(--notch-error-fg)`（`#ffe4e6`）<br>• 錯誤時觸發 `.notch-shake` 左右晃動回饋<br>• 小D依據 3.4 節守則，未隨意硬編碼新增「重新施法」文字，而是以粉紅糖果膠囊樣式包裹 `RotateCcw` 重試圖示，完全符合規則！ |
| **6. 動效無障礙**<br>系統開啟「減少動態效果」時自動退回靜態高對比，無過度閃爍或強烈晃動 | A11y | ✅ 符合 | • `src/style.css:255-272` 宣告 `@media (prefers-reduced-motion: reduce)`<br>• 涵蓋 `.shadow-jelly`、`.wave-candy-bar`、`.magic-star`、`.heart-pulse`、`.notch-star`、`.notch-shake`、`.waveform-dot` 等全部動效，強制關閉 animation 與 transform。 |

---

## 3. 規格手冊第 3 節守則遵守審查（Section 3 Rules Audit）

| 守則項目 | 要求標準 | 檢查結果 | 詳細說明 |
| :--- | :--- | :---: | :--- |
| **3.1 嚴禁在 Vue 檔案中硬編碼任意色彩** | 禁用 raw Tailwind 色值與十六進位 Hex，一律使用語意 token 或 CSS 變數 | ✅ 嚴格遵守 | 審查所有 21 個 Vue 元件，未發現任何 `bg-[#...]` 或 `text-zinc-*` 硬編碼色值。全數採用 `bg-primary`、`bg-card`、`border-border`、`var(--chart-*)` 等語意變數驅動。 |
| **3.2 嚴禁手寫 HTML 控制項替代品** | 必須使用 shadcn-vue 元件（`Switch`、`Button`、`Input`、`Select`、`Table`） | ✅ 嚴格遵守 | 表單開關全數採用 `<Switch>`、按鈕全數使用 `<Button>`、輸入框使用 `<Input>`、選單使用 `<Select>`，DOM 結構標準且完整具備無障礙屬性。 |
| **3.3 圖標唯一標準：`lucide-vue-next`** | 禁用 `@tabler/icons-vue` 與手寫長段 SVG 路徑 | ✅ 嚴格遵守 | 所有圖標（`Heart`、`Sparkles`、`Check`、`RotateCcw`、`Search`、`Download` 等）全數自 `lucide-vue-next` 導入。 |
| **3.4 嚴禁在介面文字中強塞 Emoji** | 保留既有業務文案與 i18n 鍵值，禁止在說明字串或 i18n 字典強加裝飾文字 | ✅ 嚴格遵守 | 業務文案 100% 維持 `$t(...)`，未修改字典檔；Notch HUD 重試按鈕遵循此規範，保留圖標按鈕未硬塞「重新施法」字串。小D的這項判斷非常正確且專業！ |
| **3.5 動畫必須尊重 `prefers-reduced-motion`** | 提供降低動態效果媒體查詢覆蓋 | ✅ 嚴格遵守 | `src/style.css` 完整涵蓋所有新增的少女波動畫與抖動動畫，並在 Claude 協調人補充 `.waveform-dot` 後完全無遺漏。 |

---

## 4. 具體修復指引（Fixes for 小D）

請小D直接套用以下 4 項具體修改：

### Fix 1：側邊欄選中項目高光與漸變修復（解決 4.1-4 ⚠️）
- **目標檔案**：[`src/MainApp.vue`](file:///Users/kevinkuo/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/Github%20project/TypeK/src/MainApp.vue) L288-297
- **問題分析**：`SidebarMenuButtonChild` 的 `data-active="true"` 帶有 CVA 預設樣式 `data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground`，因屬性選擇器權重較高，導致傳入的 `text-primary` 被吃掉，在淺色模式變成黑紫字、深色模式變成純白字與純暗紫底。
- **修改方式**：在 `:class` 的 active 判斷中加上 `data-[active=true]:*` 選擇器以拉平權重：
```vue
<!-- 將 src/MainApp.vue L288-297 替換為： -->
                <SidebarMenuButton
                  as-child
                  :is-active="route.path.startsWith(item.path)"
                  :class="[
                    'rounded-full transition-all duration-200 hover:translate-x-1',
                    route.path.startsWith(item.path)
                      ? 'border border-border shadow-sm font-bold data-[active=true]:bg-gradient-to-r data-[active=true]:from-card data-[active=true]:to-accent data-[active=true]:text-primary data-[active=true]:[&>svg]:text-primary'
                      : '',
                  ]"
                >
```

---

### Fix 2：統計卡片 1 與 3 之單位文字高亮（解決 4.2-2 ⚠️）
- **目標檔案**：[`src/views/DashboardView.vue`](file:///Users/kevinkuo/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/Github%20project/TypeK/src/views/DashboardView.vue)
- **問題分析**：Card 1（總口述時間）與 Card 3（節省時間）直接輸出 `formatDurationFromMs(...)`，例如「0 分鐘」，使得「分鐘」混在數字段落中成為黑色/白色，未能如同 Card 2、4、5 般擁有草莓粉色單位。
- **修改方式**：
在 `<script setup>` 中新增簡單的拆分輔助函式：
```ts
function splitDuration(ms: number): { value: string; unit: string } {
  const str = formatDurationFromMs(ms);
  const match = str.match(/^([\d.,]+)\s*(.*)$/);
  if (!match) return { value: str, unit: "" };
  return { value: match[1], unit: match[2] };
}
```
並在範本中將 Card 1（L190）與 Card 3（L212）更新為：
```vue
<!-- Card 1: 總口述時間 -->
<CardContent>
  <p class="text-3xl font-extrabold tabular-nums tracking-tight text-foreground">
    {{ splitDuration(historyStore.dashboardStats.totalRecordingDurationMs).value }}
    <span v-if="splitDuration(historyStore.dashboardStats.totalRecordingDurationMs).unit" class="ml-1 text-sm font-semibold text-primary">
      {{ splitDuration(historyStore.dashboardStats.totalRecordingDurationMs).unit }}
    </span>
  </p>
</CardContent>

<!-- Card 3: 節省時間 -->
<CardContent>
  <p class="text-3xl font-extrabold tabular-nums tracking-tight text-foreground">
    {{ splitDuration(historyStore.dashboardStats.estimatedTimeSavedMs).value }}
    <span v-if="splitDuration(historyStore.dashboardStats.estimatedTimeSavedMs).unit" class="ml-1 text-sm font-semibold text-primary">
      {{ splitDuration(historyStore.dashboardStats.estimatedTimeSavedMs).unit }}
    </span>
  </p>
</CardContent>
```

---

### Fix 3：淺色模式 `--success` Token 顏色校正（細節優化）
- **目標檔案**：[`src/style.css`](file:///Users/kevinkuo/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/Github%20project/TypeK/src/style.css) L76
- **問題分析**：`:root` 的 `--success` 被誤設為深綠色 `#047857`，在 Option D 提案與 Demo 中淺色成功色應為清新薄荷甜心綠 `#10b981`。
- **修改方式**：
```css
/* 將 src/style.css L76 改為： */
  --success: #10b981;
```

---

### Fix 4：圖表空狀態容器圓角一致性（細節優化）
- **目標檔案**：[`src/components/DashboardUsageChart.vue`](file:///Users/kevinkuo/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/Github%20project/TypeK/src/components/DashboardUsageChart.vue) L72
- **問題分析**：無資料空狀態外框使用了 `rounded-lg`，應與其他卡片統一採用 `rounded-[var(--radius)]`。
- **修改方式**：
```vue
<!-- 將 src/components/DashboardUsageChart.vue L72 改為： -->
  <div v-if="props.data.length === 0" class="rounded-[var(--radius)] border border-dashed border-border px-4 py-8 text-center text-muted-foreground">
```

---

## 5. 總結矩陣表（Summary Matrix）

| 畫面 / 元件 | 淺色模式 (Light) | 深色模式 (Dark) | 綜合判定 | 備註說明 |
| :--- | :---: | :---: | :---: | :--- |
| **全域主外殼 (Main Shell & Navigation)** | ⚠️ 部分符合 | ⚠️ 部分符合 | ⚠️ NEEDS-FIXES | 外殼與標題列極佳；側邊欄選中項目文字/圖標粉紅高光待修復（Fix 1） |
| **儀表板 (DashboardView)** | ⚠️ 部分符合 | ⚠️ 部分符合 | ⚠️ NEEDS-FIXES | 6 格卡片、彩虹額度槽極佳；Card 1 與 Card 3 單位高光待補全（Fix 2） |
| **偏好設定 (SettingsView)** | ✅ 符合 | ✅ 符合 | ✅ PASS | 分段按鈕、輸入框、下拉選單、開關與隱私盒皆完美呈現 |
| **轉錄歷史 (HistoryView)** | ✅ 符合 | ✅ 符合 | ✅ PASS | 手帳膠囊搜尋框、圓潤卡片與操作按鈕完全符合 |
| **自訂詞庫 (DictionaryView)** | ✅ 符合 | ✅ 符合 | ✅ PASS | 動作按鈕、新詞膠囊輸入框與手帳底盒完全符合 |
| **功能介紹 (FeatureGuideView)** | ✅ 符合 | ✅ 符合 | ✅ PASS | 20px 圓角果凍展臺與粉紫圖標底座完全符合 |
| **Notch HUD 實體狀態 (NotchHud.vue)** | ✅ 符合 | ✅ 符合 | ✅ PASS | 彩虹波形、星芒、愛心、勳章與 A11y 均通過嚴格審查與測試 |

---

ACCEPTANCE: NEEDS-FIXES

---

## 複驗（2026-10-26）

> **複驗執行者**：小A（Antigravity，三師姊 / 峨嵋派Antigravity）  
> **審查依據**：小D提交之修復程式碼、單元測試 `tests/unit/format-utils.test.ts`、最新截圖 `docs/demos/ui-refresh/screens/light-dashboard-v2.jpg` 與 `dark-dashboard-v2.jpg`。

### Fix 1–4 驗證結果

- **Fix 1（側邊欄選中項目高光與漸變）**：✅ 符合。`src/MainApp.vue:294` 補上 `data-[active=true]:bg-gradient-to-r data-[active=true]:from-card data-[active=true]:to-accent data-[active=true]:text-primary data-[active=true]:[&>svg]:text-primary` 拉平 CVA 屬性權重；最新截圖 `light-dashboard-v2.jpg` 與 `dark-dashboard-v2.jpg` 證實選中項「儀表板」呈現高亮草莓粉文字與圖標（DOM 實測 `rgb(236,72,153)`），搭配全圓角漸變膠囊背景。
- **Fix 2（統計卡片 1 與 3 單位文字粉色高光）**：✅ 符合。小D採用架構級解法，於 `src/lib/formatUtils.ts` 實作 `splitNumberSegments()` 並在 `src/views/DashboardView.vue` 透過 `totalRecordingSegments` 與 `timeSavedSegments` 進行數字段與單位段分離渲染，優雅相容多語系與「1 小時 5 分鐘」等複合數字段情境，且在 `tests/unit/format-utils.test.ts` 補齊完整單元測試；截圖確認「0 分鐘」之「分鐘」已如期呈現鮮豔草莓粉。
- **Fix 3（淺色模式 `--success` 顏色校正）**：✅ 駁回合理，維持現狀。Claude 協調人針對 Fix 3 予以駁回的決策完全正確、專業且具備無障礙（A11y）遠見。小A完全贊同此裁決：清新薄荷綠 `#10b981` 在淺色背景（`#ffffff` / `#fff6fa`）上的對比度僅約 2.53:1，嚴重違反 WCAG 2.1 AA 規範本文對比度需 ≥ 4.5:1 的硬性要求；維持 `--success: #047857`（對比度 5.48:1）能確保常規本文與狀態提示的可讀性與無障礙合規，而 Notch HUD 屬於常駐深莓外殼（`--notch-bg: #281232`），仍透過 `--notch-success-to: #10b981` 與 `--notch-success-from: #34d399` 保有明亮剔透的薄荷漸變，兼顧了設計美感與無障礙底線。
- **Fix 4（圖表空狀態容器圓角一致性）**：✅ 符合。`src/components/DashboardUsageChart.vue:72` 已將 `rounded-lg` 修正為 `rounded-[var(--radius)]`，與 6 格統計卡片之 20px 飽滿圓角完全統一；最新截圖驗證虛線空狀態外框圓角自然平滑。

### 遺留問題（Remaining Issues）

- **無任何遺留問題**：全部 4 項修復與對齊已徹底完成，全域主外殼、儀表板卡片、圖表空狀態與 Notch HUD 之視覺、動效、A11y 標準皆完美符合 Option D 規格手冊與專案規範。

---

ACCEPTANCE: PASS