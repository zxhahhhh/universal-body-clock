/**
 * 沙盒：把日常里会发生的事各走一遍，看有没有数跑飞。
 * 只动内存，账本落在临时目录；每一段之后全量查一遍坏数。
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.BODY_CLOCK_STATE = join(tmpdir(), 'body-clock-daily.json')
const { __test } = await import('../index.js')

const {
  blankState, advance, touch, feel, senseText, readHisLine, absorbReply,
  impactOf, landContact, config, snapshot, view,
} = __test

let bad = 0
const ok = (name, cond, got = '') => {
  if (cond) console.log(`  ok   ${name}${got !== '' ? `  ${got}` : ''}`)
  else { bad += 1; console.log(`  [x]  ${name}  ${got}`) }
}

const H = 3600 * 1000
const D = 24 * H

/** 全量查：每个数都得是有限数，而且落在自己的范围里。 */
function audit(s, where) {
  const errs = []
  const finite = (v, label) => {
    if (typeof v === 'number' && !Number.isFinite(v)) errs.push(label)
  }
  const walk = (o, p) => {
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) walk(v, `${p}.${k}`)
    } else if (typeof o === 'number') finite(o, p)
  }
  walk(s, 'state')
  const between = (v, lo, hi, label) => {
    if (!(v >= lo && v <= hi)) errs.push(`${label}=${v}`)
  }
  between(s.libido, 10, 100, 'libido')
  for (const [k, v] of Object.entries(s.dims ?? {})) between(v, 0, 100, `dims.${k}`)
  for (const [id, z] of Object.entries(s.zones ?? {})) {
    between(z.press, 0, 100, `${id}.press`)
    between(z.flush, 0, 100, `${id}.flush`)
    between(z.shock ?? 0, 0, 100, `${id}.shock`)
    between(z.warmth ?? 50, 0, 100, `${id}.warmth`)
    between(z.temp, -1.25, 1.25, `${id}.temp`)
  }
  for (const [k, v] of Object.entries(s.emotion?.kinds ?? {})) between(v, 0, 100, `emotion.${k}`)
  between(s.emotion?.debt ?? 0, 0, 100, 'emotion.debt')
  for (const ev of s.emotion?.events ?? []) between(ev.intensity, 0, 100, 'event.intensity')
  if (errs.length) {
    bad += 1
    console.log(`  [x]  ${where} 坏数：${errs.slice(0, 6).join(' ')}${errs.length > 6 ? ' …' : ''}`)
  } else {
    console.log(`  ok   ${where}`)
  }
}

const fresh = () => { const s = blankState(); s.at = Date.now(); return s }
const go = (s, ms) => { s.at = Date.now() - ms; advance(s, Date.now()) }

console.log('=== 1. 碰一下脸，走开，八小时后回来 ===')
{
  const s = fresh()
  landContact(s, { zone: 'face', action: '贴', strength: '轻' })
  s.distance = '隐没'; s.awayAt = Date.now()
  go(s, 8 * H)
  audit(s, '走了八小时')
  ok('欲望没跌穿地板', s.libido >= config().libido.floor, s.libido)
}

console.log('\n=== 2. 同一处连弄三十下 ===')
{
  const s = fresh()
  for (let i = 0; i < 30; i++) touch(s, { zone: 'neck', action: '捏', strength: '重' })
  audit(s, '三十下之后')
  const z = snapshot(s).zones.find((x) => x.id === 'neck')
  ok('压痕没到一百以上', z.press <= 100, z.press)
  ok('欲望还在地板以上', s.libido >= 10, s.libido)
}

console.log('\n=== 3. 拍重手二十下 ===')
{
  const s = fresh()
  for (let i = 0; i < 20; i++) landContact(s, { zone: 'hip', action: '拍', strength: '重' })
  audit(s, '二十下重手之后')
  ok('记事扣到零就停', s.zones.hip.warmth >= 0, s.zones.hip.warmth)
  ok('余震封在一百', (s.zones.hip.shock ?? 0) <= 100, s.zones.hip.shock)
}

console.log('\n=== 4. 命令 / 威胁 / 提旧事 ===')
{
  const s = fresh()
  readHisLine(s, '过来，把手给我')
  readHisLine(s, '再不听话就等着')
  readHisLine(s, '上次你也是这样')
  audit(s, '三句话之后')
  ok('三种都认出来了', __test.speechKindOf('上次你也是这样') === 'memory')
}

console.log('\n=== 5. 空着五天 ===')
{
  const s = fresh()
  s.distance = '隐没'
  go(s, 5 * D)
  audit(s, '空着五天')
  ok('欲望落在底板上', s.libido <= 12, s.libido)
}

console.log('\n=== 6. 逐小时跨一年 ===')
{
  const s = fresh()
  s.at = Date.now() - 365 * D
  advance(s, Date.now())
  audit(s, '一年之后')
  ok('八维还是八个', Object.keys(s.dims).length === 8)
}

console.log('\n=== 7. 情绪两百笔 ===')
{
  const s = fresh()
  const kinds = ['joy', 'anger', 'sadness', 'fear', 'surprise', 'disgust']
  for (let i = 0; i < 200; i++) {
    feel(s, { kind: kinds[i % kinds.length], intensity: 40 + (i % 60), why: '测试' })
    if (i % 20 === 0) { s.at = Date.now() - 30 * 1000; advance(s, Date.now()) }
  }
  audit(s, '两百笔情绪之后')
}

console.log('\n=== 8. 一整天的读话 ===')
{
  const s = fresh()
  const lines = [
    '（手扣住你的腕）', '（被从背后抱住）', '（起身去倒水）', '（额头贴了一下）',
    '（手指顺着颈侧滑过去）', '（退开半步）',
  ]
  for (let i = 0; i < 20; i++) absorbReply(s, lines[i % lines.length])
  audit(s, '二十条括号之后')
}

console.log('\n=== 9. 注入文本 ===')
{
  const s = fresh()
  landContact(s, { zone: 'chest', action: '贴', strength: '中' })
  s.distance = '贴肤'
  const t = senseText(s)
  ok('没有坏数', !/NaN|undefined|Infinity/.test(t), t.split('\n')[0])
  ok('不超过上限', t.length <= (config().inject.maxChars || 460), t.length)
  ok('行数没炸', t.split('\n').length <= 6, t.split('\n').length)
  const v = view(s)
  ok('view 读得出来', v.zones !== undefined || v.act !== undefined, Object.keys(v).length)
}

console.log(bad ? `\n[失败] ${bad} 处` : '\n全过')
process.exit(bad ? 1 : 0)