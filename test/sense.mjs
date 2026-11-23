// 注入里那几行的口径：头行带日期和欲望、走开留痕、空格不报、场一个词、
// 面板轮询不白写盘。这一批改的全是「说得对不对」，所以逐条对字。
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 每个测试各用一个临时账本，绝不碰真实的那一个文件。
process.env.BODY_CLOCK_STATE = join(tmpdir(), 'body-clock-sense.json')
const { __test } = await import('../index.js')

const { blankState, advance, feel, senseText, sigOf, remainingPeak, sensStep, emptyOf, view } = __test

let bad = 0
function check(label, ok, extra = '') {
  if (!ok) {
    bad += 1
    console.log(`  ✗ ${label}${extra ? '　' + extra : ''}`)
  } else {
    console.log(`  ✓ ${label}${extra ? '　' + extra : ''}`)
  }
}

const now = () => Date.now()
const textOf = (s) => senseText(s)
const headOf = (s) => textOf(s).split('\n')[0]
const bodyOf = (s) => textOf(s)
const moodOf = (s) => textOf(s).split('\n').find((l) => l.startsWith('情绪')) ?? ''
const zonesOf = (s) => textOf(s).split('\n').find((l) => l.startsWith('格子')) ?? ''

// === 1. 头行：日期、欲望、隔多久、八维一行 ===
{
  console.log('=== 1. 头行 ===')
  const s = blankState()
  s.at = now() - 5000
  s.lastAnyTouch = now() - 25 * 60 * 1000
  const head = headOf(s)
  console.log('  ', head)
  check('有月日', /\d+-\d+ /.test(head))
  check('报欲望', /欲望 \d+/.test(head), head)
  check('有八维那一行', bodyOf(s).includes('八维 亲密'), bodyOf(s))
  check('八维八个数', (bodyOf(s).match(/亲密\d+ 信任\d+ 警觉\d+ 疲惫\d+ 自制\d+ 敏感\d+ 羞\d+ 放松\d+/) ?? []).length === 1, bodyOf(s))
  check('有指路那一行，且带一句动作', bodyOf(s).includes('body_sense') && bodyOf(s).includes('碰完它会回你数'), bodyOf(s))
  check('有隔多久', head.includes('隔 25 分钟'), head)
  // 头行不许出现小数。温度那一格才留一位小数。
  check('头行没有小数', !/\d+\.\d/.test(head), head)
  const lines = senseText(s).split('\n')
  const decimalLines = lines.filter((l) => /\d+\.\d/.test(l))
  check('只有格子行许带小数', decimalLines.length <= 1, decimalLines.join(' ／ '))
  check('行数不超八', lines.length <= 8, `lines ${lines.length}`)
}

// === 2. 距离：头行报「距」 ===
{
  console.log('=== 2. 距离 ===')
  const s = blankState()
  s.distance = '隔布'
  s.distAt = now()
  s.at = now() - 5000
  const head = headOf(s)
  console.log('  ', head)
  check('头行有距', head.includes('距 隔布'), head)
  check('人还在近处', bodyOf(s).includes('对方还在近处'), bodyOf(s))
}

// === 3. 空格子不报 ===
{
  console.log('=== 3. 空格子 ===')
  const s = blankState()
  s.at = now() - 5000
  const body = bodyOf(s)
  console.log('  ', body.replace(/\n/g, ' ／ '))
  check('没有格子那一行', !zonesOf(s), zonesOf(s))
}

// === 4. 有印子：格子摊开，最多四格 ===
{
  console.log('=== 4. 有印子 ===')
  const s = blankState()
  s.at = now() - 5000
  s.zones.hand = { ...s.zones.hand, press: 88, flush: 86, temp: 0.4, lastTouch: now() }
  s.zones.waist = { ...s.zones.waist, press: 12, flush: 8, temp: 0.2, lastTouch: now() }
  s.zones.neck = { ...s.zones.neck, press: 20, flush: 10, temp: 0, lastTouch: now() }
  s.zones.belly = { ...s.zones.belly, press: 20, flush: 10, temp: 0, lastTouch: now() }
  s.zones.chest = { ...s.zones.chest, press: 20, flush: 10, temp: 0, lastTouch: now() }
  const lines = textOf(s).split('\n')
  console.log('  ', lines.join(' ／ '))
  const zl = zonesOf(s)
  check('有格子那一行', !!zl, zl)
  check('写到手', zl.includes('手 '), zl)
  check('压红都写了', /手 压\d+ 红\d+/.test(zl), zl)
  check('最多四格', (zl.match(/｜/g) ?? []).length <= 4, zl)
  check('多的说还有别的', zl.includes('还有别的'), zl)
}

// === 5. 走开留痕：不烫也留一句 ===
{
  console.log('=== 5. 走开留痕（不烫） ===')
  const s = blankState()
  s.libido = 20
  s.distance = '隐没'
  s.distAt = now() - 40 * 60 * 1000
  s.awayAt = now() - 40 * 60 * 1000
  s.lastAnyTouch = now() - 40 * 60 * 1000
  s.at = now() - 5000
  const body = bodyOf(s)
  console.log('  ', body.replace(/\n/g, ' ／ '))
  check('有走开那句', body.includes('屋子空下来了'), body)
  check('带走了多久', body.includes('对方走了 40 分钟'), body)
}

// === 6. 走开还烫：空落 ===
{
  console.log('=== 6. 走开留痕（还烫） ===')
  const s = blankState()
  s.libido = 70
  s.distance = '隐没'
  s.distAt = now() - 10 * 60 * 1000
  s.awayAt = now() - 10 * 60 * 1000
  s.lastAnyTouch = now() - 10 * 60 * 1000
  s.at = now() - 5000
  const body = bodyOf(s)
  console.log('  ', body.replace(/\n/g, ' ／ '))
  check('说空落落', body.includes('空落落的'), body)
}

// === 7. 走开超过三小时：算走了，不念了 ===
{
  console.log('=== 7. 走开超过三小时 ===')
  const s = blankState()
  s.libido = 20
  s.distance = '隐没'
  s.awayAt = now() - 4 * 3600 * 1000
  s.distAt = now() - 4 * 3600 * 1000
  s.lastAnyTouch = now() - 4 * 3600 * 1000
  s.at = now() - 5000
  const body = bodyOf(s)
  check('不再说走开', !body.includes('对方走了'), body)
}

// === 8. 最狠按剩余算，事件半衰后跟着掉 ===
{
  console.log('=== 8. 最狠 ===')
  const s = blankState()
  s.libido = 20
  s.at = now() - 5000
  feel(s, { kind: 'anger', intensity: 90 })
  advance(s, now() + 1000)
  const peak0 = remainingPeak(s.emotion)
  const mood0 = moodOf(s)
  console.log('  ', mood0)
  // 90 起手，走了一秒就掉零点几，所以卡 88 就够；要紧的是别跳、别超过起手。
  check('刚起时最狠接近满', peak0 >= 88 && peak0 <= 100, `peak ${peak0}`)
  check('标签叫最狠', mood0.includes('最狠'), mood0)

  advance(s, now() + 8 * 60 * 1000)
  const peak1 = remainingPeak(s.emotion)
  const mood1 = moodOf(s)
  console.log('  ', mood1)
  check('过半后掉下来', peak1 < peak0 * 0.8 && peak1 > peak0 * 0.55, `peak ${peak0} -> ${peak1}`)
  check('没有跳回去', peak1 < peak0, `peak ${peak0} -> ${peak1}`)
  check('情绪还挂着', mood1.includes('还没下去') || mood1.includes('情绪'), mood1)
}

// === 9. 面板轮询：没变就不该写 ===
{
  console.log('=== 9. 指纹 ===')
  const s = blankState()
  s.at = now() - 5000
  const a = sigOf(s)
  advance(s, now() + 3)
  const b = sigOf(s)
  check('三毫秒不算变', a === b)
  s.dims['敏感'] = 80
  check('改了数算变', sigOf(s) !== b)
}

// === 10. 静着：五行，不摊格子 ===
{
  console.log('=== 10. 静着 ===')
  const s = blankState()
  s.libido = 20
  s.lastAnyTouch = now() - 55 * 60 * 1000
  s.at = now() - 5000
  const lines = textOf(s).split('\n')
  console.log('  ', lines.join(' ／ '))
  check('五行（含指路那一行）', lines.length === 5, `lines ${lines.length}`)
  check('没有格子那一行', !zonesOf(s), zonesOf(s))
  check('情绪那一行在', /^情绪 /.test(lines[2]), lines[2])
}

// === 11. 场：平静／微动／强烈，怒不把场推上去 ===
{
  console.log('=== 11. 场 ===')
  const { sceneOf, snapshot } = __test

  const calm = blankState()
  calm.at = now() - 5000
  calm.lastAnyTouch = now() - 40 * 60 * 1000
  check('静着是平静', sceneOf(calm).word === '平静', sceneOf(calm).word)
  check('头行报场', headOf(calm).includes('平静'), headOf(calm))
  // 头行末尾那句「（背景，别念出来）」是配置里的标注，不算场名自带的话；先摘掉它再看。
  const bareHead = (s) => headOf(s).replace(/（[^（）]*）$/, '')
  check('平静不挂允许什么', !bareHead(calm).includes('（'), bareHead(calm))

  const hot = blankState()
  hot.at = now() - 5000
  hot.distance = '贴肤'
  hot.distAt = now() - 60000
  hot.libido = 95
  hot.zones.waist = { ...hot.zones.waist, press: 90, flush: 88, temp: 0.6, lastTouch: now() }
  check('贴着又烫又满是强烈', sceneOf(hot).word === '强烈', `${sceneOf(hot).word} ${sceneOf(hot).hot}`)
  check('强烈带一句允许', headOf(hot).includes('可以放开'), headOf(hot))
  check('快照与注入一个词', snapshot(hot).scene === sceneOf(hot).word, snapshot(hot).scene)

  const mid = blankState()
  mid.at = now() - 5000
  mid.distance = '隔布'
  mid.distAt = now() - 60000
  mid.libido = 62
  check('隔布带一点火是微动', sceneOf(mid).word === '微动', `${sceneOf(mid).word} ${sceneOf(mid).hot}`)

  const angry = blankState()
  angry.at = now() - 5000
  feel(angry, { kind: 'anger', intensity: 90, why: 'test' })
  const a = sceneOf(angry)
  check('怒不把场推上去', a.word === '平静', `${a.word} ${a.hot}`)
}

// === 12. 联动：敏感加重情绪、敏感只走一条道、空着只有一个出处 ===
{
  console.log('=== 12. 联动 ===')
  const lo = blankState()
  lo.dims['敏感'] = 40
  lo.at = now() - 5000
  feel(lo, { kind: 'anger', intensity: 80 })

  const hi = blankState()
  hi.dims['敏感'] = 90
  hi.at = now() - 5000
  feel(hi, { kind: 'anger', intensity: 80 })

  const loP = remainingPeak(lo.emotion)
  const hiP = remainingPeak(hi.emotion)
  check('敏感高的记更重', hiP > loP + 8, `${loP} vs ${hiP}`)

  const hot = blankState()
  hot.libido = 95
  hot.dims['敏感'] = 94.9
  feel(hot, { kind: 'joy', intensity: 90 })
  const up = sensStep(hot, 1, { ...emptyOf(hot, now()), line: 60 })
  // 封顶不是「不许涨」，是「只准涨到 95」——94.9 那一格只留一丝缝。
  check('快到头就封住', 94.9 + up <= 95.001, `step ${up}`)
  const cold = blankState()
  cold.libido = 20
  const down = sensStep(cold, 2, { ...emptyOf(cold, now()), line: 60 })
  check('落回去是慢退', down < 0, `step ${down}`)

  const e = blankState()
  e.libido = 70
  e.at = now() - 30 * 60 * 1000
  e.lastAnyTouch = now() - 30 * 60 * 1000
  const info = emptyOf(e, now())
  check('空着由同一个出处判', info.idle === true, JSON.stringify(info))
}

// === 13. 敏感快到顶要说出来 ===
{
  console.log('=== 13. 敏感到顶 ===')
  const s = blankState()
  s.libido = 20
  s.dims['敏感'] = 93
  s.at = now() - 5000
  const body = bodyOf(s)
  check('有那一句', body.includes('敏感快到头了'), body)
}

// === 14. 关掉就整段不注入 ===
{
  const s = blankState()
  s.enabled = false
  check('关着是空串', senseText(s) === '', JSON.stringify(senseText(s)))
}

// === 15. 视图里没有旧字段 ===
{
  const v = view(blankState())
  check('视图只有 subject', v.subject === 'self' && !('face' in v), JSON.stringify(Object.keys(v)))
  check('视图没有尾巴和纹', !('tail' in v) && !('mark' in v))
}

console.log(bad ? `[失败] ${bad} 项` : '[done] 全对')
if (bad) process.exitCode = 1