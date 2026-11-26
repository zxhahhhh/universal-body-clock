/**
 * 1.7.0 八维慢回气：一天没推到顶，往中性退一点；当日涨幅有封顶。
 * 不是把性格磨平——退得比涨慢，一场事还是能把它推上去。
 */
import { __test as T } from '../index.js'

let failed = 0
const ok = (c, msg, extra = '') => {
  if (!c) { failed += 1; console.error(`FAIL  ${msg}${extra ? '  ' + extra : ''}`) } else console.log(`ok    ${msg}${extra ? '  ' + extra : ''}`)
}
const now = () => Date.now()

function fresh() {
  const s = T.blankState()
  s.at = now() - 1000
  s.lastAnyMessageAt = now()  // 不触发「久没人理」
  return s
}

// 慢回气：一小时退零点三五，两小时退零点七
{
  const s = fresh()
  s.dims['亲密'] = 100
  s.dims['信任'] = 90
  s.dims['放松'] = 20
  T.advance(s, now() + 2 * 3600 * 1000)
  ok(Math.abs(s.dims['亲密'] - 99.3) < 0.11, '亲密从一百退到九十九点三', String(s.dims['亲密']))
  ok(Math.abs(s.dims['信任'] - 89.3) < 0.11, '信任从九十退到八十九点三', String(s.dims['信任']))
  ok(Math.abs(s.dims['放松'] - 20.7) < 0.11, '放松从二十往五十走', String(s.dims['放松']))
}

// 当日封顶：一天最多加十二
{
  const s = fresh()
  s.dims['亲密'] = 50
  T.shiftDims(s, { 亲密: 5 }, 'test')
  T.shiftDims(s, { 亲密: 5 }, 'test')
  T.shiftDims(s, { 亲密: 5 }, 'test')
  ok(s.dims['亲密'] === 62, '三次一共只加十二', String(s.dims['亲密']))
  ok(Math.abs(Number(s.dimsGain.bag['亲密']) - 12) < 0.01, '涨幅账记到十二', JSON.stringify(s.dimsGain))
  // 换一天重新记
  s.dimsGain.day = '2000-01-01'
  T.shiftDims(s, { 亲密: 1 }, 'test')
  ok(s.dims['亲密'] === 63, '新的一天还能加', String(s.dims['亲密']))
}

// 往下退不占额度
{
  const s = fresh()
  s.dims['亲密'] = 80
  T.shiftDims(s, { 亲密: -10 }, 'test')
  ok(s.dims['亲密'] === 70, '往下不封', String(s.dims['亲密']))
  ok((Number(s.dimsGain.bag['亲密']) || 0) === 0, '额度没动', JSON.stringify(s.dimsGain))
}

if (failed) { console.error(`[失败] ${failed} 项`); process.exitCode = 1 } else console.log('全过')
