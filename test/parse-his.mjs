/**
 * 1.6.0 新搬过来那半张网：读他的话切句认多处、认识的动词多了、
 * 「那一阵」有自己的位置、余韵活得过一次 advance。
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
  s.enabled = true
  s.distance = '靠近'
  s.libido = 30
  return s
}

const zonesOf = (text) => T.hisClauses(text).map((x) => x.zone)
const one = (text) => T.hisClauses(text)[0] ?? {}

// ---------------------------------------------------------------- 读他的话
{
  ok(zonesOf('（双手揉捏胸部）').join() === 'chest', '「双手」不再把胸顶掉', zonesOf('（双手揉捏胸部）').join())
  const two = zonesOf('（揉着臀部，摸着胸部）')
  ok(two.includes('hip') && two.includes('chest'), '一句两处：臀和胸都落', two.join())
  ok(zonesOf('（慢慢地把手放到胸口上，停了一会儿）').includes('chest'), '把字句、十八个字也认', zonesOf('（慢慢地把手放到胸口上，停了一会儿）').join())
  ok(zonesOf('（握住你的脚，把脚放到我的阳器上）').includes('foot'), '脚落成脚，不是手', zonesOf('（握住你的脚，把脚放到我的阳器上）').join())
  ok(one('（插进去）').zone === 'inside', '插进去落在里面', one('（插进去）').zone)
  ok(one('（滑过后背）').zone === 'back', '滑过落在背', one('（滑过后背）').zone)
  ok(one('（踩住脚尖）').zone === 'foot', '踩住落在脚', one('（踩住脚尖）').zone)
  ok(one('（口交）').zone === 'mouth', '口交这类名词也认', one('（口交）').zone)
  ok(one('（足交）').zone === 'foot', '足交落在脚', one('（足交）').zone)
  ok(one('（赤裸着贴上来）').dist === '贴肤', '赤裸贴上来是贴肤', one('（赤裸着贴上来）').dist)
  ok(one('（隔着衣服抱住你）').dist === '隔布', '隔着衣服是隔布', one('（隔着衣服抱住你）').dist)
  ok(one('（紧紧抱住你）').strength === '中', '抱紧算中力', one('（紧紧抱住你）').strength)
  ok(zonesOf('（揉着胸，又揉着胸口）').length === 1, '同一格只计一次', zonesOf('（揉着胸，又揉着胸口）').join())
  ok(zonesOf('（如果是你就好了）').length === 0, '假设句不落', zonesOf('（如果是你就好了）').join())
}

// ---------------------------------------------------------------- 那一阵
{
  const s = blank()
  s.scene = { act: '情趣', intensity: 1 }
  const n = T.readHisAction(s, '（射了）')
  ok(n === 0 && s.peakAt > 0, '射了没有碰，但峰值记上了', `landed=${n}`)
  ok((s.zones.belly.flush ?? 0) > 0, '小腹跟着热', String(s.zones.belly.flush))

  const cold = blank()
  cold.scene = { act: '日常', intensity: 0.2 }
  T.readHisAction(cold, '（去了学校）')
  ok(!cold.peakAt, '冷场里「去了」后面跟着别的，不认', String(cold.peakAt ?? 0))

  const coldTail = blank()
  coldTail.scene = { act: '日常', intensity: 0.2 }
  T.readHisAction(coldTail, '（去了）')
  ok(coldTail.peakAt > 0, '落在一句话末尾的「去了」就是那一声', String(coldTail.peakAt ?? 0))

  const hot = blank()
  hot.scene = { act: '情趣', intensity: 1 }
  T.readHisAction(hot, '（去了）')
  ok(hot.peakAt > 0, '情趣里「去了」就认', String(hot.peakAt))

  const school = blank()
  school.scene = { act: '情趣', intensity: 1 }
  T.readHisAction(school, '（去了学校）')
  ok(!school.peakAt, '去了学校不认', String(school.peakAt ?? 0))

  const reflect = blank()
  reflect.scene = { act: '情趣', intensity: 1 }
  T.readHisAction(reflect, '（反射了一下）')
  ok(!reflect.peakAt, '反射不当成射', String(reflect.peakAt ?? 0))

  const hb = blank()
  hb.scene = { act: '情趣', intensity: 1 }
  T.readHisAction(hb, '（别停，射了）')
  ok(hb.peakAt > 0, '「别停」不挡那一阵', String(hb.peakAt ?? 0))
}

// ---------------------------------------------------------------- 余韵
{
  const s = blank()
  s.scene = { act: '情趣', intensity: 1 }
  T.applyClimax(s, '（射了）', '射')
  const now = Date.now()
  ok(s.zones.belly.afterUntil > now + 6 * 60 * 1000, '刚落完，余韵在八分钟', String(Math.round((s.zones.belly.afterUntil - now) / 1000)) + 's')
  T.advance(s, now + 4 * 60 * 1000)
  ok(Boolean(s.zones.belly.after), '四分钟后余韵还在', String(s.zones.belly.after))
  T.advance(s, now + 9 * 60 * 1000)
  ok(!s.zones.belly.after, '九分钟后清干净', String(s.zones.belly.after ?? ''))
}
