<script setup lang="ts">
import { RouterLink, RouterView } from "vue-router";

const navItems = [
  { path: "/dashboard", label: "Dashboard", icon: "📊" },
  { path: "/history", label: "歷史記錄", icon: "📝" },
  { path: "/dictionary", label: "自訂字典", icon: "📖" },
  { path: "/settings", label: "設定", icon: "⚙️" },
];
</script>

<template>
  <div class="flex h-screen bg-zinc-950 text-white">
    <!-- Sidebar -->
    <nav class="flex w-56 flex-col border-r border-zinc-800 bg-zinc-900">
      <div class="flex h-14 items-center gap-2 border-b border-zinc-800 px-4">
        <span class="text-lg font-semibold">SayIt</span>
      </div>
      <div class="flex flex-1 flex-col gap-1 p-2">
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
          active-class="!bg-zinc-800 !text-white"
        >
          <span>{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </RouterLink>
      </div>
    </nav>

    <!-- Main Content -->
    <main class="flex-1 overflow-y-auto">
      <RouterView />
    </main>
  </div>
</template>
