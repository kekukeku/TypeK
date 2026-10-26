<script setup lang="ts">
import { TrendingDown, TrendingUp } from "lucide-vue-next"

import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
</script>

<template>
  <div class="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
    <Card class="@container/card shadow-jelly">
      <CardHeader>
        <CardDescription>Total Revenue</CardDescription>
        <CardTitle class="text-3xl font-extrabold tabular-nums tracking-tight @[250px]/card:text-3xl">
          $1,250.00
        </CardTitle>
        <CardAction>
          <Badge variant="outline">
            <TrendingUp />
            +12.5%
          </Badge>
        </CardAction>
      </CardHeader>
      <CardFooter class="flex-col items-start gap-1.5 text-sm">
        <div class="line-clamp-1 flex gap-2 font-medium">
          Trending up this month <TrendingUp class="size-4" />
        </div>
        <div class="text-muted-foreground">
          Visitors for the last 6 months
        </div>
      </CardFooter>
    </Card>
    <Card class="@container/card shadow-jelly">
      <CardHeader>
        <CardDescription>New Customers</CardDescription>
        <CardTitle class="text-3xl font-extrabold tabular-nums tracking-tight @[250px]/card:text-3xl">
          1,234
        </CardTitle>
        <CardAction>
          <Badge variant="outline">
            <TrendingDown />
            -20%
          </Badge>
        </CardAction>
      </CardHeader>
      <CardFooter class="flex-col items-start gap-1.5 text-sm">
        <div class="line-clamp-1 flex gap-2 font-medium">
          Down 20% this period <TrendingDown class="size-4" />
        </div>
        <div class="text-muted-foreground">
          Acquisition needs attention
        </div>
      </CardFooter>
    </Card>
    <Card class="@container/card shadow-jelly">
      <CardHeader>
        <CardDescription>Active Accounts</CardDescription>
        <CardTitle class="text-3xl font-extrabold tabular-nums tracking-tight @[250px]/card:text-3xl">
          45,678
        </CardTitle>
        <CardAction>
          <Badge variant="outline">
            <TrendingUp />
            +12.5%
          </Badge>
        </CardAction>
      </CardHeader>
      <CardFooter class="flex-col items-start gap-1.5 text-sm">
        <div class="line-clamp-1 flex gap-2 font-medium">
          Strong user retention <TrendingUp class="size-4" />
        </div>
        <div class="text-muted-foreground">
          Engagement exceed targets
        </div>
      </CardFooter>
    </Card>
    <Card class="@container/card shadow-jelly">
      <CardHeader>
        <CardDescription>Growth Rate</CardDescription>
        <CardTitle class="text-3xl font-extrabold tabular-nums tracking-tight @[250px]/card:text-3xl">
          4.5%
        </CardTitle>
        <CardAction>
          <Badge variant="outline">
            <TrendingUp />
            +4.5%
          </Badge>
        </CardAction>
      </CardHeader>
      <CardFooter class="flex-col items-start gap-1.5 text-sm">
        <div class="line-clamp-1 flex gap-2 font-medium">
          Steady performance increase <TrendingUp class="size-4" />
        </div>
        <div class="text-muted-foreground">
          Meets growth projections
        </div>
      </CardFooter>
    </Card>
  </div>
</template>
