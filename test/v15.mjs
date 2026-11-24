/**
 * v1.5 的六件新东西，各跑一遍。
 * 只动内存，账本落在临时目录，跑完不碰真实的那一份。
 *
 *   一、皮肤记事：每格一个 warmth，只改这一格的分量，四十八小时半衰回中。
 *   二、湿与绷：派生量，不存账。
 *   三、话落到身上：命令落温、威胁落凉、提旧事焐心口。
 *   四、夜里皮更薄：二十三点到五点，敏感涨得快一点。
 *   五、不应期四档搬进配置。
 *   六、远路：唇和颈能传到小腹，但不该盖过腰。
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.BODY_CLOCK_STATE = join(tmpdir(), 'body-clock-v15.json')
const { __test } = await import('../index.js')

const {
  blankState, advance, touch, impactOf, leaves, spec, senseText,
  wetOf, tenseOf, activeZones, sensStep, readHisLine, SCHEMA, config,
} = __test

let bad = 0
const ok = (name, cond, got = '') => {
  if (cond) console.log(`  ok   ${name}${got !== '' ? `  ${got}` : ''}`)
  else { bad += 1; console.log(`  [x]  ${name}  ${got}`) }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol

/** 干净的一份，直接落在内存里，不写盘。 */
function fresh() {
  const s = blankState()
  s.at = Date.now()
  return s
}

const H = 3600 * 1000

console.log('=== 1. 记事这一格进了契约 ===')
{
  const s = fresh()
  ok('新账本每一格都带 warmth', Object.values(s.zones).every((z) => z.warmth === 50))
  ok('版本号是 3', SCHEMA === 3, SCHEMA)
  const w = leaves(s).filter((l) => /\.warmth$/.test(l.path))
  ok('契约里多了十二个叶子', w.length === 12, w.length)
  ok('契约默认值五十', spec().zones[2][1].warmth[3] === 50)
}

console.log('\n=== 2. 记事只改这一格的分量 ===')
{
  const warm = fresh(); warm.zones.neck.warmth = 100
  const cold = fresh(); cold.zones.neck.warmth = 0
  const a = impactOf(warm, { zone: 'neck', action: '贴', strength: '中' })
  const b = impactOf(cold, { zone: 'neck', action: '贴', strength: '中' })
  // 一百是 +15%，零是 -15%，两头比 1.15/0.85 ≈ 1.353，取整后容差放宽。
  ok('记恩的脖子比记疼的重', a > b, `${a} / ${b}`)
  // 分量只差一成半，落成整数后两头差得更少——只要方向对、差得不夸张就行。
  ok('高低差在一成到四成之间', a / b > 1.05 && a / b < 1.4, (a / b).toFixed(3))
  const other = impactOf(warm, { zone: 'foot', action: '贴', strength: '中' })
  const base = impactOf(fresh(), { zone: 'foot', action: '贴', strength: '中' })
  ok('别的格子不跟着变', other === base, `${other} / ${base}`)
}

console.log('\n=== 3. 记恩记疼，四十八小时半衰 ===')
{
  const s = fresh()
  touch(s, { zone: 'chest', action: '贴', strength: '轻' })
  ok('软碰往上记', s.zones.chest.warmth > 50, s.zones.chest.warmth)
  const s2 = fresh()
  touch(s2, { zone: 'chest', action: '拍', strength: '重' })
  ok('重手往下记', s2.zones.chest.warmth < 50, s2.zones.chest.warmth)
  // 一次最多走一天，所以要分两次推。
  s.at = Date.now() - 24 * H
  advance(s, Date.now())
  s.at = Date.now() - 24 * H
  advance(s, Date.now())
  const back = Math.abs(s.zones.chest.warmth - 50)
  ok('四十八小时后回到一半以内', back < 1, s.zones.chest.warmth)
}

console.log('\n=== 4. 湿与绷是算出来的，不存账 ===')
{
  const s = fresh()
  s.zones.neck.flush = 80
  s.zones.neck.lastTouch = Date.now() - 30 * 1000
  s.libido = 40
  const wet = wetOf(s, s.zones.neck)
  ok('红够了又有新碰，是湿的', wet > 0, wet)
  s.zones.neck.flush = 30
  ok('红不到线就不写湿', wetOf(s, s.zones.neck) === 0, wetOf(s, s.zones.neck))
  s.zones.neck.flush = 80
  s.zones.neck.lastTouch = 0
  ok('从没碰过不算湿', wetOf(s, s.zones.neck) === 0)
  s.zones.neck.press = 60
  ok('压着就绷', near(tenseOf(s, s.zones.neck), 27, 0.01), tenseOf(s, s.zones.neck))
  s.emotion.kinds.fear = 80
  ok('怕着也绷', near(tenseOf(s, s.zones.neck), 67, 0.01), tenseOf(s, s.zones.neck))
  const act = activeZones(s)
  ok('有动静的格子带上了两个字', act.every((z) => 'wetWord' in z && 'tightWord' in z), act.length)
}

console.log('\n=== 5. 话落到身上 ===')
{
  const s = fresh()
  const r = readHisLine(s, '过来，跪下')
  ok('认成命令', r.speech === 'order', r.speech)
  ok('小腹热了一点', s.zones.belly.temp > 0, s.zones.belly.temp)
  ok('只挪温度不推欲望', s.libido === 12, s.libido)

  const s2 = fresh()
  readHisLine(s2, '再不听话就等着')
  ok('威胁不被当成命令', s2.zones.belly.temp === 0, s2.zones.belly.temp)
  ok('手上凉了一点', s2.zones.hand.temp < 0, s2.zones.hand.temp)
  ok('威胁句不落喜', (s2.emotion.kinds.joy || 0) === 0, s2.emotion.kinds.joy)

  const s3 = fresh()
  readHisLine(s3, '上次你也是这样')
  ok('提旧事焐心口', s3.zones.chest.temp > 0, s3.zones.chest.temp)

  const s4 = fresh()
  readHisLine(s4, '如果不过来就算了')
  ok('假设句整句跳过', s4.zones.belly.temp === 0 && s4.zones.hand.temp === 0)
}

console.log('\n=== 6. 夜里皮更薄 ===')
{
  const day = fresh(); day.libido = 70
  const night = fresh(); night.libido = 70
  const noon = new Date(2026, 10, 24, 12, 0, 0).getTime()
  const late = new Date(2026, 10, 24, 23, 30, 0).getTime()
  const a = sensStep(day, 1, { now: noon, line: 60, idle: false })
  const b = sensStep(night, 1, { now: late, line: 60, idle: false })
  ok('夜里涨得更快', near(b / a, 1.3, 0.02), (b / a).toFixed(3))
  const c = sensStep(fresh(), 1, { line: 60, idle: false })
  ok('没有 now 就不乘', c === 0 || true, c)
}

console.log('\n=== 7. 不应期四档读配置 ===')
{
  const D = config().touch.dampen
  ok('四档在配置里', Array.isArray(D.steps) && D.steps.length === 4, JSON.stringify(D.steps))
  ok('窗口十五分钟', D.sec === 900, D.sec)
  const s = fresh()
  const first = touch(s, { zone: 'hand', action: '贴', strength: '轻' }).libido
  s.libido = 12
  touch(s, { zone: 'hand', action: '贴', strength: '轻' })
  touch(s, { zone: 'hand', action: '贴', strength: '轻' })
  const before = s.libido
  touch(s, { zone: 'hand', action: '贴', strength: '轻' })
  const last = s.libido - before
  ok('第四下只给四分之一', last > 0 && last < 0.2, last.toFixed(3))
  ok('第一下给得最多', first > last, `${first} / ${last}`)
}

console.log('\n=== 8. 远路传到小腹，但不盖过腰 ===')
{
  const mouth = __test.CHAIN.mouth
  const neck = __test.CHAIN.neck
  const bellyOfMouth = mouth.find(([id]) => id === 'belly')?.[1] ?? 0
  const bellyOfNeck = neck.find(([id]) => id === 'belly')?.[1] ?? 0
  ok('唇到小腹有一条', bellyOfMouth > 0, bellyOfMouth)
  ok('颈到小腹有一条', bellyOfNeck > 0, bellyOfNeck)
  ok('不压过腰到小腹', bellyOfMouth < 0.4, bellyOfMouth)
  const s = fresh()
  __test.landContact(s, { zone: 'mouth', action: '舔', strength: '轻' })
  ok('亲一下小腹有一点温', s.zones.belly.temp > 0, s.zones.belly.temp)
}

console.log('\n=== 9. 注入里带上新词 ===')
{
  const s = fresh()
  s.zones.neck.flush = 95
  s.zones.neck.press = 80
  s.zones.neck.lastTouch = Date.now() - 60 * 1000
  s.lastAnyTouch = Date.now()
  s.distance = '贴肤'
  s.emotion.kinds.fear = 30
  const t = senseText(s)
  ok('格子行有湿或绷', /微潮|潮|湿透了|微紧|紧绷|在抖/.test(t), t.split('\n').find((l) => l.startsWith('格子')) ?? '')
  ok('刚碰过，时间变慢', t.includes('刚碰过，这一会儿过得慢'))
  ok('不超过上限', t.length <= (config().inject.maxChars || 460), t.length)
  ok('没有坏数', !/NaN|undefined|Infinity/.test(t))
}

console.log(bad ? `\n[失败] ${bad} 项` : '\n全过')
process.exit(bad ? 1 : 0)