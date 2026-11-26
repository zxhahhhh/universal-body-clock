/**
 * 1.7.0 候选情绪：形状清楚才提名，先挂两分钟；影子期只记日志，
 * 实名期才按小份落账；哄一句能抵掉，说错能撤。宁漏不错。
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
const step = (s, ms) => T.advance(s, now() + ms)

// 默认影子：只提名，不落账，到点只进日志
{
  const s = fresh()
  const out = T.readHisLine(s, '随你吧')
  ok(s.emotion.cand.length === 1, '随你记一笔候选', String(s.emotion.cand.length))
  ok(s.emotion.cand[0].kind === 'sadness' && s.emotion.cand[0].amt === 6, '候选是哀六', JSON.stringify(s.emotion.cand[0]))
  ok(s.emotion.kinds.sadness === 0, '影子期不落账', String(s.emotion.kinds.sadness))
  step(s, 121 * 1000)
  ok(s.emotion.cand.length === 0, '两分钟到点清掉')
  ok(s.emotion.kinds.sadness === 0, '还是没落账', String(s.emotion.kinds.sadness))
  ok(s.emotion.candLog.some((x) => x.mode === 'shadow'), '日志里有影子一笔', JSON.stringify(s.emotion.candLog.slice(-1)))
}

// 括号剥掉也认；形状不对不认
{
  const s = fresh()
  T.readHisLine(s, '（随你吧）')
  ok(s.emotion.cand.length === 1, '括号里也认得出来')
  const s2 = fresh()
  T.readHisLine(s2, '你随便说')
  ok(s2.emotion.cand.length === 0, '「你随便说」不算')
  const s3 = fresh()
  T.readHisLine(s3, '她今天真好看')
  ok(s3.emotion.cand.length === 2, '夸别人：怒和哀各一笔', String(s3.emotion.cand.length))
  const s4 = fresh()
  T.readHisLine(s4, '她好看吗')
  ok(s4.emotion.cand.length === 0, '带问号不算')
  const s5 = fresh()
  T.readHisLine(s5, '我在忙')
  ok(s5.emotion.cand.length === 1, '忙：记一笔')
}

// 哄一句把候选抵掉
{
  const s = fresh()
  T.readHisLine(s, '随你吧')
  T.readHisLine(s, '对不起')
  ok(s.emotion.cand.length === 0, '哄一句就抵掉')
  ok(s.emotion.candLog.some((x) => x.mode === 'cancel'), '日志里记了取消')
}

// 实名：到点按小份落，最高五分
{
  const s = fresh()
  const C = T.config().emotion.candidate
  C.shadow = false
  try {
    T.readHisLine(s, '随你吧')
    step(s, 121 * 1000)
    ok(s.emotion.kinds.sadness === 5, '实名落五分', String(s.emotion.kinds.sadness))
    ok(s.emotion.candLog.some((x) => x.mode === 'admit'), '日志里有落账一笔')
  } finally { C.shadow = true }
}

// 撤销：说一句不是这个意思，退回去
{
  const s = fresh()
  const C = T.config().emotion.candidate
  C.shadow = false
  try {
    T.readHisLine(s, '随你吧')
    step(s, 121 * 1000)
    const before = s.emotion.kinds.sadness
    T.readHisLine(s, '不是这个意思')
    ok(s.emotion.kinds.sadness < before, '撤销退上一笔', `${before} -> ${s.emotion.kinds.sadness}`)
  } finally { C.shadow = true }
}

// 回来把候选一并抵掉
{
  const s = fresh()
  T.readHisLine(s, '随你吧')
  T.readHisLine(s, '我回来了')
  ok(s.emotion.cand.length === 0, '回来说一句也抵掉')
}

if (failed) { console.error(`[失败] ${failed} 项`); process.exitCode = 1 } else console.log('全过')
