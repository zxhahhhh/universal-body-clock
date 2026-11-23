// 三道闸的实测：一天涨不过四十、到底留十、睡一觉砍一半；还有欲望给的上限。
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 每个测试各用一个临时账本，绝不碰真实的那一个文件。
process.env.BODY_CLOCK_STATE = join(tmpdir(), 'body-clock-gates.json')
const { __test } = await import('../index.js')

const { load, blankState, advance, desireCap } = __test
const H = 3600 * 1000
const pad = (s) => String(Math.round(s * 10) / 10)

// 1. 夜切：隔 12 小时没推进，按睡了一觉算，砍一半。
const s1 = load()
s1.libido = 90
s1.at = Date.now() - 12 * H
advance(s1, Date.now())
console.log(`夜切 90 / 12h → ${pad(s1.libido)}（应 45）`)

// 2. 日涨上限：今天只剩 1 点额度，漂 2 小时也只涨 1 点。
const s2 = load()
s2.libido = 20
s2.gainToday = 39
s2.gainDay = new Date().toISOString().slice(0, 10)
s2.peakAt = 0
s2.at = Date.now() - 2 * H
advance(s2, Date.now())
console.log(`额度剩 1 / 2h：20 → ${pad(s2.libido)}（涨 1 落 6.4，应 14.6）gainToday ${pad(s2.gainToday)}`)

// 3. 地板：12 漂 3 小时，算下来 3.9，压到 10。
const s3 = load()
s3.libido = 12
s3.gainToday = 0
s3.gainDay = ''
s3.peakAt = 0
s3.at = Date.now() - 3 * H
advance(s3, Date.now())
console.log(`地板 12 / 3h → ${pad(s3.libido)}（应为 10）`)

// 4. 欲望给八维的上限：越低越只能动一点，越高越放得开。
const s4 = blankState()
const caps = [20, 50, 70, 85, 95].map((lib) => {
  s4.libido = lib
  return `${lib}→${desireCap(s4)}`
})
console.log('欲望 → 一次能动几维：', caps.join('  '), '（应 0/1/2/3/4）')

console.log('[done]')