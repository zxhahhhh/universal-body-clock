// 距离四档：靠近、隔布、贴肤、走开。走开不是一档，是回零。
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 每个测试各用一个临时账本，绝不碰真实的那一个文件。
process.env.BODY_CLOCK_STATE = join(tmpdir(), 'body-clock-distance.json')
const { __test } = await import('../index.js')

const { blankState, advance } = __test

let t = Date.now()
const s = blankState()

// 靠近：没碰着，场里只算一点点。
s.distance = '靠近'
s.distAt = t
t += 1000
advance(s, t)
console.log('靠近 →', s.distance, '（应 靠近）')

// 隔布：隔着料子，比靠近近一档。
s.distance = '隔布'
s.distAt = t
t += 1000
advance(s, t)
console.log('隔布 →', s.distance, '（应 隔布）')

// 贴肤：贴上了，十五分钟没人续就自己退。
s.distance = '贴肤'
s.distAt = t
t += 1000
advance(s, t)
console.log('贴肤 →', s.distance, '（应 贴肤）')

// 十六分钟没人续，自己退一档。
t += 16 * 60 * 1000
advance(s, t)
console.log('十六分钟 →', s.distance, '（应 隔布）')

// 再过一个钟头，退到靠近。
t += 60 * 60 * 1000
advance(s, t)
console.log('又过一小时 →', s.distance, '（应 靠近）')

// 再三个钟头，算走了。
t += 3 * 3600 * 1000
advance(s, t)
console.log('再三小时 →', s.distance, '（应 隐没）')

// 走开是直接回零，不占一档。
s.distance = '贴肤'
s.distAt = t
t += 1000
advance(s, t)
s.distance = '隐没'
s.distAt = t
t += 1000
advance(s, t)
console.log('走开 →', s.distance, '（应 隐没）')

console.log('[done]')