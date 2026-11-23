/**
 * 冒烟测试：把最小版真的跑一遍，看数怎么走。
 * 用临时账本跑，全程不碰真实的那一个文件。
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const STATE = join(tmpdir(), 'body-clock-smoke.json')
process.env.BODY_CLOCK_STATE = STATE
const { __test } = await import('../index.js')

const { load, save, advance, touch, senseText, snapshot } = __test

const show = (label, r) => {
  if (r && r.error) { console.log(`${label}  ERROR ${r.error}`); return }
  console.log(
    `${label}  ${r.name} ${r.action}  press ${r.pressBefore}->${r.press}  flush ${r.flush}  temp ${r.temp}  shock ${r.shock}  libido ${r.libido}`,
  )
  console.log(`        ${r.line}${r.dir ? ' / ' + r.dir : ''}`)
}

function fresh() {
  const s = load()
  for (const id of Object.keys(s.zones)) {
    Object.assign(s.zones[id], {
      press: 0, flush: 0, temp: 0, flushRate: 1, shock: 0, shockSec: 90,
      afterUntil: 0, after: '', lastTouch: 0,
    })
  }
  s.libido = 12
  s.peakAt = 0
  s.distance = '隐没'
  return s
}

console.log('=== 1. blank ===')
let s = fresh()
save(s)
console.log(senseText(load()))

console.log('\n=== 2. same spot x3 (should saturate) ===')
s = fresh(); save(s)
for (let i = 1; i <= 3; i++) show(`waist#${i}`, touch(load(), { zone: 'waist', action: '按', strength: '重' }))

console.log('\n=== 3. fast forward 5min ===')
s = load()
s.at = Date.now() - 5 * 60 * 1000
advance(s, Date.now())
save(s)
const z = snapshot(s).zones.find(x => x.id === 'waist')
console.log(`waist after 5min: press ${z.press}  flush ${z.flush}  temp ${z.temp}`)

console.log('\n=== 4. neck / foot ===')
s = fresh(); save(s)
show('neck/吹', touch(load(), { zone: 'neck', action: '吹', strength: '轻' }))
s = load()
show('foot/重', touch(s, { zone: 'foot', action: '压', strength: '重' }))

console.log('\n=== 5. 四族的差别（腰，中力）===')
for (const action of ['按', '拍', '揉', '贴', '吹']) {
  s = fresh(); save(s)
  show(`腰/${action}`, touch(load(), { zone: 'waist', action, strength: '中' }))
}

console.log('\n=== 5b. 方向 ===')
s = fresh(); save(s)
show('腰/往下', touch(load(), { zone: 'waist', action: '按', strength: '中', direction: '下' }))

console.log('\n=== 6. 敏感高的一副身子 ===')
s = fresh(); s.dims['敏感'] = 80; save(s)
show('hand/按', touch(load(), { zone: 'hand', action: '按', strength: '中' }))

console.log('\n=== 7. libido clamp ===')
s = fresh(); s.libido = 99.5; save(s)
show('climb', touch(load(), { zone: 'chest', action: '揉', strength: '重', durationSec: 20 }))
console.log(`  libido now ${Math.round(load().libido)}, peakAt set: ${!!load().peakAt}`)

const walk = (mins) => {
  const s0 = load()
  s0.at = Date.now() - mins * 60 * 1000
  if (s0.peakAt) s0.peakAt -= mins * 60 * 1000
  advance(s0, Date.now())
  save(s0)
  return Math.round(s0.libido)
}
console.log(`  +20min ${walk(20)}   +60min ${walk(60)}   +180min ${walk(180)}`)

console.log('\n=== 8. sense ===')
console.log(senseText(load()))
console.log('[done]')