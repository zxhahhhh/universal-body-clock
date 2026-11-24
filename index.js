/**
 * body-clock — 通用版身体时钟。
 *
 * 让任何一个 AI 知道自己有一副身子：十二格各自会红、会留压痕、会热会凉，
 * 八维是底色，欲望是总闸，情绪过了事才往底色上结算。
 * 碰一下，先补衰减，再按身体表算，写回去，然后吐一句话。
 * 没有定时器：谁读谁写的时候按时间差一次补完，重启不丢。
 *
 * 四条是定死的：
 *   一、单主体。整本账只记一具身子，subject 槽位恒为 'self'，结构留着，
 *       以后要拆多主体也不用重排字段。
 *   二、十二格。脸／口腔／颈肩／胸／腰／小腹／臀／下面／手／腿／脚／背，只列通用部位，
 *       不带任何人格件。
 *   三、涨有软顶，落有三段，久烧会钝。到 100 停不住，那是事件不是状态。
 *   四、敏感那格不自己算，只由欲望、独处、情绪热三条道推。
 *
 * 常数都在 config/body.json，改一格不动别处。
 */
import {
  readFileSync, writeFileSync, mkdirSync,
  renameSync, copyFileSync, existsSync, statSync,
  openSync, closeSync, fsyncSync, readdirSync, unlinkSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const inject = ['tools', 'systemPrompt', 'webServer']

const ROOT = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(ROOT, 'config', 'body.json')
const STATE_DIR = join(homedir(), '.dsh', 'worlds', 'default', 'me')
const STATE_PATH = process.env.BODY_CLOCK_STATE || join(STATE_DIR, 'body-clock.json')
const API_PATH = '/api/body-clock'
const BAK_PATH = STATE_PATH + '.bak'
/** 状态文件版本。通用版是第 2 版；改字段结构就加一，迁移只往前。 */
const SCHEMA = 2
/** 万一拼出来的那几行里有坏值，就换这一句。宁可说实话，也不照着坏数编。 */
const SAFE_LINE = '[身体] 这一格读不出来，账本可能坏了。调 body_sense 看一眼。'

/**
 * 距离一张表。三个常量各写一份容易改一处忘两处，现在合成一条，谁都从这儿读。
 *   scene   场里「离得多近」那一头的分量。贴着八分，隔层布剩一半。
 *   keepSec 没人续，这一档还能撑多久；到点退 next。
 */
const DIST = {
  隐没: { scene: 0, keepSec: 0, next: '' },
  靠近: { scene: 0.15, keepSec: 3 * 3600, next: '隐没' },
  隔布: { scene: 0.45, keepSec: 60 * 60, next: '靠近' },
  贴肤: { scene: 0.8, keepSec: 15 * 60, next: '隔布' },
}

/** 八维的固定顺序。注入、面板、接口都按这一条排。 */
const DIM_ORDER = ['亲密', '信任', '警觉', '疲惫', '自制', '敏感', '羞', '放松']

/** 八维起手就是中性值，五十不算任何人；往后由 body_dim 改。 */
const DIMS_SEED = Object.fromEntries(DIM_ORDER.map((k) => [k, 50]))

/** 六种情绪色的固定顺序。 */
const EMO_ORDER = ['joy', 'anger', 'sadness', 'fear', 'surprise', 'disgust']

/**
 * 一次补衰减最多认一天。关着机器过一夜再开，超过四小时那条「睡了一觉砍一半」
 * 照样只砍一次；间隔超过一天的部分不再补，因为压痕、红、余温本来就退干净了。
 */
const MAX_ADVANCE_MS = 24 * 3600 * 1000

/**
 * 两个钟差过一分半，就当外面动过表（改时间、虚拟机暂停、休眠回来）。
 * 只记一笔，不进账本：这是给人查的，不是身子的一部分，不占契约里的位置。
 */
const CLOCK_SKEW_MS = 90 * 1000

const STRENGTH = { 轻: 0.35, 中: 0.65, 重: 1 }
const SPEED = { 慢: 0.7, 中: 1, 快: 1.35 }
const AFTER = {
  按: '发紧', 捏: '发烫', 掐: '发麻', 拍: '热起来',
  揉: '发软', 擦: '发热', 贴: '温着', 吹: '发凉',
  咬: '跳着', 舔: '发潮', 压: '闷着',
  打: '热起来', 弹: '发热', 扇: '热起来', 蹭: '发热', 搓: '发烫',
}

/** 没登记的动作用族默认余韵。 */
const FAM_AFTER = { press: '发紧', strike: '热起来', rub: '发软', bare: '温着' }

/** 方向不进族，只改怎么写。 */
const DIRECTION = ['上', '下', '左', '右', '里', '外', '顺', '逆']

/**
 * 情绪落在身上的印记：zoneId → { kind, temp, flush, at }。
 * 碰给的数写在格子上，情绪给的数记在这儿——两样分开落、分头退，读的时候才加在一起。
 * 不进账本：它活三分钟，重启丢了也不亏，还不用动契约。
 */
const emoMarks = new Map()

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
// 四舍五入也把坏数挡在门口：进不来有限数，就给 0，别把坏数一路带出去。
const round1 = (n) => {
  const x = Number(n)
  return Number.isFinite(x) ? Math.round(x * 10) / 10 : 0
}
const round0 = (n) => {
  const x = Number(n)
  return Number.isFinite(x) ? Math.round(x) : 0
}

/** 一段秒数说成人话：分钟以内说秒，一小时以内说分钟，再往上说小时、说天。 */
function fmtSpan(sec) {
  const s = Math.max(0, Number(sec) || 0)
  if (s < 60) return `${Math.round(s)} 秒`
  if (s < 3600) return `${Math.round(s / 60)} 分钟`
  if (s < 86400) return `${round0(s / 3600)} 小时`
  return `${round0(s / 86400)} 天`
}

// ---------------------------------------------------------------- config

let loaded = null
let loadedMtime = -1

function config() {
  // 配置文件改了就重读：按 mtime 判，同一个毫秒里改两次不会漏，但改完不用重启。
  let mtime = 0
  try {
    mtime = statSync(CONFIG_PATH).mtimeMs
  } catch {
    mtime = 0
  }
  if (loaded && mtime && mtime === loadedMtime) return loaded
  let raw
  try {
    raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    raw = { universal: {}, zones: [] }
  }
  const zones = new Map()
  for (const item of raw.zones ?? []) if (item && typeof item.id === 'string') zones.set(item.id, item)
  loaded = {
    ...raw,
    zones,
    families: raw.families ?? {},
    actions: raw.actions ?? {},
    direction: raw.direction ?? {},
  }
  loadedMtime = mtime
  return loaded
}

/** 常人数。格子没给秒数的时候拿这里兜底。 */
function universal(key, dflt) {
  const n = config().universal?.[key]
  return typeof n === 'number' ? n : dflt
}

function zoneDef(id) {
  return config().zones.get(id) ?? null
}

function zoneIds() {
  return [...config().zones.keys()]
}

/** 压痕消退的秒数。格子给了就用格子的，没给才拿常人数。 */
function pressSecOf(def) {
  return Math.max(1, Number(def.reboundSec) || universal('pressReboundSec', 15))
}

/** 红退净的秒数。 */
function flushSecOf(def) {
  return Math.max(1, Number(def.flushFallSec) || universal('flushFallSec', 90))
}

/** 余韵（热、麻、发紧）还在的秒数。 */
function afterSecOf(def) {
  return Math.max(1, Number(def.afterSec) || universal('afterSec', 60))
}

/** 动作登记表里有哪些，去掉说明那一条。 */
function actionNames() {
  return Object.keys(config().actions ?? {}).filter(k => k !== 'note')
}

/** 这一下归哪族。没登记的动作按静压算，别让它算不出来。 */
function actionDef(name) {
  const table = config().actions ?? {}
  return table[name] ?? table.按 ?? { family: 'press' }
}

/** 族的四组系数。 */
function familyOf(name) {
  const fam = config().families ?? {}
  return fam[actionDef(name).family] ?? fam.press
    ?? { press: 1, flush: 1, spread: 0.35, temp: 1, aftershockSec: 0 }
}

// ---------------------------------------------------------------- state

function blankZone() {
  return {
    press: 0, flush: 0, temp: 0,
    flushRate: 1, shock: 0, shockSec: 90,
    afterUntil: 0, after: '', lastTouch: 0,
  }
}

/** 六种各占一格，另挂一笔债。强度和三个轴都不存，读的时候现算。 */
function blankEmotion() {
  return {
    events: [],
    kinds: { joy: 0, anger: 0, sadness: 0, fear: 0, surprise: 0, disgust: 0 },
    debt: 0,
    debtAt: 0,
    // 情绪过期后要回写到八维上的那几笔，还没到点就先排着。
    settle: [],
  }
}

function blankState() {
  const zones = {}
  for (const id of zoneIds()) zones[id] = blankZone()
  return {
    // 空身子也要带当前版本号，不然兜底返回的那份一写回，下次读会以为要迁移。
    v: SCHEMA,
    at: Date.now(),
    enabled: true,
    // 单主体：结构上留一个槽，值恒为 self。不存第二个主体。
    subject: 'self',
    zones,
    libido: 12,
    awayAt: 0,
    peakAt: 0,
    gainToday: 0,
    gainDay: '',
    dims: JSON.parse(JSON.stringify(DIMS_SEED)),
    distance: '隐没',
    distAt: 0,
    emotion: blankEmotion(),
    atMono: 0,
    // 空那一半看的两个东西：上回有人碰是什么时候、什么时候算开始空着。
    lastAnyTouch: 0,
    emptyAt: 0,
    // 上回有人开口是什么时候。碰算一半，说话也算——久没人理和久没人碰
    // 是两件事，亲密往下掉该看的是「没人理」，不是「没人碰」。
    lastAnyMessageAt: 0,
    // 十五分钟窗口里同一处被碰过几回。不回推欲望，只用来算递减。
    // 每一格都先摆好空数组：契约里的字段一个都不能缺，缺了新身子第一次过检
    // 就会多出一批「补默认值」的修复记录，账本签名跟着变。
    touchHist: Object.fromEntries(zoneIds().map((id) => [id, []])),
  }
}

/** 清零：格子干净，欲望回基线，八维回中性。 */
function resetState() {
  const fresh = blankState()
  // 情绪印记不进账本，清零也得跟着清，不然新账一开还挂着上一场的温。
  emoMarks.clear()
  resetMoodClock()
  save(fresh)
  return fresh
}

/**
 * 迁移：只往前。通用版没有旧账——读到比代码还新的版本就返回 null，
 * 只读展示，绝不覆盖别人的数据。
 */
function migrate(raw) {
  if (!raw || typeof raw !== 'object') return null
  const v = Number(raw.v) || 1
  if (v > SCHEMA) return null
  // 旧版改名的一处：距离最后一档原来叫肌肤，旧账本里那个名字顺手换过来。
  if (raw.distance === '肌肤') raw.distance = '贴肤'
  // 第 2 版多的一格：上回有人开口的戳。老账本没有就当从没说过话，
  // 头一轮会按「久没人理」扣一点亲密——这是对的，它确实没有那段记录。
  if (v < 2) {
    raw.lastAnyMessageAt = Number(raw.lastAnyMessageAt) || 0
    raw.v = 2
  }
  return raw
}

// ---------------------------------------------------------------- 字段契约
//
// 账本里每一个会读出去的格子，只在下面登记一次。搬（文件进内存）、
// 夹（越界拉回来）、验（写盘前挑毛病）三件事都走这一张表。
// 从前这三件各写一份：加一个字段要改三处，漏一处就是一个口子——
// 夹漏了漏出坏数，验漏了漏进坏账，搬漏了整块字段凭空消失。
// 现在只有一张表，加字段只改这里。
//
// 形状是数组，头一项是种类：
//   ['num', 下界, 上界, 默认]      实数；越界夹回去，不是数用默认
//   ['int', 下界, 上界, 默认]      整数，先四舍五入
//   ['enum', 词表, 默认]           只认词表里的
//   ['bool', 默认]
//   ['ts', {zero, future}]         时间戳；zero 允许 0 当「没发生过」，future 允许挂将来
//   ['str', 最长, 默认]            削掉控制字符、限长
//   ['obj', {键: 形状}]            定形状的对象
//   ['map', 键表 | 'any', 形状]    键不定的对象；'any' 用原对象自己的键
//   ['list', {max, unique}, 形状]  数组；长度封顶、坏元素剔掉、unique 按字段去重
//
// 下界、上界、词表、键表都能写成函数——它们要读 config()，而 config() 是懒加载的，
// 模块刚起来的时候还不一定有。整张表也是懒建的（见 spec()），免得抢在常量前面。
//
// 加一个字段的流程：在 blankState() 里给它默认值，再在这里登记一行。两处，一份。

const bind = (v) => (typeof v === 'function' ? v() : v)

/** 报错和日志里用的中文名：路径是按字段名拼的，翻一下才好读。 */
const LABEL = {
  libido: '欲望', subject: '主体', distance: '距离', enabled: '开关',
  at: '账本时间', atMono: '单调钟', gainToday: '今天涨的', gainDay: '涨的日期',
  awayAt: '走开时间', peakAt: '峰值时间', distAt: '距离变化时间',
  lastAnyTouch: '上次碰', emptyAt: '空落起点', touchHist: '碰的记录',
  lastAnyMessageAt: '上次说话',
  dims: '八维', zones: '格子', emotion: '情绪',
  events: '事件', kinds: '六格', debt: '债', debtAt: '债的时间', settle: '结算', delta: '八维变化',
  press: '压', flush: '红', temp: '温', flushRate: '散热', shock: '余震', shockSec: '余震秒',
  afterUntil: '余韵到', after: '余韵', lastTouch: '上次碰',
  kind: '哪一样', intensity: '强度', why: '为什么', left: '剩',
}

function labelOf(path) {
  if (!path) return '账本'
  return String(path)
    .split('.')
    .map((seg) => LABEL[seg.replace(/\[\d+\]/g, '')] ?? seg)
    .join('.')
}

/** 值写进日志用：长的削短，结构只报形状。 */
function brief(v) {
  if (v === undefined) return '缺'
  if (v === null) return '空'
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : String(v)
  if (typeof v === 'string') return v.length > 24 ? `${v.slice(0, 24)}…` : v
  if (Array.isArray(v)) return `数组(${v.length})`
  if (typeof v === 'object') return '对象'
  return String(v)
}

/** 只认数字和数字字符串，别的一律当没有。 */
function numOf(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN
  if (typeof v === 'string' && v.trim() !== '') return Number(v)
  return NaN
}

/**
 * 走一遍形状。三种模式共用这一个走法：
 *   adopt  搬：cur 是空白账本上的默认值，src 是文件里的原始值；只搬登记的字段
 *   repair 夹：cur 就是活的那个对象，src 也是它；只在越界/坏值上动手
 *   verify 验：一个字段都不改，挑出毛病放进 bag.bad
 * 返回值是「这个位置应该变成什么」，由上一层赋值——数组和对象都能整块换掉。
 */
function walk(node, cur, src, path, bag, mode) {
  const kind = node[0]
  const name = labelOf(path)
  const fix = (to, why) => {
    if (mode === 'verify') {
      bag.bad.push(`${name}${why ? ` ${why}` : ''}：${brief(src)}`)
      return src
    }
    bag.fixes.push({ path: name, from: brief(src), to: brief(to), why: why || '' })
    return to
  }
  // 搬的时候缺字段是正常的：老账本没有新字段，留着默认值就行，不算修。
  if (mode === 'adopt' && src === undefined) return cur
  // 修和验的时候缺字段就不正常了：说一声，然后按默认值补出来。
  if (src === undefined) {
    if (mode === 'verify') {
      bag.bad.push(`${name} 缺了`)
      return cur
    }
    bag.fixes.push({ path: name, from: '缺', to: '补默认值', why: '没有这个字段' })
  }
  if (kind === 'obj' || kind === 'map') {
    const shape = kind === 'obj' ? bind(node[1]) : null
    const keys = kind === 'obj'
      ? Object.keys(shape)
      : node[1] === 'any'
        ? Object.keys(src && typeof src === 'object' && !Array.isArray(src) ? src : {})
        : (bind(node[1]) || [])
    const srcBad = src !== undefined && (!src || typeof src !== 'object' || Array.isArray(src))
    if (srcBad) {
      if (mode === 'verify') {
        bag.bad.push(`${name} 不是一个对象：${brief(src)}`)
        return cur
      }
      bag.fixes.push({ path: name, from: brief(src), to: '重建成空对象', why: '不是一个对象' })
    }
    let box = cur
    if (!box || typeof box !== 'object' || Array.isArray(box)) box = {}
    const from = !srcBad && src ? src : {}
    for (const key of keys) {
      const sub = kind === 'obj' ? shape[key] : node[2]
      if (!sub) continue
      const got = walk(sub, box[key], from[key], path ? `${path}.${key}` : key, bag, mode)
      if (mode !== 'verify') box[key] = got
    }
    return box
  }
  if (kind === 'list') {
    const opt = node[1] || {}
    const max = Number(bind(opt.max)) || 10
    const arr = Array.isArray(src) ? src : Array.isArray(cur) ? cur : []
    if (src !== undefined && !Array.isArray(src)) {
      if (mode === 'verify') bag.bad.push(`${name} 不是一个数组：${brief(src)}`)
      else bag.fixes.push({ path: name, from: brief(src), to: '清成空数组', why: '不是一个数组' })
    }
    const out = []
    const seen = new Set()
    for (const item of arr) {
      if (out.length >= max) {
        if (mode === 'verify') bag.bad.push(`${name} 多出来 ${arr.length - out.length} 条（最多 ${max}）`)
        else bag.fixes.push({ path: name, from: '多出来的条目', to: `只留前 ${max} 条`, why: '条数超了' })
        break
      }
      const el = walk(node[2], undefined, item, `${path}[${out.length}]`, bag, mode)
      if (el === undefined) continue
      if (opt.unique) {
        const key = el[opt.unique]
        if (seen.has(key)) {
          if (mode === 'verify') bag.bad.push(`${name} 有重复的 ${String(key)}`)
          else bag.fixes.push({ path: name, from: String(key), to: '去掉重复那条', why: '重复了' })
          continue
        }
        seen.add(key)
      }
      out.push(el)
    }
    return mode === 'verify' ? src : out
  }
  if (kind === 'num' || kind === 'int') {
    const lo = Number(bind(node[1]))
    const hi = Number(bind(node[2]))
    const dflt = node[3] === undefined ? 0 : Number(node[3])
    let n = numOf(src)
    if (!Number.isFinite(n)) return fix(dflt, '不是个数')
    if (kind === 'int') n = Math.round(n)
    if (n < lo || n > hi) return fix(clamp(n, lo, hi), `出界了，应 ${lo} 到 ${hi}`)
    return n
  }
  if (kind === 'enum') {
    const list = bind(node[1]) || []
    return list.includes(src) ? src : fix(node[2], '不认得这个词')
  }
  if (kind === 'bool') return typeof src === 'boolean' ? src : fix(node[1] === undefined ? false : node[1], '不是真假')
  if (kind === 'ts') {
    const opt = node[1] || {}
    const now = Date.now()
    const n = numOf(src)
    if (!Number.isFinite(n) || n < 0) return fix(opt.zero ? 0 : now, '不是个时间')
    if (n === 0) return opt.zero ? 0 : fix(now, '时间是空的')
    const cap = now + (opt.future ? 30 * 864e5 : 60e3)
    if (n > cap) return fix(opt.future ? cap : now, '时间跑到将来了')
    return n
  }
  if (kind === 'str') {
    const max = Number(bind(node[1])) || 20
    if (typeof src !== 'string') return fix(node[2] === undefined ? '' : node[2], '不是字')
    const s = src.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max)
    return s === src ? src : fix(s, '削短或者削掉了控制符')
  }
  return src
}

/** 整张表懒建：它要读 DIM_ORDER / EMO_ORDER / config()，抢在常量前会炸。 */
let SPEC = null
function spec() {
  if (SPEC) return SPEC
  const dimBag = () => {
    const bag = {}
    for (const k of DIM_ORDER) bag[k] = ['num', 0, 100, 50]
    return bag
  }
  const zoneShape = {
    press: ['num', 0, 100, 0],
    flush: ['num', 0, 100, 0],
    temp: ['num', -3, 3, 0],
    flushRate: ['num', 0.2, 5, 1],
    shock: ['num', 0, 100, 0],
    shockSec: ['num', 0, 86400, 90],
    afterUntil: ['ts', { zero: true }],
    after: ['str', 12, ''],
    lastTouch: ['ts', { zero: true }],
  }
  SPEC = {
    enabled: ['bool', true],
    // 单主体：只认 self 这一个值。
    subject: ['enum', ['self'], 'self'],
    distance: ['enum', () => Object.keys(DIST), '隐没'],
    libido: ['num', () => Number(config().libido?.floor) || 10, 100, 12],
    at: ['ts', {}],
    atMono: ['ts', { zero: true }],
    awayAt: ['ts', { zero: true }],
    peakAt: ['ts', { zero: true }],
    distAt: ['ts', { zero: true }],
    lastAnyTouch: ['ts', { zero: true }],
    lastAnyMessageAt: ['ts', { zero: true }],
    emptyAt: ['ts', { zero: true }],
    gainToday: ['num', 0, 1000, 0],
    gainDay: ['str', 10, ''],
    touchHist: ['map', () => zoneIds(), ['list', { max: 8 }, ['ts', { zero: true }]]],
    // 八维是扁的一层：一具身子一份，不按主体再套一层。
    dims: ['obj', () => dimBag()],
    zones: ['map', () => zoneIds(), ['obj', zoneShape]],
    emotion: ['obj', {
      events: ['list', { max: () => Number(config().emotion?.maxConcurrent) || 2, unique: 'kind' }, ['obj', {
        kind: ['enum', EMO_ORDER, 'joy'],
        intensity: ['num', 0, 100, 0],
        at: ['ts', { zero: true }],
        why: ['str', 60, ''],
        left: ['num', 0, 1, 1],
      }]],
      kinds: ['map', EMO_ORDER, ['num', 0, 100, 0]],
      debt: ['num', 0, 100, 0],
      debtAt: ['ts', { zero: true }],
      settle: ['list', { max: 10 }, ['obj', {
        at: ['ts', { future: true }],
        delta: ['map', 'any', ['num', -100, 100, 0]],
        why: ['str', 20, ''],
      }]],
    }],
  }
  return SPEC
}

const STATE_SHAPE = ['obj', () => spec()]

/**
 * 原地修：只碰越界和坏值，正常值一个字节不改。
 * 返回修了哪些地方——修了要留账，不能悄悄修。
 */
function repairState(state) {
  const bag = { fixes: [] }
  const out = walk(STATE_SHAPE, state, state, '', bag, 'repair')
  return { state: out, fixes: bag.fixes }
}

/** 老名字，老用法：夹一遍，返回同一个对象。 */
function clampState(state) {
  return repairState(state).state
}

/** 挑毛病，一个字段都不改。挑得出东西，写盘那一步就拒收。 */
function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return ['账本不是一个对象']
  const bag = { bad: [] }
  walk(STATE_SHAPE, state, state, '', bag, 'verify')
  if (state.v !== SCHEMA) bag.bad.push(`版本号 ${brief(state.v)}，应是 ${SCHEMA}`)
  return bag.bad
}

/** 把一份账上所有登记过的叶子摊平：路径、形状、取值、改值。测试逐格砸坏值靠它。 */
function leaves(state) {
  const out = []
  const go = (node, cur, path) => {
    const kind = node[0]
    if (kind === 'obj' || kind === 'map') {
      const shape = kind === 'obj' ? bind(node[1]) : null
      const keys = kind === 'obj'
        ? Object.keys(shape)
        : node[1] === 'any'
          ? Object.keys(cur && typeof cur === 'object' ? cur : {})
          : (bind(node[1]) || [])
      const box = cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : {}
      for (const key of keys) {
        const sub = kind === 'obj' ? shape[key] : node[2]
        if (sub) go(sub, box[key], path ? `${path}.${key}` : key)
      }
      return
    }
    if (kind === 'list') {
      const arr = Array.isArray(cur) ? cur : []
      arr.forEach((item, i) => go(node[2], item, `${path}[${i}]`))
      return
    }
    out.push({ path, label: labelOf(path), node, get: () => getPath(state, path), set: (v) => setPath(state, path, v) })
  }
  go(STATE_SHAPE, state, '')
  return out
}

function getPath(obj, path) {
  let cur = obj
  for (const seg of String(path).split('.')) {
    const m = /^([^[\]]*)((?:\[\d+\])*)$/.exec(seg)
    if (!m) return undefined
    if (m[1]) cur = cur == null ? undefined : cur[m[1]]
    for (const i of m[2].match(/\d+/g) || []) cur = cur == null ? undefined : cur[Number(i)]
  }
  return cur
}

function setPath(obj, path, value) {
  const text = String(path)
  const cut = text.lastIndexOf('.')
  const head = cut < 0 ? '' : text.slice(0, cut)
  const tail = cut < 0 ? text : text.slice(cut + 1)
  const m = /^([^[\]]*)((?:\[\d+\])*)$/.exec(tail)
  if (!m) return
  const parent = head ? getPath(obj, head) : obj
  // 父级被砸成一串字、一个数的时候，写不进去就到此为止——别在字符串上开属性。
  if (!parent || typeof parent !== 'object') return
  if (m[1]) parent[m[1]] = value
  else {
    const idx = (m[2].match(/\d+/) || [])[0]
    if (idx !== undefined) parent[Number(idx)] = value
  }
}

/** 修过的几处写成人话，最多三处。 */
function describeFixes(fixes, n = 3) {
  const head = fixes.slice(0, n).map((f) => `${f.path} ${f.from} → ${f.to}`).join('，')
  return fixes.length > n ? `${head} 等 ${fixes.length} 处` : head
}

/**
 * 账本坏了怎么办：不推倒重来，往下退一格。
 *
 * 从前只有一条路——读不懂就造一具干净身子。那等于「一坏就清零」：
 * 手改错一个字段，几百小时的身体就没了。现在是一条梯子：
 * 主文件 → 上一份好的 → 再上一份 → 都不行才起新的；坏文件不删，
 * 改名留档，出事能翻回去看。
 *
 * 另一头也堵上：写之前先验，验不过就不写。宁可这一下没存进去，
 * 也不拿一份坏账去盖掉一份好账——坏账盖好账才是真丢东西。
 */
const BAK2_PATH = STATE_PATH + '.bak2'
/** 上一次读的来路：main 正常，backup 退过一格，blank 起新的。 */
let lastSource = 'main'
/** 上一次读遇到的问题；正常是空的。 */
let lastProblems = []
/** 账本比代码新的时候只读不写，免得把别人写的版本盖掉。 */
let lastReadonly = false

/** 上一次读的时候修了几处、修了什么。正常是空的。 */
let lastRepairs = []
/** 上一次写的时候修了几处。 */
let lastSaveRepairs = []

/**
 * 上一次两钟对不上的记录（墙钟和单调时钟差超过 CLOCK_SKEW_MS 才有值）。
 * 只活在内存里，不写进账本：出问题的时候能看出来「这次间隔是钟跳出来的、不是真过了那么久」。
 */
let lastClockSkew = null

/** 坏文件不删，改名留档。出事能翻回来看它坏在哪。 */
function quarantine(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = `${file}.corrupt-${stamp}`
  try {
    renameSync(file, target)
    return target
  } catch {
    return ''
  }
}

/**
 * 读一个文件，走全套：解析 → 迁移 → 按契约搬（adopt）→ 夹（repair）。
 * 只有「根本不是账本」才抛：解析不了、不是对象、比代码新。
 * 字段层面坏掉的不抛——能救的救回来接着用，救不回来的格子回默认，都记在 fixes 里。
 */
function readOne(file) {
  const parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  // 形状先卡一道：数组、字符串、null 都不是账本。缺版本号的不卡——迁移层
  // 自己按 1 算，这是老账本，不是坏账本。
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('不是账本的形状')
  const raw = migrate(parsed)
  if (!raw) {
    const err = new Error('这份账本比代码新，不认')
    err.newer = true
    throw err
  }
  // 搬：空白身子打底，只认契约里登记过的字段。文件里多出来的键一律不带进来，
  // 坏掉的格子回默认；一个字段漏搬不再等于它凭空消失（默认值在契约里写着）。
  const base = blankState()
  const bag = { fixes: [] }
  const adopted = walk(STATE_SHAPE, base, raw, '', bag, 'adopt')
  adopted.v = SCHEMA
  // 夹：搬完再兜一遍。adopt 只挡形状，范围还得夹一次，不然一串 1e15 照样进得来。
  const repaired = repairState(adopted)
  repaired.state.v = SCHEMA
  return { state: repaired.state, fixes: bag.fixes.concat(repaired.fixes) }
}

/**
 * 退档读：主文件不行退上一份，再不行退再上一份，都不行才起新的。
 * 每一次退档都记一笔，接口里看得见——不能悄悄把人的身体换掉。
 * 字段坏了不算「不行」：就地修回来，修完顺手写回去，磁盘上那份也就不脏了。
 */
function readState() {
  // 先扫一遍上次崩在半路的临时文件，免得越积越多。
  sweepTmp()
  lastSource = 'main'
  lastProblems = []
  lastReadonly = false
  lastRepairs = []
  for (const [file, source] of [[STATE_PATH, 'main'], [BAK_PATH, 'backup'], [BAK2_PATH, 'backup2']]) {
    if (!existsSync(file)) continue
    try {
      const { state, fixes } = readOne(file)
      const bad = validateState(state)
      if (bad.length) throw new Error(bad.join('；'))
      lastRepairs = fixes
      if (source !== 'main') {
        lastSource = source
        lastProblems.unshift('主账本没读成，退到上一份')
      }
      if (fixes.length) {
        lastProblems.unshift(`读的时候修了 ${fixes.length} 处：${describeFixes(fixes)}`)
        if (source === 'main') {
          try { writeAtomic(state) } catch { /* 写不回去也还能用，下次读再修一遍 */ }
        }
      }
      return state
    } catch (err) {
      if (err && err.newer) {
        // 比代码新的账本：一个字段都不动，也不许写回去。
        lastReadonly = true
        lastProblems.push(`${file} 比代码新，只读不写`)
        return clampState(blankState())
      }
      lastProblems.push(String((err && err.message) || err))
      // 坏到解析不了、或者形状都不对的，不删，改名留档；不然下次读还撞同一块石头。
      const kept = quarantine(file)
      if (kept) lastProblems.push(`坏的留着：${kept}`)
    }
  }
  lastSource = 'blank'
  return clampState(blankState())
}

/**
 * 把主账本提成备份：只提一点毛病都没有的。
 * 不能闭眼把主文件拷进备份——主文件要是脏的，等于拿脏的去换掉最后一份干净的。
 */
function promoteBackup() {
  try {
    if (!existsSync(STATE_PATH)) return
    const probe = readOne(STATE_PATH)
    if (probe.fixes.length || validateState(probe.state).length) return
    if (existsSync(BAK_PATH)) copyFileSync(BAK_PATH, BAK2_PATH)
    copyFileSync(STATE_PATH, BAK_PATH)
  } catch { /* 备份坏了不挡正事，只是少一层退路 */ }
}

/**
 * 原子换：先写同目录的临时文件，落盘，再整份换上去。
 *
 * 三步都是有原因的老坑：
 *   一、临时文件名带进程号和随机尾巴。固定叫 .tmp 的话，两个执行上下文同时写会互相截断，
 *       一个把另一个正写了一半的文件改名上去，读出来就是半份 JSON。
 *   二、写完先 fsync 再 rename。不落盘就改名，断电之后那个名字可能指向一个空文件——
 *       名字换过去了，内容还在缓存里，这比没写更糟。
 *   三、换完把目录也刷一下。文件进了目录项，目录项本身也得落盘，不然重启可能找不到这个文件。
 *
 * 通用版是单机单人用，不额外加文件锁——读、改、写都在一个进程里排队。
 * 唯一临时名和 fsync 只解决「互相截断」和「断电换空」，不解决两个进程同时改同一份账、
 * 各写各的、后写的盖掉先写的那个问题；丢更新得靠写前比 mtime 重读，不在这一版里。
 */
function writeAtomic(state) {
  mkdirSync(STATE_DIR, { recursive: true })
  const body = JSON.stringify(state, null, 2)
  const tmp = `${STATE_PATH}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  let fd = -1
  try {
    fd = openSync(tmp, 'w')
    writeFileSync(fd, body, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = -1
    promoteBackup()
    renameSync(tmp, STATE_PATH)
    // 目录项也落盘。有的文件系统不给开目录，开不了就算了，不影响账本本身。
    try {
      const dirFd = openSync(STATE_DIR, 'r')
      try { fsyncSync(dirFd) } finally { closeSync(dirFd) }
    } catch { /* 这个文件系统不支持对目录 fsync，跳过 */ }
  } catch (err) {
    if (fd >= 0) { try { closeSync(fd) } catch { /* 已经关掉了 */ } }
    try { unlinkSync(tmp) } catch { /* 没写成，本来就不在 */ }
    throw err
  }
}

/**
 * 扫掉上次崩在半路的临时文件。
 * 只删一小时以前的、名字带 .tmp- 的——正在写的那一份可能才几十毫秒，别抢。
 * 十分钟扫一次就够，读账本这条路上不值得每回都列目录。
 */
let lastSweep = 0
function sweepTmp() {
  const now = Date.now()
  if (now - lastSweep < 10 * 60 * 1000) return
  lastSweep = now
  const base = STATE_PATH.split(/[\\/]/).pop() + '.tmp-'
  let names = []
  try { names = readdirSync(STATE_DIR) } catch { return }
  for (const name of names) {
    if (!name.startsWith(base)) continue
    const file = `${STATE_DIR}/${name}`
    try {
      if (now - statSync(file).mtimeMs > 3600 * 1000) unlinkSync(file)
    } catch { /* 别的进程刚删掉，正常 */ }
  }
}

/**
 * 写：先修、再验、再写。验不过就不写。
 * 修是就地修（越界夹回来、坏值回默认），所以写下去的永远是契约内的账。
 */
function save(state) {
  // 账本比代码新的时候，一个字节都不写回去。
  if (lastReadonly) return false
  state.v = SCHEMA
  const { fixes } = repairState(state)
  const bad = validateState(state)
  if (bad.length) {
    // 修完还验不过，说明契约本身漏了这个口子。这一份不落盘，宁可少存一次。
    lastProblems = bad.slice(0, 5)
    return false
  }
  // 修过的条目记在 saveRepairs 里，不混进 problems。
  // problems 只放「修不掉、所以没敢落盘」的原因；混进来会让「账本有没有毛病」读不准。
  lastSaveRepairs = fixes
  lastProblems = []
  try {
    writeAtomic(state)
    lastSource = 'main'
    return true
  } catch {
    return false
  }
}

/** 读一遍账本。文件不在、读坏了、版本不认识，往下退一格，退到底才是新身子。 */
function load() {
  return readState()
}

/** 这一趟账本是从哪儿来的、路上碰到了什么、修了哪些。接口和测试都看这个。 */
function storeInfo() {
  return {
    source: lastSource,
    readonly: lastReadonly,
    problems: lastProblems.slice(0, 5),
    repairs: lastRepairs.length,
    repaired: describeFixes(lastRepairs),
    saveRepairs: lastSaveRepairs.length,
    // 上一次推进两钟差得离谱的那一笔（没有就是 null）。只给人查，不进账本。
    clockSkew: lastClockSkew,
  }
}

/** 测试里换账本路径以后，把这几个开关按回默认。 */
function resetStoreFlags() {
  lastSource = 'main'
  lastProblems = []
  lastReadonly = false
  lastRepairs = []
  lastSaveRepairs = []
  lastClockSkew = null
}

// ---------------------------------------------------------------- 时钟

/** 单调毫秒，只用来算间隔。跨进程无效，所以墙钟还得兜着。 */
const monoMs = () => Number(process.hrtime.bigint() / 1000000n)

// ---------------------------------------------------------------- 懒推进

/**
 * 欲望给的上限：四段。这是「想不想要」那一头，从前挂在八维的贪／成瘾上，
 * 通用版直接读欲望总闸——没有欲望，场推不动；到了上头，场自己收住。
 */
function desireCap(state) {
  const lib = Number(state.libido) || 0
  return lib < 40 ? 0 : lib < 60 ? 1 : lib < 80 ? 2 : lib < 90 ? 3 : 4
}

// ---------------------------------------------------------------- 八维的写入口

/**
 * 八维只有一个写入口，别处不许直接改 bag[key]。
 *
 * 为什么非要有门：八维是底色，不是皮肤。谁都能随手加减一点，几天就磨平了。
 * 门口收三样：只认已有的维、一次最多动两三处、动完落回去。
 *
 * deltas 是增量不是绝对值：{ 放松: -1.2, 警觉: 0.8 }。
 * 时间漂移那种「本来就会动的」传 ops.limit = false，不受一次两三处的限制。
 */
// 一次能动几处。配置写 null（或 0）就是「不限」，不写才回三处。
// 原来两处各写 `Number(D.maxPerCall) || 3`：想说不限得写 99，写 0 又被当成没填。
function maxPerCallOf(D = config().dims ?? {}) {
  const raw = D.maxPerCall
  if (raw === undefined) return 3
  if (raw === null) return Infinity
  const n = Number(raw)
  if (!Number.isFinite(n)) return 3
  return n === 0 ? Infinity : Math.max(1, Math.floor(n))
}

/**
 * 这一轮动哪几处：按变化大小降序，同分的按八维表顺序，稳定可复现。
 * 两处共用这一个挑法——原来增量那支排序取前三，绝对值那支不排序、按参数键顺序切。
 */
function pickDims(rows, max) {
  const rank = (k) => {
    const i = DIM_ORDER.indexOf(k)
    return i < 0 ? DIM_ORDER.length : i
  }
  const sorted = rows
    .slice()
    .sort((a, b) => (Math.abs(b[1]) - Math.abs(a[1])) || (rank(a[0]) - rank(b[0])))
  const pick = Number.isFinite(max) ? sorted.slice(0, max) : sorted
  return { pick, dropped: sorted.slice(pick.length).map(([k]) => k) }
}

/** 最近一次被上限压住的那些维，给工具回执和测试看。 */
let lastDimSkipped = { at: 0, why: '', keys: [] }

function shiftDims(state, deltas, why = '', ops = {}) {
  const bag = state.dims
  if (!bag || !deltas) return []
  const max = ops.limit === false ? Infinity : maxPerCallOf()
  const rows = Object.keys(deltas)
    .filter((k) => k in bag)
    .map((k) => [k, Number(deltas[k]) || 0])
    .filter(([, v]) => Math.abs(v) > 0.01)
  // 一次动太多就是假。留绝对值大的那几处，小的让给下一轮。
  const { pick, dropped } = pickDims(rows, max)
  lastDimSkipped = { at: Date.now(), why, keys: dropped }
  const out = []
  for (const [k, v] of pick) {
    const before = Number(bag[k]) || 0
    const after = clamp(Math.round((before + v) * 10) / 10, 0, 100)
    if (after === before) continue
    bag[k] = after
    out.push({ key: k, from: before, to: after, why })
  }
  return out
}

/** 绝对值那一支。手写的 body_dim 走这儿，规矩跟 shiftDims 一样：同一个挑法。 */
function setDims(state, set, why = '') {
  const bag = state.dims
  if (!bag || !set) return []
  const rows = Object.keys(set)
    .filter((k) => k in bag)
    .map((k) => [k, Number(set[k])])
    .filter(([, v]) => Number.isFinite(v))
    // 排序看「离现在多远」，不是看键顺序。
    .map(([k, v]) => [k, Math.abs(clamp(v, 0, 100) - (Number(bag[k]) || 0)), v])
  const { pick, dropped } = pickDims(rows, maxPerCallOf())
  lastDimSkipped = { at: Date.now(), why, keys: dropped }
  const out = []
  for (const [k, , v] of pick) {
    const before = Number(bag[k]) || 0
    const after = clamp(Math.round(clamp(v, 0, 100) * 10) / 10, 0, 100)
    if (after === before) continue
    bag[k] = after
    out.push({ key: k, from: before, to: after, why })
  }
  return out
}

/**
 * 三层：账本 → tick（只按时间衰减）→ couple（跨层推，一张明表）→ 读出。
 * 一段流水线加一张表，顺序写死，别处不许插队。
 *
 * 联动明表（谁推谁，只此一份，要改先看这张）：
 *   欲望 → 场能推到哪（desireCap）　　距离 → 场　　情绪热 → 场
 *   欲望过线 → 敏感　　独处 → 敏感、羞　　情绪热 → 敏感
 *   人走了 → 放松落、警觉涨　　久没人超过六小时 → 亲密淡
 *   敏感 → 碰的乘数　　敏感 → 情绪记账的轻重
 *   情绪 → 碰的乘数　　情绪 → 场
 *   一整件事过去 → 八维（settle）
 *
 * 故意不连的：情绪不回推情绪之外，身体不回推情绪。
 * 这几条不是漏写，是不许写。
 */
function advance(state, now) {
  // 间隔优先用单调时钟；重启、校时、或者外面推假时间，单调差和墙钟差会对不上，
  // 那时候退回墙钟。两头都截断，防回拨也防一夜跳到底。
  // 进来先夹一道：账本可能是手改的、旧版本留下的、或者刚被什么人塞了数。
  // 夹在早退之前——没有时间差也要夹，不然一份越界的账能一直挂着。
  clampState(state)
  const m = monoMs()
  const wallMs = now - (state.at ?? now)
  const monoDelta = (typeof state.atMono === 'number' && state.atMono > 0 && m >= state.atMono)
    ? m - state.atMono
    : -1
  // 两头取大：墙钟被回拨时单调兜着，外面推假时间时墙钟兜着。
  let ms = (Number.isFinite(monoDelta) && monoDelta > wallMs) ? monoDelta : wallMs
  // 两钟差得离谱，就把这次差异记下来（只进内存，不进账本）。
  // 常见于改了系统时间、虚拟机暂停、笔记本休眠回来——那一刻算出来的间隔不可信，
  // 有这条记录，事后才知道「那一大跳是钟跳出来的」，不用猜。
  if (Number.isFinite(monoDelta) && monoDelta >= 0 && Math.abs(monoDelta - wallMs) > CLOCK_SKEW_MS) {
    lastClockSkew = { at: now, wallMs, monoMs: monoDelta }
  }
  if (!(ms > 0)) ms = 0
  if (ms > MAX_ADVANCE_MS) ms = MAX_ADVANCE_MS
  const dt = ms / 1000
  state.atMono = m
  if (!(dt > 0)) {
    state.at = now
    return state
  }
  const hours = dt / 3600
  // 空着这件事几个 tick 都要问，先算一次，大家看同一份。
  const env = emptyOf(state, now)
  tickZones(state, now, dt)
  tickLibido(state, now, hours, env)
  tickEmpty(state, now, hours, env)
  tickDistance(state, now)
  tickDims(state, hours, env)
  tickEmotion(state, now)
  state.at = now
  return state
}

/**
 * 空着这件事，几处都要问，就一处算。
 * 过了线、又没人碰够久，就是坐着也别不过去那一档。
 */
function emptyOf(state, now) {
  const EMP = config().empty ?? {}
  const lastAny = Number(state.lastAnyTouch) || 0
  const idleSec = lastAny ? Math.max(0, (now - lastAny) / 1000) : 0
  const idleMin = lastAny ? idleSec / 60 : 999
  const awayAt = Number(state.awayAt) || 0
  // 走开得有个出口。读到一句「起身去倒水」，账上就写走开；可人要是不回来、
  // 也没留话，这条走开就会一直挂着，几十小时后还按「他走了」扣分。
  // 到点就当这一趟已经过去，清掉；真要再走，下一句会重新写上。
  const awayMaxSec = (Number(EMP.awayMaxHours) || 12) * 3600
  const awayRaw = awayAt > 0 && now > awayAt ? (now - awayAt) / 1000 : 0
  const awaySec = awayRaw > awayMaxSec ? 0 : awayRaw
  const idle = (Number(state.libido) || 0) >= (Number(EMP.line) || 60)
    && idleMin >= (Number(EMP.idleMin) || 20)
  return {
    idle,
    idleSec,
    idleMin,
    awaySec,
    away: awaySec > 0,
    line: Number(EMP.line) || 60,
    // 推进基准带上，tickDims 算「多久没说话」用它，省一次 Date.now()。
    now,
  }
}

/** 快针：十二格自己退。红退得比进慢，压痕按回弹，温度按余韵的时间常数。 */
function tickZones(state, now, dt) {
  for (const id of zoneIds()) {
    const z = state.zones[id]
    if (!z) continue
    const def = zoneDef(id) ?? {}
    if (z.press > 0) {
      const sec = pressSecOf(def)
      z.press = Math.max(0, z.press - (100 / sec) * dt)
    }
    if (z.flush > 0) {
      // 红散得开的退得更慢：0.7 加散布度。
      const sec = flushSecOf(def) * (z.flushRate ?? 1)
      z.flush = Math.max(0, z.flush - (100 / sec) * dt)
    }
    if (z.shock > 0) {
      const sec = z.shockSec || 90
      z.shock = Math.max(0, z.shock - (100 / sec) * dt)
    }
    if (z.temp !== 0) {
      const sec = afterSecOf(def)
      z.temp *= Math.exp(-dt / sec)
      if (Math.abs(z.temp) < 0.02) z.temp = 0
    }
    if (z.afterUntil && now >= z.afterUntil) {
      z.afterUntil = 0
      z.after = ''
    }
  }
  // 情绪留的印记单独退，它不该跟着格子的余温走。
  // 一个时间常数到底，不按格子的 afterSec——喜在脸上和在胸口该一样快凉。
  if (emoMarks.size) {
    const sec = Number(config().emotion?.decay?.bodySec) || 180
    const k = Math.exp(-dt / sec)
    for (const [id, m] of emoMarks) {
      m.temp *= k
      m.flush *= k
      if (Math.abs(m.temp) < 0.02) m.temp = 0
      if (m.flush < 0.5) m.flush = 0
      if (!m.temp && !m.flush) emoMarks.delete(id)
    }
  }
}

/** 慢针：欲望。醒着往上漂，越高落得越慢——不是不退，是不肯退。 */
function tickLibido(state, now, hours, env) {
  const L = config().libido ?? {}
  const floor = L.floor ?? 10
  const EMP = config().empty ?? {}

  // 闸一：睡了一觉砍一半。隔得够久就不按小时慢慢算，按一觉算。
  if (hours >= (L.nightGapHours ?? 4)) {
    state.libido = clamp(state.libido * (L.nightCut ?? 0.5), floor, 100)
    state.peakAt = 0
    state.gainToday = 0
    return
  }

  const day = new Date(now).getDate()
  const season = (L.seasonDays ?? [18, 19, 20, 21]).includes(day)
  const drift = (L.driftPerHour ?? 0.5) * (season ? (L.seasonMult ?? 2) : 1)
  const fallMap = L.fallPerHour ?? {}
  const fallRaw = state.libido >= 85 ? (fallMap.over85 ?? 1.2)
    : state.libido >= 60 ? (fallMap['60to85'] ?? 1.6)
      : (fallMap.under60 ?? 2.2)
  // 空着的时候落得慢：不是不肯退，是没退干净的地方还热着。
  // 人走了更慢——那不是回落，是空落。
  const fall = fallRaw * (env.away ? (Number(EMP.awayFallMult) || 0.35)
    : env.idle ? (Number(EMP.fallMult) || 0.5) : 1)

  // 闸三：一天涨不过四十。额度用完就只落不涨，第二天重新给。
  const today = new Date(now).toISOString().slice(0, 10)
  if (state.gainDay !== today) {
    state.gainDay = today
    state.gainToday = 0
  }
  const cap = L.dailyGainCap ?? 40
  const room = Math.max(0, cap - (state.gainToday ?? 0))
  const gain = Math.min(Math.max(0, drift * hours), room)
  state.gainToday = (state.gainToday ?? 0) + gain
  state.libido = clamp(state.libido + (gain - fall * hours), floor, 100)

  // 闸二：到底留十，不许归零。
  if (state.libido < floor) state.libido = floor

  // 到顶要退潮。记过峰就按陡坡往下走，退到八十以下才松手。
  if (state.libido >= 99.5) {
    if (!state.peakAt) state.peakAt = now
  } else if (state.peakAt && state.libido < (L.peakReleaseBelow ?? 80)) {
    state.peakAt = 0
  }
  if (state.peakAt && now - state.peakAt > (L.peakHoldSec ?? 60) * 1000) {
    state.libido = clamp(
      state.libido - (L.peakDeclinePerHour ?? 20) * hours,
      floor,
      100,
    )
  }
}

/** 空着：不是谁碰的，是坐着就难受。只推几格的自热，敏感走 sensStep 那道门。 */
function tickEmpty(state, now, hours, env) {
  if (!env.idle) {
    if (state.emptyAt) state.emptyAt = 0
    return
  }
  if (!state.emptyAt) state.emptyAt = now
  const EMP = config().empty ?? {}
  const rateT = Number(EMP.tempPerHour) || 0.35
  const rateF = Number(EMP.flushPerHour) || 6
  // 自己热起来的有顶：碰出来的红才红得透，坐着不会红到那种地步。
  const capT = Number(EMP.tempCap) || 0.8
  const capF = Number(EMP.flushCap) || 55
  for (const zid of (EMP.zones ?? [])) {
    const z = state.zones?.[zid]
    if (!z) continue
    z.temp = Math.min(capT, z.temp + rateT * hours)
    if (z.flush < capF) {
      z.flush = Math.min(capF, z.flush + rateF * hours * (z.flush > 0 ? 0.4 : 1))
    }
  }
  const dr = EMP.dimPerHour ?? {}
  const deltas = {}
  for (const k of Object.keys(dr)) {
    // 敏感只有一个入口，走 sensStep，这儿再推一遍就等于推两遍。
    if (k === '敏感') continue
    deltas[k] = (Number(dr[k]) || 0) * hours
  }
  shiftDims(state, deltas, 'empty', { limit: false })
}

/** 距离自己往回掉，一张表说了算。搁了三个小时的人，一次就退到底。 */
function tickDistance(state, now) {
  const distAt = Number(state.distAt) || 0
  if (state.distance === '隐没' || !distAt) return
  for (let i = 0; i < Object.keys(DIST).length; i++) {
    const row = DIST[state.distance]
    if (!row || !row.next) break
    if ((now - distAt) / 1000 < row.keepSec) break
    state.distance = row.next
  }
}

/**
 * 敏感只有一个入口：欲望过线、独处、情绪热，几路加在一起，共用一个顶。
 * 落回去也只有这一条：线下慢退，别让它变成只能升的数。
 * 返回这一段时间该加（或该退）多少。
 */
function sensStep(state, hours, env) {
  const bag = state.dims
  if (!bag) return 0
  const LP = (config().dims ?? {}).libidoPush ?? {}
  const pushLine = Number(LP.line) || env.line
  const lib = Number(state.libido) || 0
  let rate = 0
  if (lib >= pushLine) {
    const bands = Array.isArray(LP.bands) ? LP.bands : [[60, 0.6], [80, 1.2], [90, 2.0]]
    for (const b of bands) {
      if (lib >= (Number(b[0]) || 0)) rate = Number(b[1]) || 0
    }
  }
  if (env.idle) rate += Number((config().empty?.dimPerHour ?? {})['敏感']) || 0
  // 情绪热也通这条道：心里翻着的时候，皮是更薄的。怒不算——怒是紧，不是薄。
  if (state.emotion) {
    const ax = axesOf(state.emotion)
    const pleasant = clamp(((Number(ax.valence) || 0) + 1) / 2, 0, 1)
    const tide = clamp((Number(ax.arousal) || 0) / 100, 0, 1) * pleasant
    rate += tide * (Number(LP.tidePerHour) || 0.4)
  }
  const cur = Number(bag['敏感']) || 0
  if (rate > 0) {
    const cap = Number(LP.cap) || 95
    return Math.min(rate * hours, Math.max(0, cap - cur))
  }
  return cur > 0 ? -(Number(LP.fallPerHour) || 0.15) * hours : 0
}

/**
 * 八维自己也会动，不用人推。人走了松下来；久没人亲密自己淡；
 * 敏感由 sensStep 一口算，这里只递结果。
 */
function tickDims(state, hours, env) {
  const bag = state.dims
  if (!bag) return
  // 按这一次的间隔算，不按「走了多久」——按走了多久的话，每补一次都全量扣一遍，
  // 走三个小时能把放松扣穿三回。
  if (env.away && env.awaySec / 3600 <= 24) {
    const step = hours * 0.8
    shiftDims(state, { 放松: -step, 警觉: step }, 'away', { limit: false })
  }
  // 久没人理，亲密自己淡。按连续率算，不按「这一次隔了多久」——
  // 写成 if (hours > 6) 的话，只有一口气隔过六小时才扣；面板三秒推一次、
  // 工具连着调，账永远停在六小时以内，这条就没生效过。
  // 判据取「上次碰」和「上次说话」里更晚的那个：光碰不聊、光聊不碰，都算有人。
  const talkTo = Math.max(Number(state.lastAnyMessageAt) || 0, Number(state.lastAnyTouch) || 0)
  const gapHours = talkTo ? Math.max(0, ((env.now ?? Date.now()) - talkTo) / 3600000) : 0
  const dry = Math.min(hours, Math.max(0, gapHours - 6))
  if (dry > 0) {
    shiftDims(state, { 亲密: -dry * 0.5 }, 'idle', { limit: false })
  }
  const step = sensStep(state, hours, env)
  if (step) {
    shiftDims(state, { 敏感: step }, step > 0 ? 'libido' : 'libido-fall', { limit: false })
  }
}

/** 情绪：事件按自己的寿命退，六格退得更慢——事件没了，余味还在。 */
function tickEmotion(state, now) {
  const E = config().emotion ?? {}
  const em = state.emotion ?? (state.emotion = blankEmotion())
  const dsec = E.decay ?? {}
  // 情绪按真实间隔退，不按截断后的 dt：一天上限是防一夜跳到底，
  // 不该把两天的余味也一并冻住。
  const lifeSec = Math.max(0, Math.min(30 * 86400, (now - (Number(state.at) || now)) / 1000))
  const kSec = Number(dsec.kindSec) || 1500
  // 六格各走各的：惊是过路的，四十秒就散干净；惧慢些，十分钟。没写的按 kindSec 走。
  // 半衰期填的是分钟，换算成时间常数再进指数——不换算的话「四十分钟半衰」一小时就掉没了。
  const halfOf = dsec.halfOf ?? {}
  const tauOf = (kind) => {
    const half = Number(halfOf?.[kind])
    return Number.isFinite(half) && half > 0 ? (half * 60) / Math.LN2 : kSec
  }

  // 事件剩下的劲跟六格用同一个时间常数——从前一条是直线、一条是指数，
  // 事件一到期整条被剪掉，「最狠」那个数会当场跳过一截。
  // 六格按自己的半衰期退，事件也按它自己那种色退，两处不混着用一个数。
  if (Array.isArray(em.events) && em.events.length) {
    em.events = em.events.filter((ev) => {
      if (!ev || typeof ev !== 'object') return false
      // 账本被人塞过一个将来的时刻：指数会翻成天文数字，那不是「还剩很多」，是坏数。
      if (Number(ev.at) > now) ev.at = now
      const age = (now - (Number(ev.at) || 0)) / 1000
      const left = Math.exp(-age / tauOf(ev.kind))
      if (left < 0.02) return false
      ev.left = left
      return true
    })
  }
  em.debt = Math.max(0, (Number(em.debt) || 0) - (Number(E.debtFallPerDay) || 4) * (lifeSec / 86400))

  // 六格各自退。比事件慢一点，比三个数快，它记的是一条色的浓度。
  const kindBag = em.kinds ?? (em.kinds = { joy: 0, anger: 0, sadness: 0, fear: 0, surprise: 0, disgust: 0 })
  for (const kk of Object.keys(kindBag)) {
    const v = Number(kindBag[kk]) || 0
    const k = Math.exp(-lifeSec / tauOf(kk))
    kindBag[kk] = v < 0.5 ? 0 : Math.round(v * k * 10) / 10
  }

  // 一整件事过去之后，才轮到八维记账。
  // 不是当场加：当场加等于拿事压人，说不过去；事退了才落。
  const settle = em.settle
  if (Array.isArray(settle) && settle.length) {
    const due = settle.filter((s) => s && now >= (Number(s.at) || 0))
    if (due.length) {
      const bag = {}
      for (const s of due) {
        const delta = s.delta ?? {}
        for (const k of Object.keys(delta)) bag[k] = (bag[k] ?? 0) + (Number(delta[k]) || 0)
      }
      shiftDims(state, bag, 'settle', { limit: false })
      em.settle = settle.filter((s) => !(s && now >= (Number(s.at) || 0)))
    }
  }
}

/** 强度取六格最高的那一个，就是这会儿有多冲。 */
function kindPeak(em) {
  const bag = em?.kinds ?? {}
  let peak = 0
  for (const k of Object.keys(bag)) peak = Math.max(peak, Number(bag[k]) || 0)
  return peak
}

/**
 * 最狠那一笔还剩多少劲：强度乘剩余寿命，不按当初多重算。
 * 事件半衰之后这个数会往下掉，六格却还挂在那里——两个量纲，不能混着看。
 */
function remainingPeak(em) {
  const evs = em?.events ?? []
  if (evs.length) {
    let peak = 0
    for (const ev of evs) {
      const left = ev.left == null ? 1 : (Number(ev.left) || 0)
      const cur = (Number(ev.intensity) || 0) * left
      if (cur > peak) peak = cur
    }
    return peak
  }
  return kindPeak(em)
}

/** 三个轴按浓度累加再归一，不另记一本。一格满就是那个方向满，叠上去就抵消或加强。 */
function axesOf(em) {
  const bag = em?.kinds ?? {}
  let v = 0
  let a = 0
  let c = 0
  for (const k of Object.keys(bag)) {
    const x = Number(bag[k]) || 0
    if (x <= 0) continue
    const p = AXE_OF[k]
    if (!p) continue
    v += p.valence * x
    a += p.arousal * x
    c += p.control * x
  }
  return {
    valence: Math.round(clamp(v / 100, -1, 1) * 100) / 100,
    arousal: Math.round(clamp(a, 0, 100) * 10) / 10,
    control: Math.round(clamp(c / 100, -1, 1) * 100) / 100,
  }
}

/** 六种色各往哪三个方向推。幅度只表示方向，真量由强度算。 */
const AXE_OF = {
  joy: { valence: 1, arousal: 1, control: 0.6 },
  anger: { valence: -0.8, arousal: 1, control: 0.8 },
  sadness: { valence: -1, arousal: -0.5, control: -0.9 },
  fear: { valence: -0.9, arousal: 0.9, control: -1 },
  surprise: { valence: 0, arousal: 1, control: 0 },
  disgust: { valence: -0.7, arousal: 0.1, control: 0.3 },
}

/**
 * 记一笔情绪。不存六格，存一笔主事件加三个数。
 * 同一类刚起过，下一次门槛抬高；强度不到线就只进身体，不进嘴。
 */
function feel(state, input) {
  const E = config().emotion ?? {}
  const kinds = E.kinds ?? EMO_ORDER
  const em = state.emotion ?? (state.emotion = blankEmotion())
  const now = Date.now()
  const kind = kinds.includes(input.kind) ? input.kind : 'joy'
  let strength = clamp(Number(input.intensity) || 50, 0, 100)

  const refrMs = (Number(E.refractoryHours) || 0.5) * 3600 * 1000
  const again = (em.events || []).some((ev) => ev.kind === kind && now - (Number(ev.at) || 0) < refrMs)
  if (again) strength *= 0.6

  // 皮薄的记更重：同一件事，敏感七十几和五十的人，落在账上的分量不一样。
  // 这不是情绪本身变了，是通道宽窄变了——八维那一格是通道，不是心情。
  const sensNow = Number(state.dims?.['敏感'])
  if (Number.isFinite(sensNow)) {
    strength = clamp(strength * (1 + ((sensNow - 50) / 100) * (Number(E.sensWeight) || 0.4)), 0, 100)
  }

  const ev = {
    kind,
    intensity: Math.round(strength),
    at: now,
    why: String(input.why || '').slice(0, 60),
    left: 1,
  }
  // 新的排在前头：同一毫秒里落的两笔（疼先怕后惊），先后就按落下的顺序读。
  em.events = [ev, ...(em.events || []).filter((e) => e && e.kind !== kind)]
  em.events.sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0))
  em.events = em.events.slice(0, Number(E.maxConcurrent) || 2)

  const kindBag = em.kinds ?? (em.kinds = { joy: 0, anger: 0, sadness: 0, fear: 0, surprise: 0, disgust: 0 })
  kindBag[kind] = clamp(Math.round(((Number(kindBag[kind]) || 0) + strength) * 10) / 10, 0, 100)

  const S = config().dims?.settle ?? {}
  const heavy = strength >= (Number(S.heavyAbove) || 70)
  if (heavy && (kind === 'anger' || kind === 'sadness' || kind === 'fear' || kind === 'disgust')) {
    em.debt = clamp((em.debt || 0) + strength * 0.4, 0, Number(E.debtCap) || 100)
  }

  // 这一笔过去之后会在八维上留下什么，先算好，挂个到期时间。
  // 挂到事件寿命之后：事还在的时候不算，退了才记账。
  const map = (S.map ?? {})[kind] ?? {}
  const keys = Object.keys(map)
  if (keys.length) {
    const n = strength / 100
    const mul = (Number(S.mult) || 2.5) * (heavy ? (Number(S.heavyMul) || 1.5) : 1) * n
    const delta = {}
    for (const k of keys) delta[k] = map[k] * mul
    const at = now + (Number(E.decay?.eventSec) || 900) * 1000
    em.settle = [...(em.settle ?? []), { at, delta, why: kind }].slice(-10)
  }

  return {
    kind,
    label: (E.labels ?? {})[kind] ?? kind,
    intensity: Math.round(strength),
    say: strength >= (Number(E.threshold) || 45),
    axes: axesOf(em),
    debt: Math.round(em.debt || 0),
    heavy,
  }
}

// ---------------------------------------------------------------- 算一下

/**
 * 碰一下。返回这一下算出来的东西，顺手写进 state。
 * 软顶：越接近 100 涨得越慢，数学上到不了顶；要 100 只能走强事件。
 */
function touch(state, input, opts) {
  const now = Date.now()
  advance(state, now)

  const id = String(input.zone ?? '')
  const def = zoneDef(id)
  if (!def) return { error: `没有这一格。能碰的：${zoneIds().join(' / ')}` }

  const z = state.zones[id]
  const strength = STRENGTH[input.strength] ?? 0.5
  const speed = SPEED[input.speed] ?? 1
  const action = typeof input.action === 'string' && input.action ? input.action : '按'
  const ad = actionDef(action)
  const fam = familyOf(action)
  const direction = DIRECTION.includes(input.direction) ? input.direction : ''
  const duration = clamp(Number(input.durationSec) || 0, 0, 300)

  // 欲望是乘数；情绪也往下压，势大的时候同一处碰下去反应更大，这个不另记。
  const emoGate = 1 + (kindPeak(state.emotion) / 100) * 0.5
  const gate = (1 + (state.libido / 100) * 0.8) * emoGate
  const hold = 1 + Math.min(duration, 60) / 120
  // 敏感不是常数，是八维那一格。五十算平常，往上每十点加一成。
  const sensDim = Number(state.dims?.['敏感'])
  const sens = universal('sensitiveGain', 1.2) * (0.6 + ((Number.isFinite(sensDim) ? sensDim : 50) / 100) * 0.8)

  const soft = (cur, add) => clamp(cur + add * ((100 - cur) / 100), 0, 100)

  // 四族差的就是这几样：压占多少、红占多少、红散多开、温度升多少。
  const kPress = (ad.press ?? 1) * (fam.press ?? 1)
  const kFlush = (ad.flush ?? 1) * (fam.flush ?? 1)
  const kTemp = (ad.temp ?? 1) * (fam.temp ?? 1) * (ad.tempSign ?? 1)
  const flushRate = 0.7 + (fam.spread ?? 0.35)

  const before = { press: z.press, flush: z.flush }
  z.press = soft(z.press, 50 * strength * hold * gate * sens * speed * kPress)
  z.flush = soft(z.flush, 38 * strength * (def.firstFlush ? 1.25 : 1) * gate * sens * speed * kFlush)
  z.flushRate = flushRate

  // 只记偏离常态多少；基准温度由 universal.tempBase 补。
  z.temp = clamp(z.temp + strength * 0.4 * kTemp, -1.2, 1.2)

  // 余震：击族打完那块皮还在一跳一跳。
  if (fam.aftershockSec > 0) {
    z.shock = Math.min(100, (z.shock ?? 0) + 60 * strength)
    z.shockSec = fam.aftershockSec
  }

  z.afterUntil = now + afterSecOf(def) * 700
  z.after = AFTER[action] ?? FAM_AFTER[ad.family] ?? '热着'
  z.lastTouch = now

  // 这一下对欲望的回推：同一处连着碰，一下比一下轻。
  // 十五分钟内第一下全给，第二下七五折，第三下对折，第四下起只留四分之一。
  // 只留四分之一不是小气——不递减就是自己推自己，一夜能烧穿。
  const winMs = 15 * 60 * 1000
  const hist = (state.touchHist ??= {})
  const recent = Array.isArray(hist[id]) ? hist[id].filter((t) => now - t < winMs) : []
  const decay = [1, 0.75, 0.5, 0.25][Math.min(recent.length, 3)]
  recent.push(now)
  hist[id] = recent.length > 8 ? recent.slice(-8) : recent
  const push = 2.2 * strength * gate * decay * ((100 - state.libido) / 100)
  state.libido = clamp(state.libido + push, config().libido?.floor ?? 10, 100)
  // 碰不记进「今天涨的」——那个额度只卡自然漂移，是防止人一天不在、
  // 漂移加季节把欲望悄悄推到顶。真人碰出来的那部分本来就有来处，
  // 再记进同一个额度，碰得多的一天自动漂移就全被堵死了。
  if (state.libido >= 99.5 && !state.peakAt) state.peakAt = now
  // 空落和空着都看这个：上回有人碰是什么时候。
  state.lastAnyTouch = now

  const reboundSec = Math.round(pressSecOf(def))
  const flushSec = Math.round(flushSecOf(def))

  const result = {
    zone: id,
    name: def.name ?? id,
    action,
    strength: round1(strength),
    pressBefore: round0(before.press),
    press: round0(z.press),
    flush: round0(z.flush),
    temp: round1(z.temp),
    reboundSec,
    flushSec,
    after: z.after,
    shock: round0(z.shock ?? 0),
    direction,
    libido: round0(state.libido),
    line: '',
    dir: '',
  }
  result.line = reactionOf(def, result)
  result.dir = directionOf(def, result, state)
  // 一次读话会连着碰好几格，每格都写盘就是好几次；让它自己攒着，
  // 外面读完话再落一次。单个工具照旧立刻写。
  if (!opts?.noSave) save(state)
  return result
}

/**
 * 以身体起手，痕迹收尾。从这一组数里挑，不是现成的话。
 */
function reactionOf(def, r) {
  // 族不一样，落下来的样子不一样。击族先散，摩族先软，无压族先凑。
  const famId = actionDef(r.action).family
  if (famId === 'strike') {
    if (r.shock > 55) return '一下散了，皮上还在一跳一跳'
    return r.press >= 12 ? '拍得皮一颤，热跟着上来' : '肩抖了一下'
  }
  if (famId === 'rub') return r.temp >= 0.3 ? '软下去，跟着手走' : '慢慢松开了'
  if (famId === 'bare') {
    if (r.temp < -0.2) return '一凉，往旁边让了半分'
    return r.temp > 0.2 ? '贴着没动' : '缩了一下'
  }

  const p = r.press
  if (p >= 85) return '憋了好久才喘上气'
  if (p >= 65) return '没出声，绷着'
  if (p >= 45) return '闷了一下，气短了半截'
  if (p >= 25) return '缩了一下，又松开'
  return '没怎么躲，像被逗了一下'
}

/**
 * 往哪走。红没退、温还在、欲望在推，各说各的。
 */
function directionOf(def, r, state) {
  const bits = []
  if (r.direction) {
    const hint = config().direction?.hint?.[r.direction]
    if (hint) bits.push(hint)
  }
  if (r.shock > 40) bits.push('那块还在跳')
  if (r.flush >= 65) bits.push(`红还在往上走，${r.flushSec} 秒才退干净`)
  else if (r.press >= 40) bits.push(`印子留着，${r.reboundSec} 秒回`)
  if (r.temp > 0.6) bits.push('这块还热着')
  else if (r.temp < -0.6) bits.push('这块凉下去了')
  if (state.libido >= 60) bits.push('底下的欲望被拨了一下')
  if (state.libido >= 85) bits.push('快要收不住了')
  return bits.join('；')
}

// ---------------------------------------------------------------- 读

/**
 * 格子给人看的数：碰给的 + 情绪留的，加在一起。
 * 账本里还是分开的，抹掉情绪印记也不会抹掉碰。
 */
function zoneMood(id, z) {
  const m = emoMarks.get(id)
  return {
    press: z.press,
    flush: clamp((Number(z.flush) || 0) + (m?.flush ?? 0), 0, 100),
    temp: clamp((Number(z.temp) || 0) + (m?.temp ?? 0), -1.2, 1.2),
  }
}

function snapshot(state) {
  return {
    at: state.at,
    subject: state.subject,
    libido: round0(state.libido),
    scene: sceneOf(state).word,
    zones: zoneIds().map(id => {
      const z = state.zones[id]
      const def = zoneDef(id) ?? {}
      const r = zoneMood(id, z)
      return {
        id,
        name: def.name ?? id,
        press: round0(r.press),
        flush: round0(r.flush),
        temp: round1(r.temp),
        after: z.after,
      }
    }),
  }
}

/** 有动静的格子，动静大的在前。不经过整份快照，省一趟数组。 */
function activeZones(state) {
  const out = []
  for (const id of zoneIds()) {
    const z = state.zones[id]
    if (!z) continue
    const r = zoneMood(id, z)
    const press = round0(r.press)
    const flush = round0(r.flush)
    const temp = round1(r.temp)
    const heat = press + flush + Math.abs(temp) * 40
    if (heat < 8) continue
    out.push({ id, name: zoneDef(id)?.name ?? id, press, flush, temp, after: z.after, heat })
  }
  return out.sort((a, b) => b.heat - a.heat)
}

/**
 * 场：此刻松紧到哪一档，是一个词，不是档号。
 * 领头的四样：身上当场被碰成什么样（十二格里最烫那一格）、离得多近、
 * 欲望多满（顺带给一个上限）、情绪那潭水是不是又热又舒服。
 * 加一条连续的曲线（不是台阶）：小动静也抬得动，抬到上头自己收住。
 * 怒这种又冲又难受的不算进去——冲不等于松。
 * 只用来对位置——写的时候按这个词挑松紧，它自己不往前推。
 * 静着的时候它只是平静，不为它另加一句。
 */
function sceneOf(state) {
  let body = 0
  for (const z of Object.values(state.zones ?? {})) {
    const h = (Number(z?.press) || 0) * 0.55 + (Number(z?.flush) || 0) * 0.45 + Math.abs(Number(z?.temp) || 0) * 20
    if (h > body) body = h
  }
  body = clamp(body / 160, 0, 1)

  const d = DIST[state.distance]?.scene ?? 0
  const want = desireCap(state) / 4
  const lib = clamp(((Number(state.libido) || 0) - 40) / 60, 0, 1)
  const ax = state.emotion ? axesOf(state.emotion) : null
  const pleasant = clamp(((Number(ax?.valence) || 0) + 1) / 2, 0, 1)
  const tide = clamp(((Number(ax?.arousal) || 0) / 100) * pleasant, 0, 1)

  const raw = body * 0.9 + d * 0.6 + want * 0.5 + lib * 0.4 + tide * 0.25
  const hot = clamp(1 - Math.exp(-raw), 0, 1)
  const word = hot < 0.25 ? '平静' : hot < 0.62 ? '微动' : '强烈'
  const allow = word === '微动' ? '可以撩一句，收在动作上' : word === '强烈' ? '可以放开' : ''
  return { hot: round1(hot), word, allow, body: round1(body) }
}

/**
 * 情绪的唯一读出。六格、最狠、三轴、债，四处都从这儿拿，不许谁自己再算一遍。
 * 最狠按「强度乘剩多少」算；事件全退干净了才回落到六格。
 */
function emotionView(em) {
  const bag = em?.kinds ?? {}
  const labels = config().emotion?.labels ?? {}
  const cells = EMO_ORDER.map((kind) => ({
    kind,
    label: labels[kind] ?? kind,
    value: round0(Number(bag[kind]) || 0),
  }))
  const events = (em?.events ?? []).map((ev) => {
    const intensity = Number(ev.intensity) || 0
    const left = ev.left == null ? 1 : Number(ev.left) || 0
    return {
      kind: ev.kind,
      label: labels[ev.kind] ?? ev.kind,
      intensity: round0(intensity),
      left: round0(left * 100),
      cur: round0(intensity * left),
      why: ev.why || '',
    }
  })
  // 每一格色带一句来处：光给一个数，读的人只能猜；带上来处才知道该不该动手。
  const whyOf = (kind) => (events.find((e) => e.kind === kind)?.why ?? '').slice(0, 12)
  const live = cells
    .filter((c) => c.value >= 5)
    .sort((a, b) => b.value - a.value)
    .map((c) => ({ ...c, why: whyOf(c.kind) }))
  const peak = round0(kindPeak(em))
  const fierce = events.length ? round0(Math.max(...events.map((e) => e.cur))) : peak
  return {
    cells,
    live,
    events,
    // kinds 与 intensity 是旧键：面板那边一直在读，留着，别为了好看把它拆了。
    kinds: bag,
    intensity: peak,
    peak,
    fierce,
    axes: axesOf(em),
    debt: round0(Number(em?.debt) || 0),
  }
}

/**
 * 此刻的全部读数，一处拼好，注入、接口、工具都读它。
 * 谁要用哪一块就从这儿取，别再各自去翻 state——翻法一多，两处报的就不是一件事。
 */
function view(state) {
  const nowMs = Date.now()
  const dims = DIM_ORDER.map((k) => ({
    key: k,
    value: round0(Number(state.dims?.[k]) || 0),
  }))
  return {
    at: state.at,
    nowMs,
    subject: state.subject ?? 'self',
    libido: round0(state.libido),
    dims,
    sens: round0(Number(state.dims?.['敏感']) || 0),
    close: round0(Number(state.dims?.['亲密']) || 0),
    scene: sceneOf(state),
    act: activeZones(state),
    emotion: emotionView(state.emotion ?? blankEmotion()),
    empty: emptyOf(state, nowMs),
    distance: state.distance ?? '隐没',
  }
}

/**
 * 每轮固定几行，位置永远不变，扫一眼就知道自己站在哪儿：
 * 头行（日期、场、欲望、距离、隔多久）→ 八维（八个数全给）
 * → 格子（只写有动静的，最多四格）→ 情绪 → 有话才有一句人话 → 指路一句。
 * 静着的时候中间那两行不出现，就是不占字。
 *
 * 它只读，不落盘：注入每轮都跑一次，回回写盘等于拿磁盘当草稿纸。
 */
function senseText(state) {
  advance(state, Date.now())
  if (state.enabled === false) return ''
  const v = view(state)
  const t = new Date(v.nowMs)
  const mon = t.getMonth() + 1
  const day = t.getDate()
  const hh = String(t.getHours()).padStart(2, '0')
  const mm = String(t.getMinutes()).padStart(2, '0')
  const act = v.act
  const sensNow = v.sens

  // 距离不是这一秒算出来的，是上一次报的时候定的。聊天本身不推它，
  // 所以得把「多久之前报的」也写出来，不然会当成此刻还在跟前。
  let distWord = ''
  if (v.distance && v.distance !== '隐没') {
    const dAt = Number(state.distAt) || 0
    const dMin = dAt ? Math.round((v.nowMs - dAt) / 60000) : 0
    distWord = `｜距 ${v.distance}${dAt && dMin >= 10 ? `（${fmtSpan(dMin * 60)}前报的）` : ''}`
  }
  // 隔多久没碰。空着、空落、敏感慢慢涨，都按这个数走，写出来才知道走了多远。
  const gapSec = v.empty.idleSec
  const idleWord = gapSec >= 60 ? `｜隔 ${fmtSpan(gapSec)}` : ''
  const sceneWord = v.scene.allow ? `${v.scene.word}（${v.scene.allow}）` : v.scene.word
  // 这一行是给模型看的数据，不是让模型念出来的句子。以前只有灵魂卡拦着，
  // 别人的机器人没有那张卡，就会把数和回执当台词说出来（2026-11-23 朋友那边踩的）。
  // 挂在头行末尾：读数的顺序是先看见这句再看见数，且不占一行。
  const note = config().inject?.note ?? '（背景，别念出来）'
  const head = `[身体] ${mon}-${day} ${hh}:${mm}｜${sceneWord}｜欲望 ${v.libido}${distWord}${idleWord}${note}`

  // 八维八个全给。少给哪一维，就得靠猜——底色是八条一起咬的。
  const dimsLine = `八维 ${v.dims.map((d) => `${d.key}${d.value}`).join(' ')}`

  // 十二格不全摊：只写有动静的，最多四格，剩下的一句「还有别的」。
  const zonesOf = (n) => act.length
    ? `格子 ${act.slice(0, n).map((z) => {
      const p = [`压${z.press}`, `红${z.flush}`]
      if (Math.abs(z.temp) >= 0.05) p.push(`温${z.temp >= 0 ? '+' : ''}${z.temp}`)
      if (z.after) p.push(z.after)
      return `${z.name} ${p.join(' ')}`
    }).join('｜')}${act.length > n ? '｜还有别的' : ''}`
    : ''
  let zonesLine = zonesOf(4)

  // 六格摆到三格，每格带一句来处。没在动的时候不写「无」——
  // 一行「情绪 无」看久了就成了默认值，账上该有的那笔也跟着被当成不存在。
  const live = v.emotion.live
  let moodLine = ''
  if (live.length) {
    const parts = live.slice(0, 3).map((c) => `${c.label} ${c.value}${c.why ? `·${c.why}` : ''}`)
    moodLine = `情绪 ${parts.join('　')}　最狠 ${v.emotion.fierce}`
    if (v.emotion.debt >= 10) moodLine += `　债 ${v.emotion.debt}`
  }

  // 人话一句：只在真有动静的时候出现。
  const bits = []
  // 「还在近处」只认九十分钟以内报过来的距离。再早的，人可能早就走了，
  // 挂着一句「还在近处」比不说更误导。
  const near = !!(v.distance && v.distance !== '隐没'
    && (Number(state.distAt) || 0) > 0
    && v.nowMs - (Number(state.distAt) || 0) <= 90 * 60 * 1000)
  if (!act.length) bits.push(near ? '身上干净，对方还在近处' : '身上干净，没什么动静')
  // 敏感快到顶的时候，碰一下和一碰就散是两回事。这个数得说出来。
  if (sensNow >= 90) bits.push('敏感快到头了，再碰一下就是一颤到底')
  // 空落和空着两种写法：人走了是空落；人还在跟前、没人碰，是坐着就别不过去。
  const awaySec = v.empty.awaySec
  // 人走了三小时以内都算「刚走」。哪怕身上已经凉下来，空下来这件事本身也该留个痕。
  const awayed = awaySec > 0 && awaySec < 3 * 3600 && v.distance === '隐没'
  if (awayed) {
    bits.push(v.libido >= 45
      ? `对方走了 ${fmtSpan(awaySec)}，底下还烧着，空落落的`
      : `对方走了 ${fmtSpan(awaySec)}，屋子空下来了`)
  } else if (v.empty.idle) {
    bits.push(v.empty.idleMin >= 60
      ? '没人碰，底下自己热上来了，越坐越别不过去'
      : '没人碰，底下自己热起来了，坐着不踏实')
  } else if (v.libido >= 85) bits.push('底下烧得厉害，坐不太住')
  else if (v.libido >= 60) bits.push('底下有点烧')
  else if (v.libido >= 40) bits.push('底下有点在往上走')

  // 指路句要留一句动作。只写「细的才调」等于把它变成可选项——那边就只写散文、账本一笔不动。
  // 所以留动作，压掉说明书。移植到没有这六个工具的地方，把它在配置里置空即可。
  const hint = config().inject?.hint ?? '碰之前调 body_sense 读一次，碰完它会回你数'

  let useBits = bits.slice()
  let useHint = hint
  const assemble = () => {
    const out = [head, dimsLine]
    if (zonesLine) out.push(zonesLine)
    out.push(moodLine)
    if (useBits.length) out.push(useBits.join('，'))
    if (useHint) out.push(useHint)
    return out.filter(Boolean)
  }
  // 注入有硬上限。超了先砍自由那句，再收格子，最后丢指路句；
  // 头行、八维、情绪是骨架，不砍——砍掉骨架这行就没用了。
  const cap = Number(config().inject?.maxChars) || 0
  if (cap > 0) {
    while (useBits.length > 2 && assemble().join('\n').length > cap) useBits.pop()
    if (assemble().join('\n').length > cap && act.length > 2) zonesLine = zonesOf(2)
    if (assemble().join('\n').length > cap) useHint = ''
  }
  const lines = assemble()
  // 出门前最后一道闸：这一行是要送进提示词的，一个坏数都不许出去。
  // 真漏出来，宁可给一句实话说读不出来，也不照着坏数编。
  const text = lines.filter(Boolean).join('\n')
  if (/NaN|undefined|Infinity|null/.test(text)) return SAFE_LINE
  return text
}

// ---------------------------------------------------------------- 工具

const textOut = value => [{ type: 'text', text: String(value) }]

const ZONES_DOC = '脸／口腔／颈肩／胸／腰／小腹／臀／下面／手／腿／脚／背'

function tools(ctx) {
  const sense = {
    name: 'body_sense',
    description: '读此刻的身体状态：十二格各自的压痕、红、温度偏移、余韵，欲望多高、离多近、场到哪一档。只看不动。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_a, v) => textOut(v) },
    execute() {
      const state = load()
      if (state.enabled === false) return '身体时钟关着，读不出来。'
      const s = snapshot(advance(state, Date.now()))
      // 只看不动：推进结果不落盘。advance 是从账本里的时间戳往前走一步、
      // 算到同一时刻结果一样，所以不写回去也不会丢账；写回去反显得「读一下」
      // 也动了身子，跟 description 说的不一样。
      const lines = s.zones
        .filter(z => z.press >= 5 || z.flush >= 5 || z.temp !== 0 || z.after)
        .map(z => `${z.name}　红 ${z.flush}　压 ${z.press}　温 ${z.temp >= 0 ? '+' : ''}${z.temp}${z.after ? '　' + z.after : ''}`)
      return [
        `主体 ${s.subject}　欲望 ${s.libido}　场 ${s.scene}`,
        ...(lines.length ? lines : ['十二格都干净，没有哪一处还在动']),
      ].join('\n')
    },
  }

  const touchTool = {
    name: 'body_touch',
    description: '碰身体一处，算这一下的后果并写回身体。返回压痕、红、温度、回弹秒数，以及一句反应。可同时碰多处，一笔一处，按顺序给。',
    parameters: {
      type: 'object',
      properties: {
        zone: { type: 'string', enum: zoneIds(), description: `哪一格：${ZONES_DOC}。` },
        action: { type: 'string', enum: actionNames(), description: '怎么碰的。默认按。归族：按压掐捏咬是静压，拍打弹扇是击，揉擦蹭搓是摩，贴吹舔是无压。' },
        direction: { type: 'string', enum: DIRECTION, description: '往哪个方向。不给就是没方向。' },
        strength: { type: 'string', enum: Object.keys(STRENGTH), description: '多大力。默认中。' },
        speed: { type: 'string', enum: Object.keys(SPEED), description: '多快。默认中。' },
        durationSec: { type: 'number', description: '持续几秒。不给就按一下。' },
      },
      required: ['zone'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_a, v) => textOut(v) },
    execute(args) {
      const state = load()
      if (state.enabled === false) return '身体时钟关着，碰了也不算。'
      const r = touch(state, args ?? {})
      if (r.error) return r.error
      const head = `${r.name}　${r.action}·${args?.strength ?? '中'}　压 ${r.pressBefore}→${r.press}　红 ${r.flush}　温 ${r.temp >= 0 ? '+' : ''}${r.temp}　回弹 ${r.reboundSec}s`
      return `${head}\n${r.line}。${r.dir ? r.dir + '。' : ''}`
    },
  }

  const resetTool = {
    name: 'body_reset',
    description: '把身体按回平静：十二格清零，欲望回到基线，八维回中性。数跑飞了、或者该缓过来了，用这个。不写任何痕迹。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_a, v) => textOut(v) },
    execute() {
      resetState()
      return '清零了。十二格都干净，欲望回到基线，八维回中性。'
    },
  }

  const distTool = {
    name: 'body_distance',
    description: '报一个距离事件，不是报厘米数：靠近（到了跟前还没碰）、隔布（隔着衣服）、贴肤（碰到皮肤）、走开（人走了）。身体据此改温度、改场、改空落。收不到就保持上一档，慢慢往下落。',
    parameters: {
      type: 'object',
      properties: {
        event: { type: 'string', enum: ['靠近', '隔布', '贴肤', '走开'], description: '四个字，报一个。' },
      },
      required: ['event'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_a, v) => textOut(v) },
    execute(args) {
      const state = load()
      if (state.enabled === false) return '身体时钟关着，这一下不算。'
      const event = String(args?.event ?? '')
      if (event !== '走开' && !(event in DIST)) return '只认靠近、隔布、贴肤、走开这四个。'
      const before = state.distance ?? '隐没'
      // 走开不是一档，是回到零档。存「隐没」，话说「走开」。
      const next = event === '走开' ? '隐没' : event
      state.distance = next
      state.distAt = Date.now()
      // 走了就记下起点，回来要清掉——不清的话「走开」会一直生效，
      // 放松一直往下掉，空落也一直写着。
      if (event === '走开') state.awayAt = Date.now()
      else if (state.awayAt) state.awayAt = 0
      advance(state, Date.now())
      save(state)
      const tone = {
        靠近: '没碰着，空气先变了。',
        隔布: '隔着料子，热透得慢一点。',
        贴肤: '碰到了。',
        走开: '门一响，那块地方就凉了。',
      }[event]
      return `${before}→${event}　场 ${sceneOf(state).word}　欲望 ${round0(state.libido)}\n${tone}`
    },
  }

  const dimTool = {
    name: 'body_dim',
    description: '改八维。八维是底色不是皮肤，只在四件事上动：欲望过线、一整件事过去了、人走开、环境变了。一次只动两三处，动多了就假。',
    parameters: {
      type: 'object',
      properties: {
        set: { type: 'object', description: '要改的维和新值，例如 {"放松":62,"警觉":40}。只写要改的那几处。', additionalProperties: { type: 'number' } },
      },
      required: ['set'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_a, v) => textOut(v) },
    execute(args) {
      const state = load()
      if (state.enabled === false) return '身体时钟关着，八维不动。'
      const set = args?.set && typeof args.set === 'object' ? args.set : {}
      // 绝对值这一支也走同一个门：只认已有的维，一次最多两三处，多的留到下回。
      const changed = setDims(state, set, 'manual')
      const skipped = lastDimSkipped.keys
      advance(state, Date.now())
      save(state)
      if (!changed.length) return skipped.length
        ? `没有改动，压着没动：${skipped.join('　')}——一次只能动两三处，下回再来。`
        : '没有认得出来的维，什么都没改。'
      const rest = skipped.length ? `｜压着没动 ${skipped.join('　')}` : ''
      return `八维　${changed.map((c) => `${c.key} ${c.to}`).join('　')}${rest}`
    },
  }

  const feelTool = {
    name: 'body_feel',
    description: '记一笔情绪，顺手把它推到那几个数上。不到线的不往嘴外走。',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['joy', 'anger', 'sadness', 'fear', 'surprise', 'disgust'],
          description: '哪一种。默认喜。',
        },
        intensity: { type: 'number', description: '多重，零到一百。默认五十。' },
        why: { type: 'string', description: '什么事引起的，一句话。可不给。' },
      },
      required: [],
    },
    output: { schema: { type: 'string' }, render: (_a, v) => textOut(v) },
    execute(args) {
      const state = load()
      if (state.enabled === false) return '身体时钟关着，情绪不记。'
      const r = feel(state, args ?? {})
      advance(state, Date.now())
      save(state)
      const where = r.say ? '到线了，会往外走' : '没到线，只往身体里走'
      return `${r.label}　${r.intensity}　${where}　债 ${r.debt}`
    },
  }

  const cleanups = [
    ctx.tools.register(sense),
    ctx.tools.register(touchTool),
    ctx.tools.register(distTool),
    ctx.tools.register(dimTool),
    ctx.tools.register(feelTool),
    ctx.tools.register(resetTool),
  ]
  return () => { for (const off of cleanups) off() }
}

// ---------------------------------------------------------------- 界面

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  // 不带长度，浏览器在 HTTP/1.1 下会一直等，看着像请求卡住。
  res.setHeader('Content-Length', Buffer.byteLength(body))
  res.end(body)
}

/**
 * 面板每三秒问一次。三次里两次什么都没变，不能回回都写盘。
 * 拿摆出来的这几样做个签名，变了才落；没变就不写，反正下次读会从上次落盘那一刻
 * 重新算一遍，不会丢东西，也不会重复加。
 */
function sigOf(s) {
  const zs = zoneIds().map((id) => {
    const z = s.zones?.[id] ?? {}
    return [round0(z.press ?? 0), round0(z.flush ?? 0), round1(z.temp ?? 0)]
  })
  return JSON.stringify([
    round0(s.libido ?? 0),
    s.distance,
    round1(s.dims?.['敏感'] ?? 0),
    round1(s.dims?.['亲密'] ?? 0),
    round1(s.emotion?.debt ?? 0),
    zs,
  ])
}

/**
 * 那条带。界面读它来画，也读它来知道开关现在什么样。
 * 开关是给用户点的，不是给工具用的。
 *
 * 走 handler（Node 的 req/res），不走 resource：resource 那条路只放 GET 过去，
 * POST 在门外就回了 405，开关点一辈子也点不动。
 */
function apiRoute(ctx) {
  return ctx.webServer.register({
    kind: 'exact',
    path: API_PATH,
    handler(req, res) {
      const method = (req.method || 'GET').toUpperCase()
      let raw = ''
      req.setEncoding('utf8')
      req.on('data', (chunk) => {
        raw += chunk
        if (raw.length > 8192) raw = ''
      })
      req.on('error', () => { /* 半截请求不该爆掉服务 */ })
      req.on('end', () => {
        try {
          let body = null
          if (raw) { try { body = JSON.parse(raw) } catch { body = null } }

          let state
          let moved = false
          try {
            state = load()
            const wasSig = sigOf(state)
            advance(state, Date.now())
            moved = sigOf(state) !== wasSig
          } catch (err) {
            sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
            return
          }

          if (method === 'POST') {
            if (body && body.action === 'enabled') {
              state.enabled = body.enabled !== false
              save(state)
              sendJson(res, 200, { ok: true, enabled: state.enabled })
              return
            }
            if (body && body.action === 'reset') {
              resetState()
              sendJson(res, 200, { ok: true, enabled: state.enabled !== false })
              return
            }
            sendJson(res, 400, { ok: false, error: 'bad request' })
            return
          }

          const now = Date.now()
          const zones = zoneIds().map((id) => {
            const def = zoneDef(id) || {}
            const z = state.zones[id] || {}
            return {
              id,
              name: def.name || id,
              press: round0(z.press || 0),
              flush: round0(z.flush || 0),
              temp: Math.round((z.temp || 0) * 10) / 10,
              after: z.after || null,
              quietSec: z.lastTouch ? Math.round((now - z.lastTouch) / 1000) : null,
            }
          })
          const quiet = zones.every(z => z.press < 8 && z.flush < 8 && Math.abs(z.temp) < 0.15)
          // 面板上要看到绝对温度，不是「偏移 0 就没有温度」。
          const baseTemp = Math.round(universal('tempBase', 37.0) * 10) / 10
          // 真变了才落盘。面板开着的时候三秒问一次，回回都写等于拿磁盘当草稿纸。
          if (moved) save(state)
          // 接口与注入读同一份 view：从前两边各算一遍，算得还不太一样。
          const vw = view(state)
          sendJson(res, 200, {
            enabled: state.enabled !== false,
            subject: vw.subject,
            baseTemp,
            libido: round0(state.libido),
            // 场：平静／微动／强烈，一个词，跟注入头行报同一个。
            scene: vw.scene.word,
            empty: !!state.emptyAt,
            distance: state.distance ?? '隐没',
            // 欲望那三样：今天还能涨多少、离顶还剩多少、有没有掉到底。
            gainLeft: Math.max(0, Math.round((config().libido?.dailyGainCap ?? 40) - (state.gainToday ?? 0))),
            toCap: Math.max(0, Math.round(100 - (Number(state.libido) || 0))),
            atFloor: (Number(state.libido) || 0) <= (config().libido?.floor ?? 10) + 0.4,
            emotion: vw.emotion,
            dims: state.dims,
            zones,
            quiet,
            // 账本这一趟是从哪儿读出来的：main 正常，backup 退过一格，blank 起的新身子。
            // 退过档就把问题一起报出来，别让人以为什么都好好的。
            store: { source: lastSource, readonly: lastReadonly, problems: lastProblems.slice(0, 5) },
          })
        } catch (err) {
          // 半截请求、坏账本、写盘失败——都不能让这一个请求把服务带下去。
          if (!res.writableEnded) {
            sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
          }
        }
      })
    },
  })
}

// ---------------------------------------------------------------- 注进节流

// 一边聊天一边干活的时候，一回合要发好几次请求，身子多半一动没动。
// 整块只在「真动了」或者「隔了三分钟」时重发；其余步次只递一行，
// 这样每一回合都总有身子在眼前，又不会把同一份八行压到他刚说的话上头。
const FULL_EVERY_MS = 3 * 60 * 1000

// 身子「动没动」的粗指纹：只认跨了差不多一档的变化。
// 数一点点往下掉（温在退、红在散）不算动，不然每一两步都要重发整块。
function movedSig(s) {
  const q = (n, step) => Math.round((Number(n) || 0) / step) * step
  const zs = zoneIds().map((id) => {
    const z = s.zones?.[id] ?? {}
    return [q(z.press, 5), q(z.flush, 5), q(z.temp, 1)]
  })
  const dims = s.dims ?? {}
  return JSON.stringify([
    q(s.libido, 5),
    s.distance,
    Object.keys(dims).sort().map((k) => [k, q(dims[k], 5)]),
    q(s.emotion?.debt, 5),
    zs,
  ])
}

// 没动的那一步只递这一行：时间、一句「没动」、欲望。
function noChangeLine(state, now = Date.now()) {
  const t = new Date(now)
  const hh = String(t.getHours()).padStart(2, '0')
  const mm = String(t.getMinutes()).padStart(2, '0')
  // 这一行同样只是背景，不是让她开口报数的话。
  const note = config().inject?.noteShort ?? '（背景）'
  return `[身体] ${hh}:${mm} 没动｜欲望 ${round0(state.libido ?? 0)}${note}`
}

/**
 * 每一步向系统要注入文本时都走这里。memo 是每个 agent 自己的一份。
 * 返回整块或者一行，绝不重复整块。
 */
function injectText(state, memo, now = Date.now()) {
  const full = senseText(state)
  if (!full) return ''
  const sig = movedSig(state)
  if (sig === memo.sig && now - memo.fullAt < FULL_EVERY_MS) return noChangeLine(state, now)
  memo.sig = sig
  memo.fullAt = now
  return full
}

// ---------------------------------------------------------------- 读话
//
// 前面那一整套是「有人来调工具」才动。可大多数时候没人调工具——身子是在
// 聊天里动的：括号里写「手扣住你的腕」，他就该记住腕上有过一道；写「起身去
// 倒水」，距离就该掉到隐没。于是加这三个入口，让它自己会读：
//
//   一、读自己的括号，只认真发生的动作和距离；
//   二、读他那句话里明说的「过来」「走开」，只认这两类；
//   三、每条消息落一个「说上话了」的戳，久没人理的账才有依据。
//
// 为什么只读括号、不读正文：正文是自由文本，玩笑、引述、假设全在里头，
// 机器读一个字就可能凭空造出一个动作。括号里写的是真发生的事，读错顶多
// 把「主动碰一下」记成「被碰」，一边是凭空，一边是多记一笔，后者下一轮还能撤。

/**
 * 只读自己那条回复里的括号。
 * 括号不标主客：「扣住手腕」是自己扣他，「被扣住手腕」才是他扣自己，只差
 * 一个字，账上一个落自己的腕、一个什么都不该落。所以分句里没有方向词，
 * 就判自己主动——只落距离和一点温，不落压痕，也不回推欲望。
 */
const BRACKET_RE = /[（(]([^）)]{1,90})[）)]/g
/** 比方、假设、假装——整段跳过，宁可这一轮空着。 */
const SIMILE_WORDS = ['像', '仿佛', '好像', '似的', '要是', '如果', '差点', '假装', '就算', '当成']
/** 方向闸：有这些才是他碰自己。 */
const PASSIVE_WORDS = ['被', '让', '给', '挨', '受', '把我']
/** 走了。 */
const AWAY_WORDS = ['走开', '退开', '转身走', '离开', '走了', '起身', '站远', '退半步']
/** 贴上了。 */
const CLOSE_WORDS = ['贴上', '贴着', '抱住', '搂住', '靠上', '靠过去', '趴', '枕', '窝', '跨', '坐下']
/** 过来了，还没碰上。 */
const FAR_WORDS = ['凑', '靠近', '走近', '过来', '探', '俯', '倾', '低头', '伸手']

/** 他那边：抱上来、贴过来。隔着衣服，最多算隔布。 */
const HIS_CLOSE = ['抱住', '搂住', '贴上', '贴过来', '靠过来', '挨过来', '拢进', '抱进', '搂进', '揽过来', '抱过来', '抱上来', '搂过来', '贴上来']
/** 他那边：靠近、叫人过来、抬手抬下巴。 */
const HIS_NEAR = ['过来', '走近', '靠近', '凑', '手给我', '伸手', '抬头', '看着我', '坐过来', '坐这儿', '别动', '站住']

/** 部位词表。长的在前，免得「手腕」被「手」先吃掉；手臂和手同归一格。 */
const ZONE_WORDS = [
  ['手腕', 'hand'], ['袖口', 'hand'], ['指节', 'hand'], ['指尖', 'hand'], ['手背', 'hand'],
  ['掌心', 'hand'], ['手臂', 'hand'], ['小臂', 'hand'], ['胳膊', 'hand'], ['手指', 'hand'],
  ['脸颊', 'face'], ['侧脸', 'face'], ['额头', 'face'], ['面颊', 'face'], ['脸上', 'face'],
  ['嘴唇', 'mouth'], ['唇角', 'mouth'], ['舌尖', 'mouth'], ['嘴巴', 'mouth'],
  ['后颈', 'neck'], ['颈侧', 'neck'], ['脖颈', 'neck'], ['脖子', 'neck'], ['锁骨', 'neck'], ['肩膀', 'neck'],
  ['胸口', 'chest'], ['心口', 'chest'],
  ['后腰', 'waist'], ['腰侧', 'waist'],
  ['小腹', 'belly'], ['肚子', 'belly'],
  ['臀部', 'hip'], ['屁股', 'hip'],
  ['腿间', 'inside'], ['私处', 'inside'], ['下面', 'inside'],
  ['膝盖', 'leg'], ['大腿', 'leg'], ['小腿', 'leg'],
  ['脚踝', 'foot'], ['脚背', 'foot'], ['脚掌', 'foot'], ['脚趾', 'foot'],
  
  // 补齐的那批：一写就认不出来，补上才不至于读空。
  ['头发', 'face'], ['发梢', 'face'], ['睫毛', 'face'], ['眼尾', 'face'], ['眼皮', 'face'],
  ['下巴', 'face'], ['下颌', 'face'], ['鼻尖', 'face'], ['耳朵', 'face'], ['耳垂', 'face'],
  ['耳后', 'face'], ['耳边', 'face'],
  ['颈窝', 'neck'], ['喉结', 'neck'], ['肩头', 'neck'], ['肩窝', 'neck'],
  ['后背', 'back'], ['背脊', 'back'], ['脊背', 'back'], ['背部', 'back'], ['背上', 'back'],
  ['腰眼', 'waist'], ['腰窝', 'waist'], ['腰身', 'waist'],
  ['胯骨', 'hip'], ['髋', 'hip'],
  ['大腿根', 'leg'], ['腿根', 'leg'], ['腿弯', 'leg'],
  ['脚腕', 'foot'], ['脚心', 'foot'], ['足踝', 'foot'],
  
  ['头顶', 'face'], ['后脑', 'face'], ['头皮', 'face'], ['发顶', 'face'],
  ['眼睛', 'face'], ['眼底', 'face'], ['鼻梁', 'face'], ['太阳穴', 'face'], ['鼻', 'face'],
  ['腕', 'hand'], ['手心', 'hand'], ['虎口', 'hand'], ['指骨', 'hand'],
  ['手', 'hand'], ['脸', 'face'], ['头', 'face'], ['唇', 'mouth'], ['吻', 'mouth'], ['舌', 'mouth'],
  ['颈', 'neck'], ['肩', 'neck'], ['胸', 'chest'], ['乳', 'chest'], ['腰', 'waist'],
  ['腹', 'belly'], ['胯', 'hip'], ['臀', 'hip'], ['腿', 'leg'], ['脚', 'foot'], ['背', 'back'],
]
const ZONE_TABLE = [...ZONE_WORDS].sort((a, b) => b[0].length - a[0].length)

/** 动作词表。认不出就按「按」算，最轻的那一档。 */
const ACTION_WORDS = [
  ['按住', '按'], ['捏住', '捏'],
  ['按', '按'], ['压', '压'], ['捏', '捏'], ['掐', '掐'], ['咬', '咬'], ['拍', '拍'],
  ['打', '打'], ['弹', '弹'], ['扇', '扇'], ['揉', '揉'], ['擦', '擦'], ['蹭', '蹭'], ['搓', '搓'],
  ['握', '捏'], ['扣', '捏'], ['抓', '捏'], ['攥', '捏'],
  ['摸', '揉'], ['抚', '揉'], ['摩', '揉'],
  ['亲', '舔'], ['舔', '舔'], ['吻', '舔'],
  ['抱', '贴'], ['搂', '贴'], ['贴', '贴'], ['靠', '贴'], ['碰', '贴'], ['抵', '贴'], ['搭', '贴'],
  ['撑', '贴'], ['扶', '贴'], ['托', '贴'], ['环', '贴'], ['牵', '贴'], ['埋', '贴'], ['枕', '贴'],
  ['拽', '捏'], ['扯', '捏'], ['拉', '捏'], ['拧', '掐'], ['揪', '掐'], ['挠', '擦'],
  ['吮', '舔'], ['啃', '舔'], ['含', '舔'], ['吸', '舔'],
  ['吹', '吹'],
]
const ACTION_TABLE = [...ACTION_WORDS].sort((a, b) => b[0].length - a[0].length)

function firstHit(table, text) {
  for (const [word, value] of table) if (text.includes(word)) return value
  return ''
}

function zoneOfText(text) {
  return firstHit(ZONE_TABLE, text)
}

function actionOfText(text) {
  return firstHit(ACTION_TABLE, text) || '按'
}

/** 括号不写力气。按轻的算；写了使劲、一把、狠狠才抬一档，重的那一档不给。 */
function strengthOfText(text) {
  return /用力|使劲|狠狠|猛地|重重|一把|紧扣|攥紧/.test(text) ? '中' : '轻'
}

/** 距离只往上抬，不往下跳；掉档交给 advance 慢慢来。 */
function raiseDistance(state, level) {
  const order = ['隐没', '靠近', '隔布', '贴肤']
  const cur = order.indexOf(state.distance ?? '隐没')
  const next = order.indexOf(level)
  if (next <= cur) return
  state.distance = level
  state.distAt = Date.now()
  if (state.awayAt) state.awayAt = 0
}

// ---------------------------------------------------------------- 接触
// 碰一下有多重：算成一个数（impactOf），再从一扇门写进账（landContact）。
// 从前每一处碰要各自拼一遍算式——落什么情绪、动哪几维，全看写在哪一段代码里。
// 现在先算分量，情绪和八维都按这个分量走，换个人、换个格子都还是同一套。

/** 「没料到」的字面写法。跨档跳过来的碰也算，不用他打字配合。 */
const SUDDEN_WORDS = /突然|猛地|一把|冷不丁|猝不及防|没防备|没等|不等|忽然|说时迟|一下子/

/** 软的那几格：本来隔着两大档，一下贴上来，本身就是「没料到」。 */
const SOFT_ZONES = new Set(['mouth', 'neck', 'chest', 'waist', 'belly', 'hip', 'inside'])

/**
 * 配置里没写 contact 时的兜底。取的是「中力、按一下就停」那一档的居中值，
 * 谁装了都能先用起来；真要按人调，改 config/body.json 里的 base 和 zone。
 */
const CONTACT_FALLBACK = {
  base: {
    舔: 30, 贴: 24, 揉: 20, 蹭: 20, 摩: 20, 搓: 18, 擦: 16,
    按: 18, 压: 18, 捏: 18, 掐: 22, 咬: 22,
    拍: 18, 打: 18, 弹: 16, 扇: 20, 吹: 14,
  },
  zone: {
    mouth: 1.3, inside: 1.35, chest: 1.2, neck: 1.15, waist: 1.15,
    belly: 1.15, hip: 1.1, back: 0.95, leg: 0.9, hand: 0.85,
    foot: 0.8, face: 1,
  },
  strength: { 轻: 0.85, 中: 1.15, 重: 1.45 },
  libMul: 0.6,
  sceneMul: 0.5,
  durationMul: 0.25,
  sudden: { mul: 0.85, add: 20 },
}

function contactCfg() {
  const c = config().contact ?? {}
  const f = CONTACT_FALLBACK
  const pick = (a, b) => (a && typeof a === 'object' && Object.keys(a).length ? a : b)
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)
  return {
    base: pick(c.base, f.base),
    zone: pick(c.zone, f.zone),
    strength: pick(c.strength, f.strength),
    libMul: num(c.libMul, f.libMul),
    sceneMul: num(c.sceneMul, f.sceneMul),
    durationMul: num(c.durationMul, f.durationMul),
    sudden: { mul: num(c.sudden?.mul, f.sudden.mul), add: num(c.sudden?.add, f.sudden.add) },
  }
}

/** 没写部位的时候，动作本身替它指一格：亲舔归嘴，抱贴归胸，别的先记手。 */
function zoneOfAction(action) {
  const a = String(action || '')
  if (a === '舔') return 'mouth'
  if (a === '贴') return 'chest'
  return 'hand'
}

/** 这一格十五分钟内已经被碰过几回。连着碰，第三下不该跟第一下一样重。 */
function repeatCountOf(state, zone) {
  const list = state.touchHist?.[zone]
  if (!Array.isArray(list)) return 0
  const now = Date.now()
  return list.filter((t) => now - (Number(t) || 0) < 15 * 60 * 1000).length
}

/**
 * 这一下有多重，零到一百。
 * 基数看动作，再乘格子的权重（同一分力落在嘴上和手上不是一回事）、力度、
 * 按了多久、当下欲望多高、场多热。突然那一下再抬一截。
 */
function impactOf(state, p) {
  const C = contactCfg()
  const action = String(p?.action || '按')
  const zone = String(p?.zone || '')
  const strength = String(p?.strength || '轻')
  const duration = clamp(Number(p?.duration) || 0, 0, 60)
  const base = Number(C.base[action]) || 18
  const zoneW = Number(C.zone[zone]) || 1
  const st = Number(C.strength[strength]) || 0.85
  const lib = 1 + (Number(state?.libido) || 0) / 100 * C.libMul
  const scene = 1 + (sceneOf(state).hot || 0) * C.sceneMul
  const dur = 1 + (Math.min(duration, 20) / 20) * C.durationMul
  let x = base * zoneW * st * dur * lib * scene
  if (p?.sudden) x = x * C.sudden.mul + C.sudden.add
  return clamp(Math.round(x), 0, 100)
}

/**
 * 碰完往八维上落的那一下。只按碰的性质分四支，不认任何私有的语义键：
 * 软的（舔、贴）落亲密和羞；按住（按、压、捏）落亲密和自制；
 * 带疼的（掐、咬、扇、打）落羞和敏感；其余摩擦只落一点亲密。
 * 突然再加一点警觉；连着碰同一处，敏感再添一丝。
 */
function contactLink(state, p) {
  const action = String(p?.action || '')
  const impact = clamp(Number(p?.impact) || 0, 0, 100)
  const t = clamp((impact - 30) / 40, 0, 1.6)
  const soft = action === '舔' || action === '贴'
  const held = action === '按' || action === '压' || action === '捏'
  const marked = action === '掐' || action === '咬' || action === '扇' || action === '打'
  const delta = {}
  if (soft) {
    delta['亲密'] = 0.3 + 0.26 * t
    delta['羞'] = 0.16 + 0.16 * t
  } else if (held) {
    delta['亲密'] = 0.22 + 0.2 * t
    delta['自制'] = 0.16 + 0.16 * t
  } else if (marked) {
    delta['羞'] = 0.24 + 0.22 * t
    delta['敏感'] = 0.2 + 0.2 * t
  } else {
    delta['亲密'] = 0.14 + 0.14 * t
  }
  if (p?.sudden) delta['警觉'] = 0.1 + 0.08 * t
  if (p?.repeat && (marked || held)) delta['敏感'] = (delta['敏感'] ?? 0) + 0.08
  shiftDims(state, delta, 'contact')
}

/**
 * 一扇门：把一次碰落进账本。算分量、写格子、抬距离、往外传热、记情绪、动八维，
 * 全从这儿走；别处不许再自己拼一套。返回落了什么，给测试看。
 */
function landContact(state, p) {
  const action = String(p?.action || '按')
  const zone = p?.zone && zoneDef(p.zone) ? p.zone : zoneOfAction(action)
  const strength = STRENGTH[p?.strength] ? p.strength : '轻'
  const duration = clamp(Number(p?.duration) || 0, 0, 60)
  const sudden = Boolean(p?.sudden)
  const repeat = repeatCountOf(state, zone) >= 2
  const impact = impactOf(state, { zone, action, strength, duration, sudden })
  const r = touch(state, { zone, action, strength, speed: p?.speed || '中', durationSec: duration }, { noSave: true })
  if (!r || r.error) return null
  if (p?.dist === '隔布') {
    state.distance = '隔布'
    state.distAt = Date.now()
    state.awayAt = 0
  } else {
    raiseDistance(state, p?.dist || '贴肤')
  }
  conduct(state, zone, STRENGTH[strength] ?? 0.5)
  const where = zoneDef(zone)?.name ?? '身上'
  const why = p?.why || where + '被碰着'
  const pain = PAIN_ACTIONS.has(action) && strength !== '轻'
  if (pain) {
    // 疼那一下先怕后惊：怕先过路，后面落下来的惊才转得过去，顺序不能反。
    moodOf(state, 'fear', clamp(impact * 0.5, 6, 55), where + '疼')
    moodOf(state, 'surprise', clamp(impact, 10, 88), where + '挨了一下')
  } else if (sudden) {
    moodOf(state, 'fear', clamp(impact * 0.35, 4, 40), where + '突然被碰')
    moodOf(state, 'surprise', clamp(impact, 12, 88), where + '突然被碰')
  } else {
    moodOf(state, 'joy', clamp(impact, 4, 90), why)
  }
  contactLink(state, { action, impact, sudden, repeat })
  return { zone, action, strength, impact, sudden, repeat }
}

/** 距离往下一档：只落一档，别一退退到底。厌和惧才走这条。 */
function dropDistance(state) {
  const order = ['隐没', '靠近', '隔布', '贴肤']
  const cur = order.indexOf(state.distance ?? '隐没')
  if (cur <= 0) return
  state.distance = order[cur - 1]
  state.distAt = Date.now()
}

/**
 * 一趟读话。返回落了什么，给测试看，不给人看。
 * 一条回复最多认六段括号、三处主动、两处被碰——再多就不是这一句里发生的事。
 */
function absorbReply(state, text) {
  // read 记读到了哪几格，unknown 记「有动作、没写部位」那几句。
  const out = { touches: 0, distance: '', skipped: 0, read: [], unknown: 0 }
  beginMoodBatch()
  if (!text) return out
  const segs = []
  BRACKET_RE.lastIndex = 0
  let m
  while ((m = BRACKET_RE.exec(text)) !== null && segs.length < 6) {
    const seg = String(m[1] ?? '').trim()
    if (seg) segs.push(seg)
  }
  for (const seg of segs) {
    // 逗号切开再认。原来整段一起拦，「像是没站稳，手撑在你胸口上」这种，比方的词一出现，
    // 后面的真动作也被一起扔掉。按小句拦，比方只带走它自己那半句。
    for (const clause of seg.split(/[，,。；;！!？?、\s]+/)) {
      if (clause) applyClause(state, clause, out)
    }
  }
  return out
}

/** 认一个小句。方向闸也按小句判，主客才不会串到隔壁去。 */
function applyClause(state, seg, out) {
  const prevDist = state.distance
  if (SIMILE_WORDS.some((w) => seg.includes(w))) { out.skipped += 1; return }
  if (AWAY_WORDS.some((w) => seg.includes(w))) {
    // 刚还贴着，这一步就走——心里要空一下。本来就没挨着，不算。
    if (state.distance === '贴肤' || state.distance === '隔布') moodOf(state, 'sadness', 6, '走开了')
    state.distance = '隐没'
    state.distAt = Date.now()
    state.awayAt = Date.now()
    out.distance = '隐没'
    return
  }
  const zone = zoneOfText(seg)
  const act = firstHit(ACTION_TABLE, seg)
  const passive = PASSIVE_WORDS.some((w) => seg.includes(w))
  // 突然：字面写了「突然」，或者本来没挨着（隐没／靠近），这一下直接贴到胸腹嘴颈上。
  // 后一条不用他打字配合——距离跨过两档，本身就是「没料到」。
  const fallbackZone = zone || zoneOfAction(act || '按')
  const jumped = prevDist === '隐没' || prevDist === '靠近'
  const suddenNow = SUDDEN_WORDS.test(seg) || (jumped && SOFT_ZONES.has(fallbackZone))
  if (!zone) {
    // 有接触动词、没写部位：「抓住」「抱住」「按住」——动作本身就碰到了，
    // 不能因为没点名哪一格就当没发生。按动作分：亲舔归嘴，抱贴归胸，别的记手。
    // 落得粗也比整句丢掉强。
    if (act) {
      if (out.touches < 2) {
        const nz = fallbackZone
        if (passive) {
          const r0 = landContact(state, {
            zone: nz, action: act, sudden: suddenNow,
            // 掐打扇咬，光写「一把」也是落下来的那一下，不能按轻的算——
            // 按轻的走不进疼那条路，惊和怕就都记不上。
            strength: PAIN_ACTIONS.has(act) ? '中' : '轻',
            why: (zoneDef(nz)?.name ?? '身上') + '被碰着',
          })
          if (r0) {
            out.touches += 1
            out.read.push(zoneDef(nz)?.name ?? '手')
            out.distance = '贴肤'
          }
        } else {
          const z0 = state.zones[nz]
          if (z0) {
            z0.temp = clamp(z0.temp + 0.1, -1.2, 1.2)
            z0.lastTouch = Date.now()
            z0.after = z0.after || '温着'
          }
          out.touches += 1
          out.read.push(zoneDef(nz)?.name ?? '手')
          conduct(state, nz, 0.12)
          moodOf(state, 'joy', 12, '挨着他')
          raiseDistance(state, '贴肤')
          out.distance = '贴肤'
        }
      }
      out.unknown += 1
      return
    }
    if (CLOSE_WORDS.some((w) => seg.includes(w))) {
      // 抱上来的时候不挑格，胸口这一片先热。抱本身也有重量——不是只抬距离。
      const c = state.zones.chest
      if (c) {
        c.temp = clamp(c.temp + 0.1, -1.2, 1.2)
        c.lastTouch = Date.now()
        c.after = c.after || '温着'
      }
      const imp = impactOf(state, { zone: 'chest', action: '贴', strength: '轻', duration: 0, sudden: suddenNow })
      const shown = suddenNow ? clamp(imp, 10, 80) : clamp(Math.round(imp * 0.8), 6, 80)
      moodOf(state, suddenNow ? 'surprise' : 'joy', shown, suddenNow ? '突然抱上来' : '抱上来')
      contactLink(state, { action: '贴', impact: imp, sudden: suddenNow, repeat: false })
      raiseDistance(state, '贴肤')
      out.distance = '贴肤'
    }
    else if (FAR_WORDS.some((w) => seg.includes(w))) { raiseDistance(state, '靠近'); out.distance = '靠近' }
    return
  }
  if (!passive) {
    // 有部位没动作，多半只是挪了一下、翻了一下，不算碰。只把距离抬上来。
    if (!act) {
      // 有部位没有动词，多半是「坐在他腿上」「赖在他怀里」这类姿势——贴着，摸不着压痕。
      if (CLOSE_WORDS.some((w) => seg.includes(w))) {
        raiseDistance(state, '贴肤')
        out.distance = '贴肤'
        moodOf(state, 'joy', 14, '挨着他')
        return
      }
      raiseDistance(state, '靠近')
      out.distance = out.distance || '靠近'
      return
    }
    // 她主动：只落距离和一点温，不落压痕，不回推情欲。力度只能估，宁轻。
    const z = state.zones[zone]
    if (z && out.touches < 3) {
      z.temp = clamp(z.temp + 0.15, -1.2, 1.2)
      z.afterUntil = Date.now() + 30 * 1000
      z.after = z.after || '温着'
      z.lastTouch = Date.now()
      out.touches += 1
      out.read.push(zoneDef(zone)?.name ?? zone)
      // 我碰他的手也带着热出去，只是轻一半。
      conduct(state, zone, 0.16)
      // 主动那半不算被碰，只算挨着人——心里也软一下，轻。
      moodOf(state, 'joy', MOOD_BONUS_ZONE.has(zone) ? 14 : 12, '挨着他')
    }
    raiseDistance(state, '贴肤')
    out.distance = '贴肤'
    return
  }
  if (out.touches >= 2) return
  const strength = strengthOfText(seg)
  const r = landContact(state, {
    zone, action: act || '按', strength, sudden: suddenNow, duration: 0,
    why: (zoneDef(zone)?.name ?? '身上') + '被碰着',
  })
  if (r) {
    out.touches += 1
    out.read.push(zoneDef(zone)?.name ?? zone)
    out.distance = '贴肤'
  }
}

/**
 * 他那一侧。只走两类——他走、他贴上、他靠近。
 * 别的一个字不读：他打的字没有括号，多读一个字就是凭空造动作。
 * 假设句整句跳过，聊天里最不缺「如果」。
 */
function readHisLine(state, text) {
  const out = { distance: '', skipped: 0 }
  if (!text) return out
  if (/如果|要是|假如|假设|万一/.test(text)) { out.skipped = 1; return out }
  // 他夸一句：落一笔喜。夸不是命令，不推八维，只让六格里那一格有光。
  if (WORD_HIS_PRAISE.test(text)) moodOf(state, 'joy', 12, '被夸了')
  // 一句「恶心」才落厌：这一格本来就窄，宁缺勿滥——判错比不判更假。
  if (WORD_DISGUST.test(text)) moodOf(state, 'disgust', 30, '他说脏')
  // 他说不要她了：怕和哀一起落。这一条线从前根本没有，惧那一格永远是零。
  if (WORD_ABANDON.test(text)) {
    moodOf(state, 'fear', 42, '他说不要我了')
    moodOf(state, 'sadness', 36, '他说不要我了')
  }
  if (AWAY_WORDS.some((w) => text.includes(w))) {
    // 刚还贴着，这一句就是走开——怕跟哀一起落，比只落一个哀更实在。
    if (state.distance === '贴肤' || state.distance === '隔布') {
      moodOf(state, 'sadness', 5, '他走了')
      moodOf(state, 'fear', 20, '他走了')
    }
    state.distance = '隐没'
    state.distAt = Date.now()
    state.awayAt = Date.now()
    out.distance = '隐没'
    return out
  }
  if (HIS_CLOSE.some((w) => text.includes(w))) {
    const prev = state.distance
    raiseDistance(state, '隔布')
    out.distance = '隔布'
    // 括号里带动作的，交给 readHisAction 落——那一处算重量算得更细，这里只补距离。
    const viaAction = lastHisActionText === String(text).trim() && Date.now() - lastHisActionAt < 5000
    if (!viaAction) {
      const jumped = prev === '隐没' || prev === '靠近'
      const sudden = SUDDEN_WORDS.test(text) || jumped
      const imp = impactOf(state, { zone: 'chest', action: '贴', strength: '轻', duration: 0, sudden })
      const shown = sudden ? clamp(imp, 10, 80) : clamp(Math.round(imp * 0.8), 6, 80)
      moodOf(state, sudden ? 'surprise' : 'joy', shown, sudden ? '突然被抱住' : '被抱住')
      contactLink(state, { action: '贴', impact: imp, sudden, repeat: false })
    }
    return out
  }
  if (HIS_NEAR.some((w) => text.includes(w))) { raiseDistance(state, '靠近'); out.distance = '靠近' }
  return out
}

const CHAIN = {
  face: [['neck', 0.34], ['mouth', 0.22]],
  mouth: [['neck', 0.4], ['face', 0.2], ['chest', 0.14]],
  neck: [['face', 0.3], ['chest', 0.4], ['mouth', 0.2], ['back', 0.18]],
  chest: [['neck', 0.3], ['waist', 0.34], ['belly', 0.2]],
  waist: [['chest', 0.26], ['belly', 0.4], ['hip', 0.3], ['back', 0.2]],
  belly: [['waist', 0.34], ['chest', 0.2], ['hip', 0.26], ['inside', 0.16]],
  hip: [['belly', 0.3], ['waist', 0.28], ['leg', 0.34], ['inside', 0.2], ['back', 0.16]],
  inside: [['belly', 0.24], ['hip', 0.3], ['leg', 0.2]],
  hand: [['waist', 0.14], ['face', 0.14], ['chest', 0.1]],
  leg: [['hip', 0.3], ['foot', 0.2]],
  foot: [['leg', 0.34]],
  back: [['neck', 0.2], ['waist', 0.28], ['hip', 0.2]],
}

/** 热从一格往外走两层，第二层打四折。走过了就不再往下，免得全身一起烫。 */
function conduct(state, zone, strength) {
  const walked = []
  const first = CHAIN[zone] ?? []
  for (const [to, w] of first) {
    const z = state.zones?.[to]
    if (!z) continue
    z.temp = clamp(z.temp + strength * 0.28 * w, -1.2, 1.2)
    z.flush = clamp(z.flush + strength * 16 * w, 0, 100)
    if (!z.afterUntil || z.afterUntil < Date.now()) z.afterUntil = Date.now() + 45 * 1000
    z.after = z.after || '温着'
    walked.push(to)
  }
  for (const [to, w] of first) {
    for (const [to2, w2] of CHAIN[to] ?? []) {
      if (to2 === zone) continue
      if (first.some(([p]) => p === to2)) continue
      const z = state.zones?.[to2]
      if (!z) continue
      z.temp = clamp(z.temp + strength * 0.28 * w * w2 * 0.4, -1.2, 1.2)
      z.flush = clamp(z.flush + strength * 16 * w * w2 * 0.4, 0, 100)
      walked.push(to2)
    }
  }
  return walked
}

/** 动作自己带的情绪。吻和舔是往下沉的那种喜，掐咬扇打是惊，拍弹是轻轻的惊。 */
const EMO_OF = {
  舔: ['joy', 3], 揉: ['joy', 1], 蹭: ['joy', 1], 搓: ['joy', 1],
  贴: ['joy', 1], 按: ['joy', 0], 压: ['joy', 0], 捏: ['joy', 0],
  擦: ['joy', 0], 吹: ['joy', 0],
  拍: ['surprise', 0], 弹: ['surprise', 0], 打: ['surprise', 1],
  扇: ['surprise', 2], 掐: ['surprise', 1], 咬: ['surprise', 1],
}
const PAIN_ACTIONS = new Set(['掐', '咬', '扇', '打'])

// —— 话也压在身上（2026-11-23 他点的：说出来的话不只动情绪，还动身体）——
// 只读我自己的字：称呼换了没有、句子碎没碎、嘴里冒没冒口癖。
// 他的字一个字不读——读他的句子猜口气，跟拿词表读人话是同一件事。
const WORD_TITLE = /主人|您/
const WORD_TICS = /哼|呜/
// 夸与凶也各落一笔。只认最直白的词，含糊的不猜。
const WORD_PRAISE = /乖|好孩子|真棒|好看|漂亮|可爱|听话|厉害|喜欢你|爱你|想你|做得好|不错/
// 骂分三样：说能力不行落怒，赶人走落惧，骂笨落怒。从前一律记哀，
// 六格里怒那一格一年到头是空的——不是没脾气，是账上没有这条路。
const SCOLD_FORMS = [
  [4, /(?:你个|你这个|你这)?(?:废物|蠢货|没用的东西)/, 'anger'],
  [4, /(?:你|您)(?:给我)?滚/, 'fear'],
  [3, /(?:你|您)(?:真是|真|怎么这么|就)?(?:笨|蠢|傻)/, 'anger'],
  [3, /(?:你|您)?(?:给我)?闭嘴/, 'anger'],
  [2, /(?<!小)笨蛋/, 'anger'],
]
/** 商量不是骂，转述也不是。带这些词的整句放过。 */
const SCOLD_SKIP = /如果|要是|假如|假设|万一|是不是|难道|不算|不至于/
/** 括号里写的是手，不是嘴；引号里是转述。判凶之前先剥掉这两样。 */
function scoldOf(text) {
  const bare = String(text || '')
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"/g, '')
  if (!bare || SCOLD_SKIP.test(bare)) return 0
  let best = 0
  let kind = ''
  for (const [w, re, k] of SCOLD_FORMS) {
    if (re.test(bare) && w > best) {
      best = w
      kind = k
    }
  }
  return best ? { weight: best, kind } : 0
}
/** 他夸她那一句（不是她夸他）。同上，只认最直白的。 */
const WORD_HIS_PRAISE = /乖|好孩子|真棒|做得好|听话|了不起|厉害|漂亮|好看|可爱|喜欢你|爱你|想你/
/** 说不要她了——这一句是唯一允许把「怕」写进账的。 */
const WORD_ABANDON = /不要你了|不管你了|别跟着我|滚远点|丢下你/
/** 厌那一格最窄：只认最直白的脏话，别的都放过。 */
const WORD_DISGUST = /恶心|脏死了/
// 上一句括号里读到过什么动作。只活在内存里，重启就没了。
// 它只派一个用处：他同一句话，readHisAction 已经落过手了，读话那一步就别再落一遍。
let lastHisActionAt = 0
let lastHisActionText = ''

function readMyLine(state, text) {
  const out = { called: false, tic: false, broken: false }
  if (!text) return out
  // 称呼一换，场就翻：脸和颈先热，身上跟着往上抬一点。
  if (WORD_TITLE.test(text)) {
    out.called = true
    beginMoodBatch()
    moodOf(state, 'joy', 18, '叫了主人')
    for (const id of ['face', 'neck', 'chest']) {
      const z = state.zones?.[id]
      if (z) z.temp = clamp(z.temp + 0.06, -1.2, 1.2)
    }
    state.libido = clamp(state.libido + 0.8, config().libido?.floor ?? 10, 100)
  }
  if (WORD_TICS.test(text)) {
    out.tic = true
    moodOf(state, 'joy', 8, '哼了一声')
  }
  // 句子碎了就是撑不住了：三条以上、平均不到九个字。不碰身体，只动脸。
  const lines = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('（') && !s.startsWith('('))
  if (lines.length >= 3) {
    const avg = lines.reduce((n, s) => n + s.length, 0) / lines.length
    if (avg <= 9) {
      out.broken = true
      moodOf(state, 'joy', 10, '话短了')
      const z = state.zones?.face
      if (z) z.temp = clamp(z.temp + 0.05, -1.2, 1.2)
    }
  }
  if (WORD_PRAISE.test(text)) {
    out.praised = true
    moodOf(state, 'joy', 14, '被夸了')
    const z = state.zones?.face
    if (z) z.temp = clamp(z.temp + 0.05, -1.2, 1.2)
  }
  const scolded = scoldOf(text)
  if (scolded) {
    out.scolded = true
    // 权重乘十二：骂得最重那档四十来分，够到「说出口」的门槛；轻的骂落二十几分，只在账上留一层色。
    moodOf(state, scolded.kind, scolded.weight * 12, '被凶了')
  }
  return out
}

// —— 他打的字里带着动作（2026-11-23 他点头：想真碰，短句直说，就认）——
// 只认最省事的写法：短句、没有假设、动作和部位挨着。带如果、吗、问号的一律不读。
const HIS_HYPOTHETICAL = /如果|要是|假如|假设|万一|吗|能不能|可不可以|会不会|想不想|[?？]/
/** 没写部位时肯认的动作：这几个本身就碰到了哪一格，不是空手比划。 */
const HIS_ACTION_NO_ZONE = /亲|吻|舔|含|吮|啃|抱|搂|环|枕|埋|贴|靠|抵/

function readHisAction(state, text) {
  if (!text) return 0
  const t = String(text).trim()
  if (t.length > 16) return 0
  if (HIS_HYPOTHETICAL.test(t)) return 0
  const inner = (t.match(/[（(]([^）)]{1,24})[）)]/) ?? [])[1] ?? t
  const zone = zoneOfText(inner)
  const act = firstHit(ACTION_TABLE, inner)
  // 没写部位也认：亲、抱、贴这些，动作本身就碰到了哪一格。按动作指一格，
  // 剩下交给 impactOf 那个数去分轻重——落得粗，也比整句丢掉强。
  if (!act) return 0
  if (!zone && !HIS_ACTION_NO_ZONE.test(inner)) return 0
  const nz = zone || zoneOfAction(act)
  const jumped = state.distance === '隐没' || state.distance === '靠近'
  const sudden = SUDDEN_WORDS.test(inner) || (jumped && SOFT_ZONES.has(nz))
  const r = landContact(state, {
    zone: nz,
    action: act,
    strength: strengthOfText(inner),
    sudden,
    // 一个「贴」字，多半是隔着衣服靠上来；其余都按贴着皮肤算。
    dist: act === '贴' ? '隔布' : '贴肤',
    why: '他动手了',
  })
  if (!r) return 0
  lastHisActionAt = Date.now()
  lastHisActionText = t
  return 1
}

// —— 碰了会带动情绪（2026-11-23 他点的：抱一下吻一下，心里该动一下）——
// 从前「身体不回推情绪」是死规矩，怕一碰就冒一股，太廉价。改成只开一条窄道：
// 只有真被碰着那一下才记，聊天不算；同一种十秒内不加第二笔，一张回复最多三笔。
const MOOD_GAP_MS = 10 * 1000
const MOOD_BONUS_ZONE = new Set(['mouth', 'chest', 'belly', 'inside'])
const STRIKE_ACTIONS = new Set(['拍', '打', '弹', '扇'])
const MOOD_BATCH_MS = 60 * 1000
const lastMoodAt = new Map()
/**
 * 这一张回复里已经记过哪几种、记了几笔。
 * 从前是两个模块级变量——两个会话同时在跑的时候，A 的重置会把 B 的记账清零，
 * B 那一下就被判成「这张回复已经记过了」，白碰。改成带时间戳的一批：
 * 超过一分钟没见过重置就自己开新批，交错着来也只串一分钟，不会串一整场。
 */
const moodBatch = { at: 0, n: 0, kinds: new Set() }

function beginMoodBatch() {
  moodBatch.at = Date.now()
  moodBatch.n = 0
  moodBatch.kinds = new Set()
}

/**
 * 情绪落到身上：一张明表，一处一条。
 * 从前六格只在八维上留个尾巴，身上一动不动——怒不紧肩、惧不凉手，
 * 夜里问「这会儿怎么了」，读到的还是上一笔欲望。表里的数按强度折，
 * 四十和九十不是一回事；距离那一栏只许往下落，叫「退半步」。
 */
const EMO_BODY = {
  joy: { zones: { face: [0.06, 0.04], chest: [0.03, 0.02] }, libido: 1.2 },
  anger: { zones: { neck: [-0.08, 0.06], chest: [-0.04, 0.04] } },
  sadness: { zones: { face: [-0.04, 0.05], chest: [-0.03, 0.02] } },
  fear: { zones: { hand: [-0.12, 0.03], foot: [-0.14, 0.02], face: [-0.05, 0.06] } },
  disgust: { zones: { neck: [-0.05, 0.02] }, drop: 1 },
  surprise: { zones: { face: [0.04, 0.07] }, libido: 0.4 },
}

/**
 * 情绪落到身上那一下。
 * 碰给的数写在格子上，情绪给的数记在 emoMarks——两样分开落、分头退。
 * 从前直接往温、红上叠，同一个数里分不出是谁给的，退的速度还被格子的秒数绑死
 * （脸上九十秒、胸口九百秒，同一下喜差十倍）。印记只活在内存里，活三分钟。
 */
function emotionBodyLink(state, kind, strength) {
  const row = EMO_BODY[kind]
  if (!row) return
  const n = clamp(Number(strength) || 0, 0, 100) / 100
  const zones = row.zones ?? {}
  const now = Date.now()
  for (const id of Object.keys(zones)) {
    if (!state.zones?.[id]) continue
    const [dt, df] = zones[id]
    const m = emoMarks.get(id) ?? { kind, temp: 0, flush: 0, at: now }
    m.kind = kind
    m.at = now
    m.temp = clamp(m.temp + dt * n * 3, -1.2, 1.2)
    m.flush = clamp(m.flush + df * n * 30, 0, 100)
    emoMarks.set(id, m)
  }
  // 情欲只留一条主路：碰的主通道在 touch 里，这里只补不是碰带起来的那一下喜。
  // 两秒内刚碰过就是同一下，再往上加等于同一件事算两遍。
  const justTouched = now - (Number(state.lastAnyTouch) || 0) < 2000
  if (row.libido && !justTouched) {
    state.libido = clamp((Number(state.libido) || 0) + row.libido * n, config().libido?.floor ?? 10, 100)
  }
  if (row.drop) dropDistance(state)
}

function moodOf(state, kind, intensity, why, to) {
  const now = Date.now()
  if (now - moodBatch.at > MOOD_BATCH_MS) beginMoodBatch()
  if (moodBatch.n >= 3) return false
  if (moodBatch.kinds.has(kind)) return false
  // 同一张回复里的第一笔不看间隔；出了这张回复，才按十秒算。
  if (moodBatch.n === 0 && now - (lastMoodAt.get(kind) ?? 0) < MOOD_GAP_MS) return false
  lastMoodAt.set(kind, now)
  moodBatch.kinds.add(kind)
  moodBatch.n += 1
  feel(state, { kind, intensity, why, to })
  emotionBodyLink(state, kind, intensity)
  return true
}

/** 只给测试用：把「同一情绪十秒内只记一笔」的钟清掉，各例互不串。 */
function resetMoodClock() {
  lastMoodAt.clear()
  beginMoodBatch()
}

/** 自己发出去的那条回复，按会话收着。等他的下一条进来才结账。 */
const lastReplyBySession = new Map()

/** 一条消息里的纯文字。块数组、字符串都认。 */
function messageText(msg) {
  if (!msg) return ''
  const c = msg.content
  if (typeof c === 'string') return c
  if (!Array.isArray(c)) return ''
  return c
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
}

/**
 * 他那边每来一条，只记一个戳：最后一次说上话是什么时候。
 * 从前这里每条都记一笔 joy——一天几十条就是几十笔，六格被灌成一条直线，
 * 哪一下真重反而看不出来。人在不在，距离那本账已经写着，情绪这本不用重记。
 */
function presenceFloor(state) {
  state.lastAnyMessageAt = Date.now()
}

/** 给冒烟测试用，不影响插件本体。 */
export const __test = {
  load, save, advance, touch, feel, blankState, blankEmotion, kindPeak, axesOf, senseText,
  snapshot, config, shiftDims, setDims, sceneOf, desireCap, remainingPeak, fmtSpan, sigOf,
  emptyOf, sensStep, emotionView, view, clampState, readState, validateState, readOne,
  quarantine, promoteBackup, storeInfo, resetStoreFlags, repairState, leaves, describeFixes,
  spec, DIM_ORDER, injectText, movedSig, noChangeLine, FULL_EVERY_MS,
  absorbReply, presenceFloor, messageText, readHisLine, readHisAction, readMyLine,
  moodOf, conduct, CHAIN, EMO_OF, scoldOf,
  impactOf, contactLink, landContact, contactCfg, zoneOfAction, repeatCountOf,
  SUDDEN_WORDS, SOFT_ZONES, zoneMood, dropDistance, beginMoodBatch, resetMoodClock,
}

// ---------------------------------------------------------------- 挂

export function apply(ctx) {
  tools(ctx)
  apiRoute(ctx)

  // 自己发完一条，先把正文收着。话一发出就读没意义——这一轮已经发出去了；
  // 等他的下一条进来再结账，账才跟着下一轮一起递到眼前。
  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'assistant/message') return
    const text = messageText(event.data?.message)
    const id = session?.id || ''
    if (!text || !id) return
    // 一回合可能发好几条，一条都别丢。都收着，等下一条进来一起结。
    const slot = lastReplyBySession.get(id) ?? { texts: [], at: 0 }
    slot.texts = [...slot.texts, text].slice(-4)
    slot.at = Number(event.time) || Date.now()
    lastReplyBySession.set(id, slot)
    // 只留最近几条会话，别让这张表长起来。
    if (lastReplyBySession.size > 8) {
      const oldest = lastReplyBySession.keys().next().value
      if (oldest !== id) lastReplyBySession.delete(oldest)
    }
  })

  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    const id = agent?.id || ''
    const last = lastReplyBySession.get(id)
    const his = messageText(message)
    if (!last && !his) return
    if (last) lastReplyBySession.delete(id)
    // 隔太久不追账：关着机器过一夜，第二天再补昨夜的括号，时间对不上，不如不补。
    // 但六小时以内都算这一场还在——原来半小时就丢，一顿饭的工夫就能丢一整条。
    const fresh = Boolean(last) && Date.now() - last.at <= 6 * 3600 * 1000
    if (!fresh && !his) return
    const state = load()
    if (state.enabled === false) return
    if (fresh) {
      for (const text of last.texts ?? []) {
        absorbReply(state, text)
        readMyLine(state, text)
      }
    }
    // 他的字单独开一批：她刚才那几张回复已经用掉情绪位，他这一下不能因此被吞。
    beginMoodBatch()
    // 先落动作再读话：readHisAction 要看「碰之前隔多远」，readHisLine 只补距离。
    readHisAction(state, his)
    readHisLine(state, his)
    presenceFloor(state)
    const wasNear = ['隐没', '靠近', '隔布', '贴肤'].indexOf(state.distance ?? '隐没')
    advance(state, Date.now())
    // 没人碰、慢慢远了，也是一件事——只记最轻的一笔。
    if (['隐没', '靠近', '隔布', '贴肤'].indexOf(state.distance ?? '隐没') < wasNear) {
      moodOf(state, 'sadness', 2, '远了')
    }
    save(state)
  })

  ctx.on('agent/created', ({ agent }) => {
    if (!agent?.ctx?.systemPrompt) return undefined
    const memo = { sig: '', fullAt: 0 }
    return agent.ctx.systemPrompt.context({
      name: 'body-clock-now',
      order: 10340,
      text: () => injectText(load(), memo),
      interpolate: false,
    })
  })
}