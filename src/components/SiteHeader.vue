<script setup lang="ts">
defineProps<{
  title: string;
}>();
</script>

<template>
  <header
    class="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-6 backdrop-blur-md"
  >
    <h1 class="text-lg font-extrabold tracking-tight text-foreground">
      {{ title }}
    </h1>
  </header>
</template>
