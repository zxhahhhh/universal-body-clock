/**
 * 1.7.0 私有词表外置：lexicon.json 在就在，不在就当空表。
 * 插件源码和提交里一个私名都不带——谁要认自己那几路，自己放一份，别提交。
 */
import { __test as T } from '../index.js'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
const ok = (c, msg, extra = '') => {
  if (!c) { failed += 1; console.error(`FAIL  ${msg}${extra ? '  ' + extra : ''}`) } else console.log(`ok    ${msg}${extra ? '  ' + extra : ''}`)
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const file = join(root, 'lexicon.json')
let backup = null
if (existsSync(file)) {
  backup = readFileSync(file, 'utf8')
  unlinkSync(file)
}

try {
  // 没有表：生造的名词不认
  ok(T.hisNouns().length === 0, '没有 lexicon.json 就是空表', String(T.hisNouns().length))
  ok(!T.parseHisClause('（掂勺）'), '生造词不认')

  // 放一份：只认表里那一条
  writeFileSync(file, JSON.stringify([['掂勺', 'face', '揉'], ['坏行']]))
  const rows = T.hisNouns()
  ok(rows.length === 1 && rows[0][0] === '掂勺', '只收形状对的', JSON.stringify(rows))
  const hit = T.parseHisClause('（掂勺）')
  ok(hit && hit.zone === 'face' && hit.act === '揉', '表里的词认得出', JSON.stringify(hit))

  // 删掉：立刻失忆
  unlinkSync(file)
  ok(T.hisNouns().length === 0, '删了就空', String(T.hisNouns().length))
  ok(!T.parseHisClause('（掂勺）'), '删了就不认')
} finally {
  if (backup != null) writeFileSync(file, backup)
  else if (existsSync(file)) unlinkSync(file)
}

if (failed) { console.error(`[失败] ${failed} 项`); process.exitCode = 1 } else console.log('全过')
