// 随手乱砸：随机挑叶子塞坏值、随机删字段、随机把整块换成别的东西，
// 然后走一遍存盘 → 读盘 → 出句子。只要有一条能把账本弄坏，就认输。
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync, existsSync, rmSync } from 'node:fs'

const STATE = join(tmpdir(), 'body-clock-fuzz.json')
process.env.BODY_CLOCK_STATE = STATE

const { __test } = await import('../index.js')
const { load, save, advance, touch, feel, blankState, leaves, validateState, senseText, view, config, storeInfo, resetStoreFlags } = __test

const CFG = config()
const ZONES = Object.keys(CFG.zones || {}).length ? Object.keys(CFG.zones) : ['hand', 'mouth']
const ACTIONS = ['按', '捏', '拍', '揉', '贴', '咬', '舔']
const KINDS = ['joy', 'anger', 'sadness', 'fear', 'surprise', 'disgust']

let bad = 0
const check = (name, ok, extra = '') => {
  if (!ok) bad += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`)
}

let seed = 0x9e3779b9
const rnd = () => {
  seed ^= seed << 13; seed >>>= 0
  seed ^= seed >> 17
  seed ^= seed << 5; seed >>>= 0
  return seed / 4294967296
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const ri = (n) => Math.floor(rnd() * n)

const DIRTY = (v) => {
  if (typeof v === 'number') return !Number.isFinite(v)
  if (v === undefined) return true
  if (typeof v === 'function') return true
  if (typeof v === 'object' && v !== null) return Object.values(v).some(DIRTY)
  return false
}

const POISON = [NaN, Infinity, -Infinity, 1e9, -1e9, 'x', null, {}, [], true, 0.5, -0.0001]
const ROUNDS = Number(process.env.FUZZ_ROUNDS) || 600

wipe()
function wipe() {
  for (const f of [STATE, STATE + '.bak', STATE + '.bak2']) if (existsSync(f)) rmSync(f)
}

// 一次砸：动 1~6 个地方，砸法随机
function smash(state) {
  const paths = leaves(state)
  const n = 1 + ri(6)
  const hits = []
  for (let i = 0; i < n; i += 1) {
    const f = pick(paths)
    const mode = ri(10)
    if (mode < 6) {
      f.set(pick(POISON))
      hits.push(f.path)
    } else if (mode < 8) {
      // 删掉一小块或者一个叶子
      const cut = f.path.lastIndexOf('.')
      if (cut > 0) {
        const parent = state
        const segs = f.path.slice(0, cut).split('.')
        let box = parent
        for (const s of segs) box = box?.[s]
        if (box && typeof box === 'object') delete box[f.path.slice(cut + 1)]
        hits.push('cut:' + f.path)
      }
    } else if (mode < 9) {
      // 把整块换成别的东西
      const top = pick(['zones', 'dims', 'subject', 'emotion', 'touchHist', 'libido'])
      state[top] = pick(POISON)
      hits.push('block:' + top)
    } else {
      f.set(pick([Number.MIN_VALUE, Number.MAX_VALUE, -0, 1e-320, 2 ** 53]))
      hits.push('edge:' + f.path)
    }
  }
  return hits
}

resetStoreFlags()
save(load())
let broken = []
for (let r = 0; r < ROUNDS; r += 1) {
  const s = load()
  const hits = smash(s)
  // 存盘不该把坏账写出去：要么收回修好，要么整份拒收
  const ok = save(s)
  const back = load()
  const left = validateState(back)
  if (left.length) broken.push(`第 ${r} 轮（${hits.slice(0, 2).join(',')}）修完还剩 ${left.length} 条：${left[0]}`)
  if (DIRTY(back)) broken.push(`第 ${r} 轮（${hits.slice(0, 2).join(',')}）账里还有坏数`)
  if (!ok && storeInfo().problems.length === 0) broken.push(`第 ${r} 轮拒收了却没说原因`)
  // 磁盘上那一份也得是干净的
  if (existsSync(STATE)) {
    const disk = JSON.parse(readFileSync(STATE, 'utf8'))
    if (validateState(disk).length || DIRTY(disk)) broken.push(`第 ${r} 轮磁盘上的账是坏的`)
  }
  // 走一步、碰一下、给一笔情绪，再验
  if (r % 3 === 0) {
    advance(back, back.at + ri(72) * 3600000 - 6 * 3600000)
    touch(back, { zone: pick(ZONES), action: pick(ACTIONS), strength: pick(['轻', '中', '重']), speed: pick(['慢', '中', '快']), durationSec: ri(40) })
    feel(back, { kind: pick(KINDS), intensity: ri(101), why: '砸' })
    advance(back, back.at + ri(6) * 3600000)
    const v = view(back)
    const text = senseText(back)
    if (/NaN|undefined|Infinity|null/.test(text)) broken.push(`第 ${r} 轮句子带坏数：${text.split('\n')[0]}`)
    if (/NaN|Infinity/.test(JSON.stringify(v))) broken.push(`第 ${r} 轮面板带坏数`)
    if (validateState(back).length) broken.push(`第 ${r} 轮走完又出毛病`)
    if (broken.length > 8) break
  }
  if (broken.length > 8) break
}
check(`${ROUNDS} 轮乱砸之后账本还是好的`, broken.length === 0, broken.slice(0, 4).join('；'))
check('砸完没有丢版本号', load().v === 4, String(load().v))
const final = load()
check('砸完欲望还在范围内', final.libido >= (Number(CFG.libido?.floor) || 10) && final.libido <= 100, String(final.libido))
check('砸完八维还是八个数', view(final).dims.length === 8)
check('砸完主体还是自己', final.subject === 'self', String(final.subject))
console.log(bad ? `\n${bad} 项没过` : '\n全过了')
process.exit(bad ? 1 : 0)