// 注入节流：同一回合里身子没动，就别把整块发第二遍。
// 但每一回合都总要有一份身子在眼前——所以没动的那一步给一行。

import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const STATE = join(tmpdir(), 'universal-inject.json')
process.env.BODY_CLOCK_STATE = STATE
const { __test } = await import('../index.js')
const { blankState, injectText, movedSig, FULL_EVERY_MS, touch } = __test

let bad = 0
function check(name, ok, extra) {
  if (!ok) {
    bad += 1
    console.log(`[FAIL] ${name}`)
    if (extra !== undefined) console.log(`       ${String(extra).slice(0, 240)}`)
  } else {
    console.log(`[ok] ${name}`)
  }
}

rmSync(STATE, { force: true })

const state = blankState()
const memo = { sig: '', fullAt: 0 }
const t0 = Date.now()

const first = injectText(state, memo, t0)
check('第一步给整块', first.split('\n').length >= 4 && first.includes('八维'), first)
check('整块里带指路句', first.includes('碰完它会回你数'), first)

const second = injectText(state, memo, t0 + 2000)
check('第二步身子没动只给一行', second.split('\n').length === 1, second)
check('这一行说没动', second.includes('没动') && second.includes('欲望'), second)
check('这一行带时间', /^\[身体\] \d{2}:\d{2} /.test(second), second)

const third = injectText(state, memo, t0 + 5000)
check('第三步还是一行', third.split('\n').length === 1, third)

const later = injectText(state, memo, t0 + FULL_EVERY_MS + 1000)
check('隔了三分钟重发整块', later.split('\n').length >= 4 && later.includes('八维'), later)

const beforeTouch = movedSig(state)
touch(state, { zone: 'hand', action: '贴', strength: '中' })
check('碰过之后指纹变了', movedSig(state) !== beforeTouch)
const afterTouch = injectText(state, memo, t0 + FULL_EVERY_MS + 2000)
check('动过之后马上给整块', afterTouch.split('\n').length >= 4, afterTouch)
check('整块里有碰过的那一格', afterTouch.includes('格子'), afterTouch)

const off = blankState()
off.enabled = false
const offLine = injectText(off, { sig: '', fullAt: 0 }, t0)
check('关掉了就不注入', offLine === '', JSON.stringify(offLine))

const drift = blankState()
const driftMemo = { sig: '', fullAt: 0 }
injectText(drift, driftMemo, t0)
drift.zones.hand.temp = 0.4
const sigA = movedSig(drift)
drift.zones.hand.temp = 0.2
check('温走半度以里不算动', movedSig(drift) === sigA)
drift.zones.hand.temp = 0.9
check('温走够了才算动', movedSig(drift) !== sigA)

rmSync(STATE, { force: true })

if (bad) {
  console.log(`\n${bad} 项没过`)
  process.exit(1)
}
console.log('\n全过')