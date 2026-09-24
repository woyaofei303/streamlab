import { describe, expect, it } from "vitest"
import { execute, hasAccess, mergeMessages } from "../src/lib/domain"
import { createState } from "../src/lib/seed"

describe("commercial contracts", () => {
  it("grants membership once and revokes access on refund", () => {
    const state = createState()
    const action = {
      type: "purchase",
      userId: "viewer",
      channelId: "mei",
      product: "membership",
      key: "once",
    }
    execute(state, action, 1000)
    execute(state, action, 1000)
    expect(state.orders).toHaveLength(1)
    expect(hasAccess(state, "viewer", "mei", "member", 2000)).toBe(true)
    execute(
      state,
      { type: "refund", userId: "viewer", orderId: state.orders[0].id },
      2000,
    )
    expect(hasAccess(state, "viewer", "mei", "member", 3000)).toBe(false)
  })
  it("never spends more credits than available, including invalid amounts", () => {
    const state = createState()
    expect(() =>
      execute(state, {
        type: "gift",
        userId: "viewer",
        channelId: "mei",
        amount: 99999,
        key: "g1",
      }),
    ).toThrow()
    expect(() =>
      execute(state, {
        type: "gift",
        userId: "viewer",
        channelId: "mei",
        amount: -1,
        key: "g2",
      }),
    ).toThrow()
    expect(state.users[0].credits).toBe(500)
  })
  it("cancellation preserves paid access until expiration", () => {
    const state = createState()
    execute(
      state,
      {
        type: "purchase",
        userId: "viewer",
        channelId: "mei",
        product: "membership",
        key: "m1",
      },
      1000,
    )
    execute(
      state,
      { type: "cancelMembership", userId: "viewer", channelId: "mei" },
      1500,
    )
    expect(hasAccess(state, "viewer", "mei", "member", 2000)).toBe(true)
    expect(
      hasAccess(state, "viewer", "mei", "member", 1000 + 31 * 86400000),
    ).toBe(false)
  })
  it("rejects untrusted products, refunds and room mutations", () => {
    const state = createState()
    expect(() =>
      execute(state, {
        type: "purchase",
        userId: "viewer",
        channelId: "mei",
        product: "arbitrary",
        key: "x",
      }),
    ).toThrow()
    expect(() =>
      execute(state, {
        type: "updateRoom",
        userId: "viewer",
        channelId: "mei",
        title: "hacked",
      }),
    ).toThrow()
  })
  it("deduplicates and bounds replayed messages while preserving ordering", () => {
    const messages = Array.from({ length: 700 }, (_, i) => ({
      id: `m${i}`,
      roomId: "mei",
      seq: i,
      userId: "viewer",
      name: "Alex",
      text: "hello",
      time: i,
    }))
    const result = mergeMessages(
      messages.slice(0, 500),
      messages.slice(250).reverse(),
    )
    expect(result).toHaveLength(500)
    expect(result[0].seq).toBe(200)
    expect(result[499].seq).toBe(699)
  })
})

it("preserves a purchased scheduled ticket when the session starts", () => {
  const s = createState()
  execute(
    s,
    {
      type: "updateRoom",
      userId: "creator",
      channelId: "mei",
      scheduledAt: 2000,
      access: "ticket",
    },
    1000,
  )
  execute(
    s,
    {
      type: "purchase",
      userId: "viewer",
      channelId: "mei",
      product: "ticket",
      key: "presale",
    },
    1000,
  )
  expect(hasAccess(s, "viewer", "mei", "ticket", 1000)).toBe(true)
  execute(s, { type: "start", userId: "creator", channelId: "mei" }, 2000)
  expect(hasAccess(s, "viewer", "mei", "ticket", 2000)).toBe(true)
})
