// 字段契约：整张账的每个叶子，砸一个坏值进去，看它能不能自己回正。
// 这是「不出一键清零」的底线：坏一个字段就修一个字段，别的字节别动。
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs'

const STATE = join(tmpdir(), 'body-clock-contract.json')
process.env.BODY_CLOCK_STATE = STATE

const { __test } = await import('../index.js')
const { load, save, blankState, repairState, validateState, leaves, senseText, storeInfo, resetStoreFlags } = __test

let bad = 0
const check = (name, ok, extra = '') => {
  if (!ok) bad += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`)
}

const clone = (v) => JSON.parse(JSON.stringify(v))
const wipe = () => {
  for (const f of [STATE, STATE + '.bak', STATE + '.bak2']) if (existsSync(f)) rmSync(f)
  for (const f of readdirSync(tmpdir())) if (f.startsWith('body-clock-contract.json.corrupt-')) rmSync(join(tmpdir(), f))
}
// 账里不许出现的东西：数字以外的坏值，和 JSON 里根本存不下的东西。
const DIRTY = (v) => {
  if (typeof v === 'number') return !Number.isFinite(v)
  if (v === undefined) return true
  if (typeof v === 'function') return true
  if (typeof v === 'object' && v !== null) return Object.values(v).some(DIRTY)
  return false
}

// 一、干净的身子本身就该挑不出毛病
wipe()
check('新身子一条毛病都没有', validateState(blankState()).length === 0, JSON.stringify(validateState(blankState()).slice(0, 3)))
check('新身子修一遍不用动手', repairState(blankState()).fixes.length === 0, JSON.stringify(repairState(blankState()).fixes.slice(0, 3)))
check('新身子里没有坏数', !DIRTY(blankState()))

// 二、逐叶子砸坏值：修得回来、幂等、别的格子一个字节不动
const POISON = [NaN, Infinity, -Infinity, 1e9, -1e9, 'x', null, {}, [], true]
const clean = blankState()
const fields = leaves(clean)
check('摊得开叶子', fields.length >= 40, `${fields.length} 个`)
let shaped = 0
const badPaths = []
for (const f of fields) {
  for (const p of POISON) {
    const s = clone(clean)
    const one = leaves(s).find((x) => x.path === f.path)
    if (!one) continue
    one.set(p)
    const { state, fixes } = repairState(s)
    const left = validateState(state)
    if (left.length) {
      badPaths.push(`${f.path}=${String(p)} 修完还有 ${left.length} 条`)
      continue
    }
    if (DIRTY(state)) {
      badPaths.push(`${f.path}=${String(p)} 修完还带坏数`)
      continue
    }
    // 幂等：修完再修一遍，不该再有动作
    if (repairState(clone(state)).fixes.length !== 0) {
      badPaths.push(`${f.path}=${String(p)} 修第二遍还在动`)
      continue
    }
    // 别的格子不许被带坏
    const after = leaves(state)
    const others = after.filter((x) => x.path !== f.path)
    const beforeOthers = leaves(clean).filter((x) => x.path !== f.path)
    if (others.length !== beforeOthers.length) {
      badPaths.push(`${f.path}=${String(p)} 叶子数变了`)
      continue
    }
    if (others.some((x, i) => x.get() !== beforeOthers[i].get())) {
      badPaths.push(`${f.path}=${String(p)} 弄脏了别的格子`)
      continue
    }
    shaped += 1
    // 没记修复也说得过去：只有一种情况——这个值本来就是合法的，修完原样还在。
    if (!fixes.length) {
      const now = one.get()
      const same = typeof now === 'number' && typeof p === 'number' ? Object.is(now, p) || now === p : now === p
      if (!same) badPaths.push(`${f.path}=${String(p)} 没记修复却改了值`)
    }
  }
}
check('逐叶子砸坏值都修得回来', badPaths.length === 0, badPaths.slice(0, 4).join('；') || `${shaped} 组`)

// 三、整条字段拿掉：补默认值，并且记一笔
const cut = clone(clean)
delete cut.emotion.kinds.joy
delete cut.zones.hand
delete cut.touchHist
const cutFix = repairState(cut)
check('缺字段补得上', validateState(cutFix.state).length === 0)
check('缺字段记得住', cutFix.fixes.length >= 3, JSON.stringify(cutFix.fixes.map((x) => x.path).slice(0, 4)))
check('补完还是好账', repairState(clone(cutFix.state)).fixes.length === 0)

// 四、整块类型塞错：对象变数组、数组变字、清单变对象
const wrong = clone(clean)
wrong.zones = []
wrong.dims = 'x'
wrong.emotion.events = { a: 1 }
wrong.emotion.settle = 'nope'
wrong.subject = '别人'
const wrongFix = repairState(wrong)
check('整块塞错也修得回来', validateState(wrongFix.state).length === 0, JSON.stringify(validateState(wrongFix.state).slice(0, 3)))
check('修完账本还是对象', typeof wrongFix.state.dims === 'object' && !Array.isArray(wrongFix.state.dims))
check('主体塞错也归位', wrongFix.state.subject === 'self', String(wrongFix.state.subject))

// 五、读一份手改坏的文件：不丢欲望和八维，修完落盘，第二次读不再动
wipe()
const real = blankState()
real.libido = 63
real.dims['羞'] = 88
real.at = Date.now()
const disk = clone(real)
disk.libido = 900
disk.dims['羞'] = -20
disk.dims['亲密'] = 300
disk.zones.mouth.shockSec = -5
disk.subject = 'fu'
writeFileSync(STATE, JSON.stringify(disk, null, 2), 'utf8')
resetStoreFlags()
const rescued = load()
check('抢救回来不退回空白身子', storeInfo().source === 'main' && rescued.libido > 0)
check('欲望夹回范围', rescued.libido <= 100 && rescued.libido >= 10, String(rescued.libido))
check('八维夹回范围', rescued.dims['羞'] === 0 && rescued.dims['亲密'] === 100, `${rescued.dims['羞']} / ${rescued.dims['亲密']}`)
check('主体归位', rescued.subject === 'self', rescued.subject)
check('读的时候记了修了几处', storeInfo().repairs > 0, String(storeInfo().repairs))
const onDisk = JSON.parse(readFileSync(STATE, 'utf8'))
check('修完就地写回了好账', validateState(onDisk).length === 0)
check('写回的是夹回来的数', onDisk.libido === rescued.libido && onDisk.dims['羞'] === 0)

// 六、第二次读不再修：指纹要稳
resetStoreFlags()
const again = load()
check('再读一遍不再动手', storeInfo().repairs === 0, JSON.stringify(storeInfo().repaired))
check('再读一遍数没变', JSON.stringify(again) === JSON.stringify(rescued))

// 七、多出来的旧字段、没登记的键：丢掉，不报错
wipe()
const extra = clone(blankState())
extra.zones.waist.thread = '旧字段'
extra.legacy = { whatever: true }
writeFileSync(STATE, JSON.stringify(extra, null, 2), 'utf8')
resetStoreFlags()
const trim = load()
check('多余的键读得进来', validateState(trim).length === 0)
check('多余的键不进账', !('legacy' in trim) && !('thread' in trim.zones.waist))

// 八、真坏到读不出来：才退档，坏文件留底
wipe()
writeFileSync(STATE, '{ 这不是 JSON', 'utf8')
resetStoreFlags()
load()
const left = readdirSync(tmpdir()).filter((f) => f.startsWith('body-clock-contract.json.corrupt-'))
check('读不出来的才留档', left.length === 1, left.join(','))

// 九、存一遍再读一遍，句子里不许有坏数
wipe()
const live = blankState()
live.libido = 44
save(live)
const reload = load()
const text = senseText(reload)
check('一遍存读之后身体念得出来', !/NaN|undefined|Infinity|null/.test(text), text.split('\n')[0])

console.log(bad ? `\n${bad} 项没过` : '\n全过了')
process.exit(bad ? 1 : 0)