// 账本这一层自己的体检：写不进去的账不准落盘，坏了往下退一格，退到底才起新的。
// 一条都不许「一坏就清零」——清了就是把她几百小时的身体抹掉。
import { writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const DIR = join(tmpdir(), 'body-clock-integrity')
const STATE = join(DIR, 'body-clock.json')
const BAK = STATE + '.bak'
const BAK2 = STATE + '.bak2'
// 模块在 import 那一刻就把路径定死了，所以必须先设环境变量再 import。
process.env.BODY_CLOCK_STATE = STATE
const { __test } = await import('../index.js')

const { load, save, readState, validateState, blankState, senseText, advance, touch, feel, setDims,
  resetStoreFlags, storeInfo } = __test

let fails = 0
const check = (name, ok, detail = '') => {
  if (ok) console.log('  ok   ' + name)
  else { fails += 1; console.log('  FAIL ' + name + (detail ? '  ' + detail : '')) }
}
const mkdir = () => mkdirSync(DIR, { recursive: true })
rmSync(DIR, { recursive: true, force: true })
mkdir(DIR)
const junk = () => readdirSync(DIR).filter((f) => f.includes('.corrupt-'))
const wipe = () => { rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true }); resetStoreFlags() }

// 一、正常写读
wipe()
const good = blankState()
check('第一份写进去了', save(good) === true)
check('读回来是主账本', storeInfo().source === 'main' && load().libido === good.libido)

// 二、再存一次，备份该有上一份了
const g2 = load(); g2.libido = 33
check('第二份也写进去了', save(g2) === true)
check('备份跟着有了', existsSync(BAK))
check('备份里是上一份', JSON.parse(readFileSync(BAK, 'utf8')).libido === good.libido)

// 三、主文件写坏 → 退到上一份，坏的不删
const before = readFileSync(BAK, 'utf8')
writeFileSync(STATE, '{ 这不是 JSON', 'utf8')
const back = load()
check('主文件坏了退到上一份', storeInfo().source === 'backup' && back.libido === 12)
check('坏文件留了档没删', junk().length === 1 && existsSync(BAK))
check('备份本体没被动过', readFileSync(BAK, 'utf8') === before)

// 四、主文件和两份备份全坏 → 才起新身子
wipe()
save(Object.assign(blankState(), { libido: 44 }))
save(Object.assign(blankState(), { libido: 55 }))
writeFileSync(STATE, 'not json', 'utf8')
writeFileSync(BAK, '[1,2,3]', 'utf8')
if (existsSync(BAK2)) unlinkSync(BAK2)
writeFileSync(BAK2, 'null', 'utf8')
const last = load()
check('三份都坏才起新的', storeInfo().source === 'blank')
check('但三份坏账都留了档', junk().length === 3)

// 五、写进来的坏值先夹回去再落盘，落盘的账本永远是好的
wipe()
save(Object.assign(blankState(), { libido: 66 }))
const dirty = blankState()
dirty.libido = 500
dirty.dims['敏感'] = 240
dirty.zones.hand.press = 999
check('坏账写进去时被夹回来了', save(dirty) === true)
check('夹了什么记得住', storeInfo().saveRepairs > 0, `记了 ${storeInfo().saveRepairs} 处`)
const disk = JSON.parse(readFileSync(STATE, 'utf8'))
check('欲望落盘时在范围里', disk.libido >= 10 && disk.libido <= 100, `落盘 ${disk.libido}`)
check('八维落盘时在范围里', disk.dims['敏感'] === 100, `落盘 ${disk.dims['敏感']}`)
check('格子压落盘时在范围里', disk.zones.hand.press === 100, `落盘 ${disk.zones.hand.press}`)
check('落盘的账本挑不出毛病', validateState(disk).length === 0)
check('没有修不掉的毛病', storeInfo().problems.length === 0)

// 六、版本比代码新 → 只读，一个字节都不覆盖
wipe()
const newer = JSON.stringify({ ...blankState(), v: 99, libido: 42 })
writeFileSync(STATE, newer, 'utf8')
load()
check('版本超前认成只读', storeInfo().readonly === true)
const stillNewer = readFileSync(STATE, 'utf8')
save(userState())
check('只读时写不进去', readFileSync(STATE, 'utf8') === stillNewer)
function userState() { const s = blankState(); s.libido = 80; return s }

// 七、验得出坏在哪
wipe()
const bad1 = blankState(); bad1.libido = -5
const bad2 = blankState(); bad2.subject = '别人'
const bad3 = blankState(); delete bad3.zones.hand
check('负欲望验得出', validateState(bad1).some((p) => p.includes('欲望')))
check('不认识的主体验得出', validateState(bad2).some((p) => p.includes('主体')))
check('缺格子验得出', validateState(bad3).some((p) => p.includes('hand')))
check('好账一条毛病都没有', validateState(blankState()).length === 0)

// 八、几千次极端状态里，注入不许吐坏值、不许超过八行
wipe()
let badout = 0
let longline = 0
const s0 = blankState()
const N = 4000
for (let i = 0; i < N; i += 1) {
  const s = s0
  s.libido = (i * 37) % 130 - 15
  s.dims['敏感'] = (i * 17) % 140 - 10
  s.dims['亲密'] = (i * 23) % 120
  s.distance = ['隐没', '靠近', '隔布', '贴肤', '胡写'][i % 5]
  const z = s.zones[['hand', 'waist', 'chest', 'neck'][i % 4]]
  z.press = (i * 91) % 260 - 30
  z.flush = (i * 57) % 140
  z.temp = ((i % 21) - 10) / 3
  z.lastTouch = Date.now() - ((i * 7) % 900) * 1000
  s.emotion.kinds.joy = (i * 29) % 200
  s.emotion.debt = (i * 11) % 130
  s.at = Date.now() - ((i * 3) % 600) * 1000
  try {
    const text = senseText(s)
    if (/NaN|undefined|Infinity|null/.test(text)) badout += 1
    if (text.split('\n').length > 8) longline += 1
  } catch { badout += 1 }
}
check(`${N} 次极端状态没有坏值`, badout === 0, `坏 ${badout} 次`)
check('行数没失控', longline === 0, `超长 ${longline} 次`)

// 九、正常的走动里也不许吐坏值
wipe()
let walkBad = 0
for (let i = 0; i < 800; i += 1) {
  const s = load()
  const now = Date.now() + i * 1000
  s.at = now - 1000
  touch(s, { zone: ['hand', 'waist', 'chest', 'foot', 'neck'][i % 5], action: '按', strength: '重' })
  if (i % 7 === 0) feel(s, { kind: ['joy', 'anger', 'sadness', 'fear'][i % 4], intensity: 90 })
  if (i % 11 === 0) setDims(s, { 敏感: 200 - i, 亲密: -20 + i })
  advance(s, now)
  save(s)
  const text = senseText(s)
  if (/NaN|undefined|Infinity|null/.test(text)) walkBad += 1
  if (storeInfo().readonly) break
}
check('八百步走动里没有坏值', walkBad === 0, `坏 ${walkBad} 次`)

rmSync(DIR, { recursive: true, force: true })
console.log(fails ? `\n${fails} 项没过` : '\n全过')
process.exit(fails ? 1 : 0)