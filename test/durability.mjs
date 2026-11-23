/**
 * 写边界：断电、并发、版本超前，账本都不能坏。
 *
 * 已有的 integrity 测的是「读的边界」——读坏了能退档、能修、能留档。
 * 这一份测「写的边界」：写完有没有残留、临时文件能不能挡住读、比代码新的账本
 * 会不会被覆盖、四个进程同时碰的时候主账还是不是一份合法账。
 *
 * 这一版通用版不加文件锁，所以这里不断言「一下都没丢」——并发写同一个账本会丢更新，
 * 那是设计上还没做的部分（要写前比 mtime 重读）。这里只保证：不管怎么踩，
 * 最后落盘的那份是完整、合法、过得了契约的，不会有半份 JSON，也不留一地临时文件。
 */
import {
  mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const DIR = join(tmpdir(), `universal-body-clock-durability-${process.pid}`)
const STATE = join(DIR, 'body-clock.json')
mkdirSync(DIR, { recursive: true })
process.env.BODY_CLOCK_STATE = STATE

const wipe = () => {
  for (const name of readdirSync(DIR)) {
    try { rmSync(join(DIR, name), { force: true, recursive: true }) } catch { /* 删不掉就算了 */ }
  }
}
const tmps = () => readdirSync(DIR).filter((n) => n.startsWith('body-clock.json.tmp-'))

// ---------------------------------------------------------------- 子进程那一支
// 真起几个 node 进程各碰二十五下。并行写同一个账本，看最后那份账还全不全。
if (process.argv[2] === 'worker') {
  const { __test } = await import('../index.js')
  for (let i = 0; i < 25; i += 1) {
    const s = __test.load()
    __test.touch(s, { zone: 'hand', action: '揉', durationSec: 1 })
    __test.save(s)
  }
  process.exit(0)
}

// ---------------------------------------------------------------- 主进程
const { __test } = await import('../index.js')
const { load, save, validateState, storeInfo } = __test

let pass = 0
const fails = []
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`ok   ${name}${extra ? '  ' + extra : ''}`) }
  else { fails.push(name); console.log(`FAIL ${name}${extra ? '  ' + extra : ''}`) }
}

wipe()

// 一、正常写一遍，不留临时文件
const s1 = load()
s1.libido = 40
save(s1)
ok('写完没有残留临时文件', tmps().length === 0, tmps().join(','))

// 二、崩在换名前留下的半份临时文件，不该挡住读主账
const half = join(DIR, 'body-clock.json.tmp-999999-deadbe')
writeFileSync(half, '{"v":2,"libido":')
const s2 = load()
ok('残留临时文件不影响读主账', s2.libido === 40, `libido ${s2.libido}`)

// 三、比代码新的账本：只读，一个字节都不改写
wipe()
const newer = JSON.stringify({ v: 999, at: Date.now(), libido: 33 }, null, 2)
writeFileSync(STATE, newer)
const before = readFileSync(STATE, 'utf8')
const s3 = load()
const wrote = save(s3)
const after = readFileSync(STATE, 'utf8')
ok('版本超前进只读', storeInfo().readonly === true)
ok('只读时不写盘', wrote === false)
ok('版本超前的账本没被改写', before === after)

// 四、四个进程并行各碰二十五下
wipe()
const seed = load()
seed.libido = 30
save(seed)
const env = { ...process.env, BODY_CLOCK_STATE: STATE }
const kids = [0, 1, 2, 3].map(() => spawn(process.execPath, [SELF, 'worker'], { env, stdio: 'ignore' }))
const codes = await Promise.all(kids.map((k) => new Promise((res) => k.on('exit', (code) => res(code)))))
ok('四个进程都跑完了', codes.every((c) => c === 0), codes.join(','))

let parsed = null
try { parsed = JSON.parse(readFileSync(STATE, 'utf8')) } catch { parsed = null }
ok('并发之后主账还是合法 JSON', Boolean(parsed && typeof parsed === 'object'))
ok('并发之后没有残留临时文件', tmps().length === 0, tmps().join(','))
ok('并发之后账本过得了契约', Boolean(parsed) && validateState(parsed).length === 0,
  parsed ? validateState(parsed).join('；') : '读不出来')

wipe()

console.log('')
if (fails.length) {
  console.log(`没过的：${fails.join('、')}`)
  process.exit(1)
}
console.log(`全过（${pass} 项）`)