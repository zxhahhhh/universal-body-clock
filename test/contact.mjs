/**
 * 一下碰的重量：impact 一个数，情绪、八维、距离三处都从它读。
 * 断言之外把关键的数打出来——重多少、跨了几档，要看得见，不凭感觉说「差不多」。
 */
import { __test as T } from '../index.js'

const ok = (c, msg, extra = '') => {
  if (!c) {
    console.error(`FAIL  ${msg}${extra ? '  ' + extra : ''}`)
    process.exitCode = 1
  } else {
    console.log(`ok    ${msg}${extra ? '  ' + extra : ''}`)
  }
}

const blank = () => {
  const s = T.blankState()
  s.zones = s.zones ?? {}
  return s
}

const kindsOf = (s) => (s.emotion.events ?? []).map((e) => e.kind)

// ---------------------------------------------------------------- impact
{
  const s = blank()
  s.distance = '隐没'
  s.libido = 40
  const kiss = T.impactOf(s, { zone: 'mouth', action: '舔', strength: '轻', duration: 0, sudden: false })
  const hug = T.impactOf(s, { zone: 'chest', action: '贴', strength: '轻', duration: 0, sudden: false })
  const deep = T.impactOf(s, { zone: 'mouth', action: '舔', strength: '中', duration: 0, sudden: false })
  const sudden = T.impactOf(s, { zone: 'chest', action: '贴', strength: '轻', duration: 0, sudden: true })
  const long = T.impactOf(s, { zone: 'mouth', action: '舔', strength: '轻', duration: 20, sudden: false })
  console.log(`impact  轻吻 ${kiss}｜深吻 ${deep}｜轻抱 ${hug}｜突然抱 ${sudden}｜二十秒 ${long}（门槛 45）`)
  ok(kiss >= 25 && kiss < 45, '一个轻吻：够重、还没到说出口', String(kiss))
  ok(deep > kiss, '深吻比轻吻重', `${deep} > ${kiss}`)
  ok(hug >= 22 && hug < 45, '一个轻抱：够重、还没到说出口', String(hug))
  ok(sudden > 45, '突然抱上来的那一下自己就过了门槛', String(sudden))
  ok(long > kiss, '久一点更重', `${long} > ${kiss}`)

  // 欲望高的身子，同一下更重。
  const hot = blank()
  hot.distance = '隐没'
  hot.libido = 90
  const kissHot = T.impactOf(hot, { zone: 'mouth', action: '舔', strength: '轻', duration: 0, sudden: false })
  console.log(`impact  同一个轻吻，欲望 40 → 90：${kiss} → ${kissHot}`)
  ok(kissHot > kiss, '欲望上来了，同一下更重')

  // 每一格不一样：嘴比手重。
  const hand = T.impactOf(s, { zone: 'hand', action: '舔', strength: '轻', duration: 0, sudden: false })
  ok(kiss > hand, '同一动作，嘴比手重', `${kiss} > ${hand}`)
  // 落在一个不认识的格子上，不许算出 NaN。
  const weird = T.impactOf(s, { zone: 'nope', action: 'nope', strength: 'nope', duration: 999, sudden: true })
  ok(Number.isFinite(weird) && weird >= 0 && weird <= 100, '怪参数也落在 0..100', String(weird))
}

// ---------------------------------------------------------------- 突然亲上来
{
  const s = blank()
  s.distance = '隐没'
  s.libido = 40
  T.resetMoodClock()
  const out = T.absorbReply(s, '（被突然亲上来）')
  const ev = s.emotion.events[0] ?? {}
  console.log(`突然亲 → ${ev.kind} ${ev.intensity}｜六格 ${JSON.stringify(s.emotion.kinds)}｜距离 ${s.distance}`)
  ok(out.touches === 1, '认出来了', String(out.touches))
  ok(ev.kind === 'surprise', '落的是惊', ev.kind)
  ok(ev.intensity >= 45, '惊够重，说得出口', String(ev.intensity))
  ok(s.distance === '贴肤', '距离贴上了', s.distance)
  ok(s.dims['亲密'] > 50, '八维跟着动', String(s.dims['亲密']))
}

// ---------------------------------------------------------------- 本来就挨着，再亲不算突然
{
  const s = blank()
  s.distance = '隔布'
  s.libido = 40
  T.resetMoodClock()
  T.absorbReply(s, '（被亲住）')
  const ev = s.emotion.events[0] ?? {}
  ok(ev.kind === 'joy', '本来就挨着，再亲不算惊', ev.kind)
}

// ---------------------------------------------------------------- 抱：归胸口，不归手
{
  const s = blank()
  s.distance = '隐没'
  s.libido = 40
  T.resetMoodClock()
  const out = T.absorbReply(s, '（被抱住）')
  console.log(`被抱住 → read ${JSON.stringify(out.read)} 胸温 ${s.zones.chest.temp} 手温 ${s.zones.hand.temp}`)
  ok(out.read.includes('胸'), '落在胸口这一片', JSON.stringify(out.read))
  // 手没被碰到；惊/怕会把手指吹凉，那只要求「没被碰热」。
  ok(s.zones.hand.temp <= 0, '没糊到手上去', String(s.zones.hand.temp))
  ok(s.zones.chest.temp > 0.1, '胸口热了', String(s.zones.chest.temp))
}

// ---------------------------------------------------------------- 疼：先怕，再惊
{
  const s = blank()
  s.distance = '贴肤'
  s.libido = 30
  T.resetMoodClock()
  const r = T.landContact(s, { zone: 'neck', action: '掐', strength: '重' })
  const evs = s.emotion.events ?? []
  const fear = evs.find((e) => e.kind === 'fear') ?? {}
  const surprise = evs.find((e) => e.kind === 'surprise') ?? {}
  console.log(`重掐 → impact ${r?.impact}｜怕 ${fear.intensity}｜惊 ${surprise.intensity}`)
  ok(Boolean(r), '这一下落住了')
  ok(Boolean(fear.kind) && Boolean(surprise.kind), '疼先过怕，再过惊', kindsOf(s).join(','))
  ok((fear.at ?? 0) <= (surprise.at ?? 0), '怕在惊前头')
  ok((fear.intensity ?? 100) < (surprise.intensity ?? 0), '怕比惊轻一档', `${fear.intensity} < ${surprise.intensity}`)
  // 轻的掐不算疼，别一碰就上怕。
  T.resetMoodClock()
  const s2 = blank()
  s2.distance = '贴肤'
  T.landContact(s2, { zone: 'neck', action: '掐', strength: '轻' })
  ok(!kindsOf(s2).includes('fear'), '轻掐不上怕', kindsOf(s2).join(','))
}

// ---------------------------------------------------------------- 他打的字：括号
{
  const s = blank()
  s.distance = '隐没'
  s.libido = 40
  T.resetMoodClock()
  const n = T.readHisAction(s, '（突然抱住你）')
  const ev = s.emotion.events[0] ?? {}
  console.log(`他抱住 → ${n}｜${ev.kind} ${ev.intensity}｜距离 ${s.distance}`)
  ok(n === 1, '他的括号认出来了')
  ok(ev.kind === 'surprise', '他冷不丁抱上来也是惊', ev.kind)
  ok(s.distance === '隔布', '他穿着衣服，最多隔布', s.distance)

  const s2 = blank()
  s2.distance = '隔布'
  s2.libido = 40
  T.resetMoodClock()
  T.readHisAction(s2, '（抱住你）')
  ok((s2.emotion.events[0] ?? {}).kind === 'joy', '本来就贴着，他再抱不算惊')
}

// ---------------------------------------------------------------- 他打的字：白字
{
  const s = blank()
  s.distance = '隔布'
  s.libido = 45
  T.resetMoodClock()
  T.readHisLine(s, '突然就抱过来了')
  const ev = s.emotion.events[0] ?? {}
  console.log(`他那句话 → ${ev.kind} ${ev.intensity}｜距离 ${s.distance}`)
  ok(Boolean(ev.kind), '他的话也落了一笔情绪', ev.kind)
  ok(s.distance === '隔布', '话里的抱只到隔布', s.distance)

  // readHisAction 已经记过这一句，readHisLine 不许再记一份。
  const s2 = blank()
  s2.distance = '隐没'
  T.resetMoodClock()
  T.readHisAction(s2, '（抱住你）')
  const before = (s2.emotion.events ?? []).length
  T.readHisLine(s2, '（抱住你）')
  ok((s2.emotion.events ?? []).length === before, '同一句不双份记', `${before} -> ${(s2.emotion.events ?? []).length}`)
}

// ---------------------------------------------------------------- 一场推多少
{
  const run = (n, zone, action) => {
    const s = blank()
    s.distance = '贴肤'
    s.libido = 70
    const from = { ...s.dims }
    for (let i = 0; i < n; i++) {
      T.resetMoodClock()
      T.landContact(s, { zone, action, strength: '轻' })
      s.libido = Math.min(100, s.libido + 0.5)
    }
    const out = {}
    for (const k of Object.keys(s.dims)) {
      const d = Math.round((s.dims[k] - from[k]) * 10) / 10
      if (d) out[k] = d
    }
    return out
  }

  const soft = run(20, 'mouth', '舔')
  const held = run(20, 'neck', '按')
  const marked = run(20, 'hip', '掐')
  console.log(`二十下舔 → ${JSON.stringify(soft)}`)
  console.log(`二十下按 → ${JSON.stringify(held)}`)
  console.log(`二十下掐 → ${JSON.stringify(marked)}`)
  ok((soft['亲密'] ?? 0) >= 4, '舔一场把亲密推起来', String(soft['亲密']))
  ok((soft['羞'] ?? 0) >= 2, '羞也跟着', String(soft['羞']))
  ok((held['自制'] ?? 0) >= 2, '按着的时候自制在动', String(held['自制']))
  ok((marked['敏感'] ?? 0) >= 2, '掐的那一下把敏感推上来', String(marked['敏感']))
  // 八维一次最多三处，别把整张脸都动了。
  ok(Object.keys(soft).length <= 3, '一下最多动三处', Object.keys(soft).join(','))
}

// ---------------------------------------------------------------- 同一处连着碰
{
  const s = blank()
  s.distance = '贴肤'
  s.libido = 60
  for (let i = 0; i < 3; i++) T.landContact(s, { zone: 'neck', action: '舔', strength: '轻' })
  const rep = T.repeatCountOf(s, 'neck')
  const r = T.landContact(s, { zone: 'neck', action: '舔', strength: '轻' })
  console.log(`连亲三下 · 十五分钟内 ${rep} 次｜repeat ${r?.repeat}`)
  ok(rep >= 3, '数得出来这一格被碰了几回', String(rep))
  ok(r?.repeat === true, '连着碰的认得出是 repeat')
}

// ---------------------------------------------------------------- 情绪批次：一张回复最多三笔
{
  const s = blank()
  s.distance = '贴肤'
  T.resetMoodClock()
  ok(T.moodOf(s, 'joy', 40, 'a') === true, '第一笔进得去')
  ok(T.moodOf(s, 'joy', 40, 'b') === false, '同一种不重复记')
  ok(T.moodOf(s, 'anger', 30, 'c') === true, '第二种进得去')
  ok(T.moodOf(s, 'sadness', 30, 'd') === true, '第三种进得去')
  ok(T.moodOf(s, 'surprise', 30, 'e') === false, '第四笔就满了')
}

console.log(process.exitCode ? '\n有没过的' : '\ncontact 全过')