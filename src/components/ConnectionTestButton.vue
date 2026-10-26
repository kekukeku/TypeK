<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { CircleCheck, CircleX } from "lucide-vue-next";
import type { TestResult } from "@/lib/connectionTest";

const props = defineProps<{
  onTest: () => Promise<TestResult>;
  disabled?: boolean;
}>();

const { t } = useI18n();
const testing = ref(false);
const result = ref<TestResult | null>(null);

async function handleTest() {
  testing.value = true;
  result.value = null;
  try {
    result.value = await props.onTest();
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <div class="space-y-2">
    <Button
      type="button"
      variant="outline"
      size="sm"
      :disabled="disabled || testing"
      @click="handleTest"
    >
      {{
        testing
          ? t("settings.connectionTest.testing")
          : t("settings.connectionTest.button")
      }}
    </Button>

    <div
      v-if="result?.ok === true"
      class="flex items-center gap-1.5 text-sm text-success"
    >
      <CircleCheck class="size-4" aria-hidden="true" />
      {{ t("settings.connectionTest.success", { ms: result.durationMs }) }}
    </div>

    <div
      v-else-if="result?.ok === false"
      class="flex items-center gap-1.5 text-sm text-destructive"
    >
      <CircleX class="size-4" aria-hidden="true" />
      {{ result.errorMessage }}
    </div>
  </div>
</template>
