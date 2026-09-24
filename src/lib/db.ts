/** 持久化入口：同一事务内读、校验、修改、保存，事务提交后才通知其他标签页。 */
import { execute } from "./domain"
import { createState } from "./seed"
import type { Action, State } from "./types"

let connection: Promise<IDBDatabase> | undefined
// 模块级 Promise 复用数据库连接；数据库版本 1 只建立 state store，main 键存完整演示快照。
function database() {
  connection ??= new Promise((resolve, reject) => {
    const r = indexedDB.open("streamlab-demo", 1)
    r.onupgradeneeded = () => r.result.createObjectStore("state")
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
  return connection
}
export async function readState(): Promise<State> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readonly")
    const request = tx.objectStore("state").get("main")
    request.onsuccess = () => resolve(request.result ?? createState())
    request.onerror = () => reject(request.error)
  })
}
export async function mutate(action: Action): Promise<unknown> {
  const db = await database()
  return new Promise((resolve, reject) => {
    // ponytail: one bounded state snapshot; split object stores when this grows beyond a local demo.
    const tx = db.transaction("state", "readwrite"),
      store = tx.objectStore("state"),
      request = store.get("main")
    let result: unknown
    // 此回调内不 await 网络请求，避免 IndexedDB 事务在等待期间自动结束。
    // execute 修改的是事务读出的快照；任一校验抛错时 abort，后续 readState 看不到部分写入。
    request.onsuccess = () => {
      try {
        const state: State = request.result ?? createState()
        result = execute(state, action)
        store.put(state, "main")
      } catch (error) {
        tx.abort()
        reject(error)
      }
    }
    // request 成功不等于事务提交；必须等 oncomplete 才广播，其他标签才能读到已提交数据。
    tx.oncomplete = () => {
      const bus = new BroadcastChannel("streamlab-state")
      bus.postMessage({ type: action.type })
      bus.close()
      resolve(result)
    }
    tx.onerror = () => reject(tx.error)
  })
}
export async function resetState() {
  const db = await database()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("state", "readwrite")
    tx.objectStore("state").put(createState(), "main")
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  const bus = new BroadcastChannel("streamlab-state")
  bus.postMessage({ type: "reset" })
  bus.close()
}
