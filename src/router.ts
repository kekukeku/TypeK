import { createRouter, createWebHashHistory } from "vue-router";
import DashboardView from "./views/DashboardView.vue";
import HistoryView from "./views/HistoryView.vue";
import DictionaryView from "./views/DictionaryView.vue";
import HallucinationView from "./views/HallucinationView.vue";
import SettingsView from "./views/SettingsView.vue";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/dashboard" },
    { path: "/dashboard", component: DashboardView },
    { path: "/history", component: HistoryView },
    { path: "/dictionary", component: DictionaryView },
    { path: "/hallucinations", component: HallucinationView },
    { path: "/settings", component: SettingsView },
  ],
});

export default router;
