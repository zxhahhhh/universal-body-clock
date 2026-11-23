// 账本被写坏的时候，能不能自己夹回来。
// 手改的、旧版本留下的、外面塞进来的，读一次、走一步都该过一道夹。
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeFileSync, rmSync } from 'node:fs'

process.env.BODY_CLOCK_STATE = join(tmpdir(), 'body-clock-clamp.json')

const { __test } = await import('../index.js')
const { load, save, advance, blankState, clampState, senseText, config } = __test
const CFG = config()
const FLOOR = Number(CFG.libido?.floor) || 10

let bad = 0
const check = (name, ok, extra = '') => {
  if (!ok) bad += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`)
}

const now = () => Date.now()

// 一、手写一份越界的账，直接落盘，再读回来
const dirty = blankState()
dirty.at = now()
dirty.libido = 0
dirty.dims['敏感'] = 240
dirty.dims['亲密'] = -30
dirty.zones.hand.press = 500
dirty.zones.hand.flush = -80
dirty.zones.hand.temp = 9
dirty.emotion.kinds.joy = 500
dirty.emotion.debt = -5
save(dirty)

const back = load()
check('读回来欲望不低于地板', back.libido >= FLOOR && back.libido <= 100, String(back.libido))
check('八维封在零到一百', back.dims['敏感'] === 100 && back.dims['亲密'] === 0, `${back.dims['敏感']} / ${back.dims['亲密']}`)
check('十二格封在零到一百', back.zones.hand.press === 100 && back.zones.hand.flush === 0, `${back.zones.hand.press} / ${back.zones.hand.flush}`)
check('温度封在正负三', Math.abs(back.zones.hand.temp) <= 3, String(back.zones.hand.temp))
check('情绪封在零到一百', back.emotion.kinds.joy === 100, String(back.emotion.kinds.joy))
check('债不出界', back.emotion.debt === 0, String(back.emotion.debt))
check('主体槽位只有一个值', back.subject === 'self', String(back.subject))

// 二、没有时间差也要夹——早退之前就得夹
const noGap = blankState()
noGap.at = now()
noGap.libido = 0
advance(noGap, now())
check('没有时间差也夹回地板', noGap.libido >= FLOOR, String(noGap.libido))

// 三、正常值一个都不碰
const clean = blankState()
const before = JSON.stringify(clean)
clampState(clean)
check('正常账本夹完一模一样', JSON.stringify(clean) === before)

// 四、越界账过一遍之后注入不崩
const text = senseText(back)
check('夹完读得出注入', typeof text === 'string' && text.length > 0 && !/NaN|undefined/.test(text))

// 五、读坏的文件也得是一份夹过的干净身子
writeFileSync(process.env.BODY_CLOCK_STATE, '{ 这不是 json', 'utf8')
const fromBroken = load()
check('坏文件兜底也带版本号', fromBroken.v === 2, String(fromBroken.v))
check('坏文件兜底欲望在范围内', fromBroken.libido >= FLOOR && fromBroken.libido <= 100, String(fromBroken.libido))

try { rmSync(process.env.BODY_CLOCK_STATE, { force: true }) } catch { /* 临时账本，删不掉无所谓 */ }
console.log(bad ? `\n${bad} 条没过` : '\n全过')
process.exit(bad ? 1 : 0)