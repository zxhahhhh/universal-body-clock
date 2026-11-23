/**
 * 情绪层自检：算出来的数对不对，退得对不对。
 * 强度和三轴都不存，全从六格现算——这里也跟着现算。
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 每个测试各用一个临时账本，绝不碰真实的那一个文件。
process.env.BODY_CLOCK_STATE = join(tmpdir(), 'body-clock-emotion.json')
const { __test } = await import('../index.js')

const { feel, advance, blankState, kindPeak, axesOf } = __test

const say = (k, v) => console.log(String(k).padEnd(14), v)
const peak = (s) => Math.round(kindPeak(s.emotion))
const ax = (s) => axesOf(s.emotion)

// 冷启动：干净的一份账
let s = blankState()

// 一、喜，七成
let r = feel(s, { kind: 'joy', intensity: 70, why: '被夸了一句' })
say('喜 70', `强度 ${r.intensity} 会往外走 ${r.say} 愉悦 ${ax(s).valence.toFixed(2)} 唤醒 ${Math.round(ax(s).arousal)}`)
say('', `六格顶 ${peak(s)} 债 ${r.debt}`)

// 二、同类别再来一次，要打折
r = feel(s, { kind: 'joy', intensity: 70 })
say('喜 再来一次', `强度 ${r.intensity}（该打折）六格顶 ${peak(s)}`)

// 三、怒，重的，要挂债
r = feel(s, { kind: 'anger', intensity: 85, why: '说话难听' })
say('怒 85', `强度 ${r.intensity} 债 ${r.debt} 愉悦 ${ax(s).valence.toFixed(2)} 控制 ${ax(s).control.toFixed(2)}`)
say('', `在动 ${s.emotion.events.map((e) => e.kind).join(',')}（最多两笔）`)
say('', `六格 喜 ${Math.round(s.emotion.kinds.joy)} 怒 ${Math.round(s.emotion.kinds.anger)}`)

// 四、轻的不到线，只进身体
r = feel(s, { kind: 'sadness', intensity: 20 })
say('哀 20', `强度 ${r.intensity} 会往外走 ${r.say}`)

// 五、退：半小时，三小时，两天
const t0 = Date.now()
s.at = t0
advance(s, t0 + 30 * 60 * 1000)
say('半小时后', `六格顶 ${peak(s)} 在动 ${s.emotion.events.length} 笔 唤醒 ${Math.round(ax(s).arousal)}`)
advance(s, t0 + 3 * 3600 * 1000)
say('三小时后', `六格顶 ${peak(s)} 在动 ${s.emotion.events.length} 笔 愉悦 ${ax(s).valence.toFixed(2)}`)
advance(s, t0 + 48 * 3600 * 1000)
say('两天后', `六格顶 ${peak(s)} 债 ${Math.round(s.emotion.debt)}`)

const ok = peak(s) === 0 && s.emotion.events.length === 0 && Math.abs(ax(s).valence) < 0.02
console.log(ok ? '[done]' : '[bad] 该退干净了')
process.exit(ok ? 0 : 1)