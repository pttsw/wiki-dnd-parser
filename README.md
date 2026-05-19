# wiki-dnd-parser

项目简介
- 用途：把 5etools 的中英文数据整理为适合 MediaWiki/灰机Wiki 导入的结构化 JSON 与 HTML 片段。
- 入口脚本：`src/prepareData.ts`（`npm run start`）。
- 辅助脚本：`src/getGitRepo.ts`（`npm run getCnRepo`，按需拉取源数据）。  
`src/wikiPageGenerator.ts`（`npm run page`，输出 wiki 内容页面）
`src/list-files.ts`（`npm run listFiles`，输出output跟page文件对应页面名的收集表格）

运行逻辑概览
1. `createOutputFolders` 清空并重建 `./output` 目录结构。
2. 从 `src/config.ts` 的 `DATA_EN_DIR` / `DATA_ZH_DIR` 读取 JSON。
3. 依次处理：书籍、专长、物品基础数据、物品、法术、怪物。
4. 各 *Mgr / exporter 做中英合并、ID 对齐、缺失记录。
5. `parseContent` 将 entries 解析为 HTML，并把 `{@tag ...}` 转成 `{{@tag|...}}`。
6. 输出产物到 `./output`，最后生成日志、ID 对照与标签统计。

导出架构
所有类型使用独立导出器（`src/exporters/*`），通过 `Promise.all` 并行处理提升性能：

| 导出器文件 | 负责类型 |
|-----------|---------|
| `spellExporter.ts` | spell |
| `bestiaryExporter.ts` | bestiary |
| `itemExporter.ts` | item（baseItem + item + magicVariant） |
| `raceExporter.ts` | race |
| `backgroundExporter.ts` | background |
| `hazardExporter.ts` | hazard |
| `trapExporter.ts` | trap |
| `classExporter.ts` | class / subclass |
| `adventureExporter.ts` | adventure（生成 namelist） |
| `genericProfileExporter.ts` | 其他通用类型（deity、vehicleUpgrade、condition 等 collection 型输出） |

- 共享 helper：`src/exporters/shared.ts` / `src/exporters/fluff.ts`
  - 负责 ID、重印版本聚合、fluff `_copy/_mod` 继承、双语拆分与文件名去重。

文件名非法字符转义表
文件名中的非法字符会被转义为安全的字符序列（Windows 和 Linux 通用）：

| 符号 | \\ | /(页面分隔符) | : | * | " | < | > | \| | ? | /(文本) |
|------|----|---|----|----|----|----|----|----|---|---|
| 转义 | _0_ | _1_ | _2_ | _3_ | _4_ | _5_ | _6_ | _7_ | _8_ | _9_ |

输入数据与配置
- `src/config.ts` 定义：
  - `DATA_EN_DIR` 英文数据根目录（应包含 `books.json`、`items.json`、`spells/` 等）。
  - `DATA_ZH_DIR` 中文数据根目录。
  - 默认值为 `./input/5e-en/data` 与 `./input/5e-cn/data`。
- `npm run getCnRepo` 使用 HTTPS 从 `https://github.com/tjliqy/5etools-mirror-2.github.io.git` 拉取数据：
  - `data` -> `./input/5e-cn/data`（中文）
  - `data-bak` -> `./input/5e-en/data`（英文）
  - 如果数据不在 `./input/.../data`，请手动调整 `src/config.ts`。
- 目录清单会被 `createOutputFolders` 重置，请避免把其他文件放在 `./output` 下。

输出产物
- `output/collection/bookCollection.json`
- `output/collection/featCollection.json`
- `output/collection/itemPropertyCollection.json`
- `output/collection/itemTypeCollection.json`
- `output/collection/*Collection.json`
  - 现已覆盖 `deity`、`vehicle`、`vehicleUpgrade`、`variantrule`、`monsterfeature`、`optionalfeature`、`condition`、`disease`、`language`、`skill`、`sense`、`charoption`、`bastion`、`deck`、`cult`、`boon`、`recipe`、`reward`、`object`、`psionic`
- `output/item/{来源}/*.json`（基础物品与物品，按来源分文件夹）
- `output/spell/{来源}/*.json`
- `output/bestiary/{来源}/*.json`
- `output/race/{来源}/*.json`
- `output/background/{来源}/*.json`
- `output/trap/{来源}/*.json`
- `output/hazard/{来源}/*.json`
- `output/class/{来源}/*.json`
- `output/subclass/{来源}/*.json`
- `output/adventure/{来源}/*.json`
- `output/namelist/*.json`（名字列表）
- `output/contents/book/*.json` / `output/contents/adventure/*.json`（目录）
- `output/logs.json`（缺失或异常记录）
- `output/idMgr.json` / `output/idMgr.xlsx`（中英 ID 对照）
- `output/tags.json`（解析到的 @tag 列表）

输出文件名格式：**英文名.json**（按来源分文件夹存放）

Wiki 页面输出产物（`npm run page`）：
- `output_page/法术/{来源}/*.wiki`
- `output_page/物品/{来源}/*.wiki`
- `output_page/怪物/{来源}/*.wiki`

Wiki 文件名格式：**中文名.wiki**（按来源分文件夹存放）

使用说明
1. 准备 Node.js 与 git；按需执行 `npm install`（请手动执行）。
2. 获取数据（二选一）：
   - 准备本地 data 目录并配置路径。
   - 或运行 `npm run getCnRepo` 拉取仓库数据。
3. 修改 `src/config.ts` 的 `DATA_EN_DIR` / `DATA_ZH_DIR`。
4. 运行 `npm run start` 生成 `./output`。
5. 查看 `output/logs.json` 与 `output/idMgr.xlsx` 定位缺失翻译或 ID 不匹配。
6. 确认没有错误后，运行 `npm run page` 生成 `./output_page`。

运行日志格式
各类型完成时输出统一格式日志：`[prepareData] {类型} 完成 ({数量})`
- spell、bestiary、item、race、background、hazard、trap、class、subclass、adventure

备注
- `src/getGitRepo.ts` 通过 `git clone` + `sparse-checkout` 仅下载 `data/` 与 `data-bak` 目录。
- `src/contentGen.ts` 会把表格/列表等结构转为 HTML，并统一收集 `{@tag}` 参数。
- `src/preprocess.ts` 未接入脚本流程，如需使用需自行调用。
- 默认配置是相对路径，跨平台可用；如数据位置不同请改 `src/config.ts`。
