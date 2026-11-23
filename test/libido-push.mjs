/**
 * 总闸过线推敏感：分档涨、快到顶有顶、落回去自己退。
 * 这三样缺一样都不行——只涨不退，敏感就是一个只能升的数。
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.BODY_CLOCK_STATE = join(tmpdir(), 'body-clock-libido-push.json')
const { __test } = await import('../index.js')

const { blankState, advance } = __test
const H = 3600 * 1000
const round1 = (v) => Math.round(Number(v) * 10) / 10

// 1. 三条档各自涨多快：总闸那条 0.6 / 1.2 / 2.0，空着那条另外再叠 0.6
for (const lib of [65, 85, 95]) {
  const s = blankState()
  const start = Number(s.dims['敏感'])
  s.libido = lib
  s.at = Date.now() - H
  advance(s, Date.now())
  console.log(`总闸 ${lib} / 1h　敏感 ${round1(start)} → ${round1(s.dims['敏感'])}`, '（应 0.6 / 1.2 / 2.0 再加空着那条 0.6）')
}

// 2. 快到顶有顶：敏感 94.9、总闸 99 跑一小时，最多到 95
{
  const s = blankState()
  s.dims['敏感'] = 94.9
  s.libido = 99
  s.at = Date.now() - H
  advance(s, Date.now())
  console.log('敏感 94.9 / 总闸 99 / 1h →', round1(s.dims['敏感']), '（应封在 95，不许推满）')
}

// 3. 总闸落回线下，敏感自己退：一小时 0.15
{
  const s = blankState()
  s.dims['敏感'] = 60
  s.libido = 30
  s.at = Date.now() - 2 * H
  advance(s, Date.now())
  console.log('总闸 30 / 敏感 60 / 2h →', round1(s.dims['敏感']), '（应退到 59.7）')
}

// 4. 线以下只有敏感退：两小时 0.3，别的维不动
{
  const s = blankState()
  const before = JSON.parse(JSON.stringify(s.dims))
  s.libido = 20
  s.at = Date.now() - 2 * H
  advance(s, Date.now())
  const after = s.dims
  const moved = Object.keys(after).filter((k) => after[k] !== before[k])
  console.log('总闸 20 / 2h 后动过的维：', moved.join(',') || '无', '敏感', round1(before['敏感']), '→', round1(after['敏感']), '（应只退敏感）')
}

console.log('[done]')