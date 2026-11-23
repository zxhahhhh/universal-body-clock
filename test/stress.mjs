// 压力测试：随便砸。跑完之后看它有没有破顶、跌穿、出 NaN、把账写坏。
// 不在真实账本上跑——临时文件。
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeFileSync, readFileSync } from 'node:fs'

const STATE = join(tmpdir(), 'body-clock-stress.json')
process.env.BODY_CLOCK_STATE = STATE

const { __test } = await import('../index.js')
const {
  blankState, advance, touch, feel, senseText, snapshot, save, load,
  config, sceneOf, view, emptyOf, setDims, shiftDims, DIM_ORDER,
} = __test

const ZONES = ['face', 'mouth', 'neck', 'chest', 'waist', 'belly', 'hip', 'hand', 'leg', 'foot']
const ACTIONS = ['按', '压', '捏', '掐', '咬', '拍', '打', '弹', '扇', '揉', '擦', '蹭', '搓', '贴', '吹', '舔']
const KINDS = ['joy', 'anger', 'sadness', 'fear', 'surprise', 'disgust']
const STRENGTHS = ['轻', '中', '重']
const SPEEDS = ['慢', '中', '快']
const DISTS = ['隐没', '靠近', '隔布', '贴肤']
const SCENES = ['平静', '微动', '强烈']

let bad = 0
const fail = (name, detail) => { bad++; console.log(`  [x] ${name}  ${detail ?? ''}`) }
const check = (name, ok, detail) => { if (!ok) fail(name, detail) }

const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)]
// 线性同余，跑两次结果一样，出问题好复现。
let seed = 20261123
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const ri = (n) => Math.floor(rnd() * n)

/** 深扫：NaN、Infinity、undefined 一律算坏。 */
function scan(obj, path = 'state', out = []) {
  if (obj === null || obj === undefined) return out
  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) out.push(`${path}=${obj}`)
    return out
  }
  if (typeof obj !== 'object') return out
  if (Array.isArray(obj)) { obj.forEach((v, i) => scan(v, `${path}[${i}]`, out)); return out }
  for (const [k, v] of Object.entries(obj)) scan(v, `${path}.${k}`, out)
  return out
}

let maxTemp = 0
function invariants(s, tag) {
  const nan = scan(s)
  if (nan.length) { fail(`${tag} 有非有限数`, nan.slice(0, 3).join(' ')); return false }

  const FLOOR = Number(config().libido?.floor) || 10
  if (!(s.libido >= FLOOR - 1e-6 && s.libido <= 100 + 1e-6)) fail(`${tag} 欲望越界`, s.libido)
  if (s.subject !== 'self') fail(`${tag} 主体不对`, s.subject)
  if (!DISTS.includes(s.distance)) fail(`${tag} 距离不对`, s.distance)
  if ('face' in s || 'tail' in s || 'mark' in s) fail(`${tag} 旧版字段回来了`)

  for (const k of DIM_ORDER) {
    const v = s.dims[k]
    if (!(v >= -1e-6 && v <= 100 + 1e-6)) fail(`${tag} 八维越界`, `${k}=${v}`)
  }
  for (const id of ZONES) {
    const z = s.zones[id]
    if (!z) { fail(`${tag} 缺格`, id); continue }
    for (const k of ['press', 'flush']) {
      if (!(z[k] >= -1e-6 && z[k] <= 100 + 1e-6)) fail(`${tag} ${k} 越界`, `${id}=${z[k]}`)
    }
    maxTemp = Math.max(maxTemp, Math.abs(z.temp))
    if (Math.abs(z.temp) > 3) fail(`${tag} 温度跑飞`, `${id}=${z.temp}`)
  }
  for (const [k, v] of Object.entries(s.emotion?.kinds ?? {})) {
    if (!(v >= -1e-6 && v <= 100 + 1e-6)) fail(`${tag} 六格越界`, `${k}=${v}`)
  }
  if (!((s.emotion?.events?.length ?? 0) <= 2)) fail(`${tag} 事件超过两条`, s.emotion.events.length)
  if (!(s.emotion?.debt >= -1e-6 && s.emotion?.debt <= 100 + 1e-6)) fail(`${tag} 债越界`, s.emotion?.debt)

  // 账本能存能读：到这儿坏了，重启就丢身体。
  let round = null
  try { round = JSON.parse(JSON.stringify(s)) } catch { fail(`${tag} 存不下`) }
  if (round && JSON.stringify(round) !== JSON.stringify(s)) fail(`${tag} 存读不一致`)

  // 注入不能崩，也不能把脏数漏出去。
  try {
    const txt = senseText(s)
    if (typeof txt !== 'string') fail(`${tag} 注入不是字符串`)
    else {
      if (/NaN|undefined|Infinity/.test(txt)) fail(`${tag} 注入漏了脏数`, txt.slice(0, 60))
      const lines = txt.split('\n').filter(Boolean)
      if (lines.length > 8) fail(`${tag} 注入行数超了`, lines.length)
    }
    const sc = sceneOf(s)
    if (!SCENES.includes(sc.word)) fail(`${tag} 场不对`, sc.word)
    const v = view(s)
    if (!v || !v.emotion || !v.dims || v.dims.length !== 8) fail(`${tag} view 不齐`)
    snapshot(s)
  } catch (e) {
    fail(`${tag} 读出崩了`, e.message)
  }
  return true
}

function fresh() {
  const s = blankState()
  s.at = Date.now()
  return s
}

/** 走一步虚拟时间。 */
function step(s, ms) {
  const t = (s.at ?? Date.now()) + ms
  return advance(s, t)
}

// ── 1. 乱砸：三万步 ─────────────────────────────────────────
{
  console.log('=== 1. 随机乱砸 30000 步 ===')
  let s = fresh()
  let broke = false
  for (let i = 0; i < 30000; i++) {
    const r = ri(100)
    if (r < 8) step(s, ri(4000))
    else if (r < 14) step(s, ri(3600 * 30) + 1000)
    else if (r < 60) {
      const res = touch(s, {
        zone: pick(ZONES, rnd), action: pick(ACTIONS, rnd),
        strength: pick(STRENGTHS, rnd), speed: pick(SPEEDS, rnd),
        durationSec: ri(20),
      })
      if (res && res.error) fail('碰不动的格', res.error)
    }
    else if (r < 72) feel(s, { kind: pick(KINDS, rnd), intensity: ri(101), why: '压测' })
    else if (r < 80) {
      const e = pick(['靠近', '隔布', '贴肤', '走开'], rnd)
      s.distance = e === '走开' ? '隐没' : e
      s.distAt = s.at
      if (e === '走开') s.awayAt = s.at
      else if (s.awayAt) s.awayAt = 0
      advance(s, s.at)
    }
    else if (r < 88) {
      // 八维只剩一层，值随便砸。
      const k = pick(DIM_ORDER, rnd)
      setDims(s, { [k]: ri(101) }, 'fuzz')
    }
    else if (r < 92) {
      // 欲望总闸随便开合，看它自己收。
      s.libido = ri(101)
      advance(s, s.at + 1000)
    }
    else if (r < 95) {
      // 极端时间：往前十年、往回十天、原地不动
      const kind = ri(3)
      if (kind === 0) advance(s, s.at + 3650 * 86400000)
      else if (kind === 1) advance(s, s.at - 10 * 86400000)
      else advance(s, s.at)
    }
    else if (r < 97) {
      s.libido = rnd() < 0.5 ? 0 : 100
      // 手改账本之后给引擎一秒钟，看它有没有把越界的数拉回来。
      // 不给这一下，查到的「欲望 0」是外面写进去的，不是引擎漏的。
      advance(s, s.at + 1000)
    }
    else {
      shiftDims(s, { 敏感: -80, 羞: -80 }, 'fuzz', { limit: false })
    }

    if (!invariants(s, `第 ${i} 步`)) { broke = true; break }
  }
  if (!broke) console.log(`  ok，温度最大偏移 ${maxTemp.toFixed(2)}`)
}

// ── 2. 破顶 ────────────────────────────────────────────────
{
  console.log('=== 2. 往死里碰（同一格两千下） ===')
  let s = fresh()
  s.distance = '贴肤'
  s.distAt = s.at
  for (let i = 0; i < 2000; i++) {
    touch(s, { zone: 'waist', action: '掐', strength: '重', speed: '快', durationSec: 30 })
    invariants(s, `饱和 ${i}`)
  }
  check('压痕封在 100', s.zones.waist.press <= 100 && s.zones.waist.press >= 0, s.zones.waist.press)
  check('红封在 100', s.zones.waist.flush <= 100, s.zones.waist.flush)
  check('欲望没超 100', s.libido <= 100, s.libido)
  check('敏感没超 95', s.dims['敏感'] <= 95.0001, s.dims['敏感'])
  console.log(`  ok，压 ${s.zones.waist.press} 红 ${s.zones.waist.flush} 欲望 ${s.libido.toFixed(1)} 敏感 ${s.dims['敏感']}`)
}

// ── 3. 欲望两端 ────────────────────────────────────────────
{
  console.log('=== 3. 欲望封顶与地板 ===')
  let s = fresh()
  s.libido = 99.99
  for (let i = 0; i < 200; i++) { step(s, 60000); invariants(s, '封顶') }
  check('不会越过一百', s.libido <= 100, s.libido)

  let d = fresh()
  d.libido = 10.2
  d.at = Date.now() - 6 * 3600 * 1000
  d.awayAt = Date.now() - 6 * 3600 * 1000
  d.distance = '隐没'
  for (let i = 0; i < 200; i++) { step(d, 3600 * 1000); invariants(d, '地板') }
  const FLOOR = Number(config().libido?.floor) || 10
  check('不会跌穿地板', d.libido >= FLOOR - 0.001, d.libido)
  console.log(`  ok，欲望 ${s.libido.toFixed(1)} / ${d.libido.toFixed(1)}`)
}

// ── 4. 八维两端 ────────────────────────────────────────────
{
  console.log('=== 4. 八维跌穿与破顶 ===')
  let s = fresh()
  shiftDims(s, { 亲密: -500, 敏感: -500, 羞: -500 }, 'stress', { limit: false })
  shiftDims(s, { 亲密: 500, 敏感: 500, 羞: 500 }, 'stress', { limit: false })
  invariants(s, '八维')
  for (const [k, v] of Object.entries(s.dims)) {
    check(`八维 ${k} 在 0..100`, v >= 0 && v <= 100, v)
  }
  console.log(`  ok，${Object.entries(s.dims).map(([k, v]) => `${k}${v}`).join(' ')}`)
}

// ── 5. 时间失控 ────────────────────────────────────────────
{
  console.log('=== 5. 时间失控 ===')
  const cases = [3650 * 86400000, 86400000, 7 * 86400000, 6 * 3600 * 1000 + 1]
  for (const ms of cases) {
    const s = fresh()
    s.libido = 80
    advance(s, s.at + ms)
    invariants(s, `跳 ${ms}`)
    check(`跳 ${Math.round(ms / 3600000)} 小时不越界`, s.libido <= 100 && s.libido >= 10, s.libido)
  }
  // 回拨
  const back = fresh()
  back.libido = 55
  const before = JSON.stringify(back.zones)
  advance(back, back.at - 30 * 86400000)
  check('时间回拨不崩', true)
  check('时间回拨不动身体', JSON.stringify(back.zones) === before)
  console.log('  ok')
}

// ── 6. 空着与敏感封顶 ──────────────────────────────────────
{
  console.log('=== 6. 空着自热封顶 ===')
  const s = fresh()
  s.libido = 95
  s.dims['敏感'] = 94
  s.lastAnyTouch = Date.now() - 3 * 86400 * 1000
  s.at = Date.now() - 3 * 86400 * 1000
  for (let i = 0; i < 120; i++) { step(s, 3600 * 1000); invariants(s, '空着') }
  check('敏感封在 95', s.dims['敏感'] <= 95.0001, s.dims['敏感'])
  check('羞没跌穿', s.dims['羞'] >= 0, s.dims['羞'])
  check('温度自热封住', Math.abs(s.zones.belly.temp) <= 3, s.zones.belly.temp)
  console.log(`  ok，敏感 ${s.dims['敏感'].toFixed(1)} 羞 ${s.dims['羞'].toFixed(1)} 腹温 ${s.zones.belly.temp.toFixed(2)}`)
}

// ── 7. 情绪堆叠 ────────────────────────────────────────────
{
  console.log('=== 7. 情绪堆叠 ===')
  const s = fresh()
  for (let i = 0; i < 200; i++) {
    feel(s, { kind: pick(KINDS, rnd), intensity: 100, why: '压测' })
    invariants(s, `情绪 ${i}`)
  }
  check('事件最多两条', s.emotion.events.length <= 2, s.emotion.events.length)
  check('债封在 100', s.emotion.debt <= 100, s.emotion.debt)
  for (const [k, v] of Object.entries(s.emotion.kinds)) check(`六格 ${k} 封住`, v <= 100, v)
  const peak = __test.remainingPeak(s.emotion)
  check('最狠不超过一百', peak <= 100.0001, peak)
  console.log(`  ok，最狠 ${peak.toFixed(1)} 债 ${s.emotion.debt}`)
}

// ── 8. 距离来回磨 ──────────────────────────────────────────
{
  console.log('=== 8. 距离来回磨 ===')
  const s = fresh()
  for (let i = 0; i < 300; i++) {
    s.distance = pick(DISTS, rnd)
    s.distAt = s.at
    step(s, ri(600000))
    invariants(s, `距离 ${i}`)
  }
  console.log(`  ok，场现在 ${sceneOf(s).word}`)
}

// ── 9. 格子来回磨 ──────────────────────────────────────────
{
  console.log('=== 9. 十二格来回磨 ===')
  const s = fresh()
  for (let i = 0; i < 300; i++) {
    const id = pick(ZONES, rnd)
    touch(s, {
      zone: id, action: pick(ACTIONS, rnd),
      strength: pick(STRENGTHS, rnd), speed: pick(SPEEDS, rnd),
      durationSec: ri(30),
    })
    step(s, ri(5000))
    invariants(s, `磨格 ${i}`)
  }
  console.log('  ok')
}

// ── 10. 存读与旧字段 ───────────────────────────────────────
{
  console.log('=== 10. 存读与旧字段清理 ===')
  const s = fresh()
  s.libido = 44
  touch(s, { zone: 'chest', action: '揉', strength: '中', speed: '慢', durationSec: 6 })
  const afterTouch = s.libido
  save(s)
  const back = load()
  check('存了能读', Math.abs(back.libido - afterTouch) < 0.0001, `${back.libido} vs ${afterTouch}`)
  check('读回来是同一版', back.v === s.v, `${back.v} vs ${s.v}`)
  invariants(back, '存读')

  // 旧版字段：个人版那套 face／tail／mark／prevFace 还在文件里，读的时候该被丢掉。
  const old = JSON.parse(readFileSync(STATE, 'utf8'))
  old.face = 'fu'
  old.prevFace = 'xi'
  old.swapAt = Date.now()
  old.tail = { mode: '轻晃' }
  old.mark = { level: 2, thread: 0.4 }
  writeFileSync(STATE, JSON.stringify(old))
  const mig = load()
  check('版本还是 2', mig.v === 2, mig.v)
  check('旧字段被搬掉', !('face' in mig) && !('tail' in mig) && !('mark' in mig) && !('prevFace' in mig), JSON.stringify(Object.keys(mig)))
  check('老账本能读', typeof senseText(mig) === 'string')
  invariants(mig, '清旧字段')

  // 坏文件：写半截进去
  writeFileSync(STATE, '{"v":1,"libido":')
  const broken = load()
  check('坏账本不崩', broken && broken.v === 2, broken?.v)
  invariants(broken, '坏账本')

  // 未来版本：只读不覆盖
  writeFileSync(STATE, JSON.stringify({ v: 99, libido: 1 }))
  const future = load()
  check('未来版本不覆盖', future && future.libido !== 1, future?.libido)
  console.log('  ok')
}

console.log(bad ? `[失败] ${bad} 项` : '[done] 全过')
if (bad) process.exitCode = 1