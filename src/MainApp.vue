<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import {
  BookOpen,
  FileText,
  LayoutDashboard,
  Settings,
} from "lucide-vue-next";
import { computed, markRaw, onMounted, ref } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import AccessibilityGuide from "./components/AccessibilityGuide.vue";
import SiteHeader from "./components/SiteHeader.vue";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";

declare const __APP_VERSION__: string;
const appVersion = __APP_VERSION__;

const navItems = [
  { path: "/dashboard", label: "儀表板", icon: markRaw(LayoutDashboard) },
  { path: "/history", label: "歷史記錄", icon: markRaw(FileText) },
  { path: "/dictionary", label: "自訂字典", icon: markRaw(BookOpen) },
  { path: "/settings", label: "設定", icon: markRaw(Settings) },
];

const route = useRoute();
const currentPageTitle = computed(() => {
  const item = navItems.find((n) => route.path.startsWith(n.path));
  return item?.label ?? "SayIt";
});

const showAccessibilityGuide = ref(false);

onMounted(async () => {
  const isMacOS = navigator.userAgent.includes("Macintosh");
  if (!isMacOS) return;

  try {
    const hasAccessibilityPermission = await invoke<boolean>(
      "check_accessibility_permission_command",
    );
    showAccessibilityGuide.value = !hasAccessibilityPermission;
  } catch (error) {
    console.error(
      "[main-window] Failed to check accessibility permission:",
      error,
    );
  }
});
</script>

<template>
  <!-- macOS Overlay 自訂標題列：fixed z-20 蓋住 Sidebar(z-10)，整條可拖動 -->
  <div
    data-tauri-drag-region
    class="fixed top-0 left-0 right-0 z-20 flex h-9 items-center justify-center border-b border-border bg-background"
  >
    <span data-tauri-drag-region class="text-xs font-medium text-muted-foreground select-none">SayIt - 言</span>
  </div>

  <SidebarProvider class="h-screen !min-h-0 pt-9">
    <Sidebar collapsible="offcanvas">
      <SidebarHeader class="flex-row h-12 items-center gap-3 border-b border-sidebar-border px-4">
        <img src="@/assets/logo-yan.png" alt="言" class="h-7 w-auto" />
        <span class="text-base font-semibold text-sidebar-foreground tracking-wide" style="font-family: 'SF Pro Display', 'Inter', system-ui, sans-serif;">SayIt</span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in navItems" :key="item.path">
                <SidebarMenuButton
                  as-child
                  :is-active="route.path.startsWith(item.path)"
                >
                  <RouterLink :to="item.path">
                    <component :is="item.icon" />
                    <span>{{ item.label }}</span>
                  </RouterLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter class="border-t border-sidebar-border px-4 py-2">
        <span class="text-xs text-muted-foreground">v{{ appVersion }}</span>
      </SidebarFooter>
    </Sidebar>

    <SidebarInset class="overflow-hidden">
      <SiteHeader :title="currentPageTitle" />
      <div class="flex-1 overflow-y-auto">
        <RouterView />
      </div>
    </SidebarInset>
  </SidebarProvider>

  <AccessibilityGuide
    :visible="showAccessibilityGuide"
    @close="showAccessibilityGuide = false"
  />
</template>
