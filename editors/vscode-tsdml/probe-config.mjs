// 验证 @config 块在现有 parser 下的真实表现
import { parse } from "@tsdml/compiler"

const cases = [
  ["文档根 @config{}", "@config { @schema: \"https://x/dml.schema.dml\" }"],
  ["元素内 @config{}", "project { @config { @schema: \"x\" } }"],
  ["元素内 @config:{}（带冒号）", "project { @config: { @schema: \"x\" } }"],
  ["普通命名空间 @ns:{}", "project { @ns: { a: 1 } }"],
  ["@config 后接 project（同文件）", "@config { @schema: \"x\" }\n\nproject {\n  @name: \"p\"\n}"],
]

for (const [label, src] of cases) {
  const r = parse(src)
  const errs = r.errors ?? []
  console.log(`${errs.length ? "❌" : "✅"} ${label}`)
  for (const e of errs) console.log(`      → ${e.message}`)
}
