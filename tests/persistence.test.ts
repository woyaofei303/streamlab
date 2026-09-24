import "fake-indexeddb/auto"
import { beforeEach, expect, it } from "vitest"
import { mutate, readState, resetState } from "../src/lib/db"

beforeEach(resetState)
it("serializes concurrent balance updates and deduplicates retries", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) =>
      mutate({
        type: "gift",
        userId: "viewer",
        channelId: "mei",
        amount: 100,
        key: `gift-${i}`,
      }),
    ),
  )
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5)
  expect((await readState()).users[0].credits).toBe(0)
  await mutate({
    type: "gift",
    userId: "viewer",
    channelId: "mei",
    amount: 100,
    key: "gift-0",
  })
  expect((await readState()).gifts).toHaveLength(5)
})
it("aborts the entire transaction when validation fails", async () => {
  await expect(
    mutate({
      type: "updateRoom",
      userId: "creator",
      channelId: "mei",
      title: "Must roll back",
      access: "invalid",
    }),
  ).rejects.toThrow()
  expect((await readState()).channels[0].title).not.toBe("Must roll back")
})
it("does not refund a spent top-up using a later balance", async () => {
  await mutate({
    type: "purchase",
    userId: "viewer",
    channelId: "mei",
    product: "credits",
    key: "topup",
  })
  const order = (await readState()).orders[0]
  await mutate({
    type: "gift",
    userId: "viewer",
    channelId: "mei",
    amount: 600,
    key: "spend",
  })
  await mutate({
    type: "purchase",
    userId: "viewer",
    channelId: "mei",
    product: "credits",
    key: "topup2",
  })
  await mutate({ type: "refund", userId: "viewer", orderId: order.id })
  const s = await readState()
  expect(s.orders.find((o) => o.id === order.id)?.status).toBe("refund_pending")
  expect(s.users[0].credits).toBe(900)
})
it("prevents a second user from overwriting another user message ID", async () => {
  await mutate({
    type: "message",
    userId: "viewer",
    channelId: "mei",
    id: "collision",
    text: "Original",
  })
  await expect(
    mutate({
      type: "message",
      userId: "creator",
      channelId: "mei",
      id: "collision",
      text: "Overwrite",
    }),
  ).rejects.toThrow()
  expect(
    (await readState()).messages.find((m) => m.id === "collision")?.text,
  ).toBe("Original")
})
