/**
 * 1.7.0 情绪两层：事件两分钟退干净，六格各按自己的半衰期退；
 * 加一笔够满就打折，哄/回来/走开能减压。只验数，不验嘴。
 */
import { __test as T } from '../index.js'

let failed = 0
const ok = (c, msg, extra = '') => {
  if (!c) { failed += 1; console.error(`FAIL  ${msg}${extra ? '  ' + extra : ''}`) } else console.log(`ok    ${msg}${extra ? '  ' + extra : ''}`)
}
const now = () => Date.now()
const fresh = () => {
  const s = T.blankState()
  s.at = now() - 1000
  T.resetMoodClock()
  return s
}
const kinds = (s) => s.emotion.kinds
const step = (s, ms) => T.advance(s, now() + ms)

// 半衰期：各走各的
{
  const cases = [
    ['joy', 90 * 60 * 1000],
    ['anger', 60 * 60 * 1000],
    ['sadness', 240 * 60 * 1000],
    ['fear', 30 * 60 * 1000],
    ['surprise', 40 * 1000],
    ['disgust', 60 * 60 * 1000],
  ]
  for (const [kind, ms] of cases) {
    const s = fresh()
    T.feel(s, { kind, intensity: 100 })
    const before = Number(kinds(s)[kind])
    step(s, ms)
    const after = Number(kinds(s)[kind])
    ok(before >= 99 && after > 45 && after < 55, `${kind} 半衰期`, `${before} -> ${after}`)
  }
}

// 刺激层：十分钟就该退干净，不等余味
{
  const s = fresh()
  T.feel(s, { kind: 'joy', intensity: 80 })
  ok(s.emotion.events.length === 1, '刚起有一笔事件')
  step(s, 10 * 60 * 1000)
  ok(s.emotion.events.length === 0, '十分钟后事件退干净', String(s.emotion.events.length))
}

// 防饱和：八十五以上打五折，九十五以上打两折
{
  const s = fresh()
  s.emotion.kinds.anger = 88
  T.feel(s, { kind: 'anger', intensity: 10 })
  ok(kinds(s).anger === 93, '八十八再加十只加五', String(kinds(s).anger))
  s.emotion.kinds.anger = 96
  const s2 = fresh()
  s2.emotion.kinds.anger = 96
  T.feel(s2, { kind: 'anger', intensity: 10 })
  ok(kinds(s2).anger === 98, '九十六再加十只加二', String(kinds(s2).anger))
}

// 减压：哄、回来、走开各压各的
{
  const s = fresh()
  s.emotion.kinds.anger = 30
  s.emotion.kinds.fear = 20
  s.emotion.kinds.sadness = 20
  s.emotion.kinds.joy = 30
  s.emotion.debt = 50
  T.sootheGroup(s, T.config().emotion.counter.soothe, { debtCut: 15 })
  ok(kinds(s).anger === 16, '哄一句：怒退十四', String(kinds(s).anger))
  ok(kinds(s).fear === 12, '哄一句：惧退八', String(kinds(s).fear))
  ok(s.emotion.debt === 35, '债削十五', String(s.emotion.debt))
  T.sootheGroup(s, T.config().emotion.counter.return, { cancelAll: true })
  ok(kinds(s).sadness === 8 && kinds(s).fear === 2, '回来：哀退十二、惧退十', `${kinds(s).sadness}/${kinds(s).fear}`)
  T.sootheGroup(s, T.config().emotion.counter.leave)
  ok(kinds(s).joy === 20, '走开：喜退十', String(kinds(s).joy))
}

// 事退才落八维：挂到刺激层之后，不拖到六格的半衰期
{
  const s = fresh()
  T.feel(s, { kind: 'anger', intensity: 90 })
  const settle = s.emotion.settle?.[s.emotion.settle.length - 1]
  ok(!!settle, '有结算单')
  const wait = (Number(settle?.at) || 0) - now()
  ok(wait > 90 * 1000 && wait < 150 * 1000, '结算挂两分钟上下', String(wait))
}

// 注入里能看见候选
{
  const s = fresh()
  T.nominate(s, 'sadness', 6, '随你', '（随你）')
  const v = T.emotionView(s.emotion)
  ok(v.cand.length === 1 && v.cand[0].amt === 6, '候选进读数', JSON.stringify(v.cand))
  const text = T.senseText(s)
  ok(/候选/.test(text), '注入里带候选那行', text.slice(0, 120))
}

if (failed) { console.error(`[失败] ${failed} 项`); process.exitCode = 1 } else console.log('全过')
