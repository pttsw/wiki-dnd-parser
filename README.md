# wiki-dnd-parser

项目简介
- 用途：把 5etools 的中英文数据整理为适合 MediaWiki/灰机Wiki 导入的结构化 JSON 与 HTML 片段。
- 入口脚本：`src/prepareData.ts`（`npm run start`）。
- 辅助脚本：`src/getGitRepo.ts`（`npm run getCnRepo`，按需拉取源数据）。  
`src/wikiPageGenerator.ts`（`npm run page`，输出 wiki 内容页面）

运行逻辑概览
1. `createOutputFolders` 清空并重建 `./output` 目录结构。
2. 从 `src/config.ts` 的 `DATA_EN_DIR` / `DATA_ZH_DIR` 读取 JSON。
3. 依次处理：书籍、专长、物品基础数据、物品、法术、怪物。
4. 新增 `src/exporters/*` 共享导出层后，剩余 wiki JSON 类型由 profile 驱动导出，`class/subclass` 走独立 special-case exporter。
5. 各 *Mgr / exporter 做中英合并、ID 对齐、缺失记录。
6. `parseContent` 将 entries 解析为 HTML，并把 `{@tag ...}` 转成 `{{@tag|...}}`。
7. 输出产物到 `./output`，最后生成日志、ID 对照与标签统计。

导出架构
- 旧路径保留：`item` / `spell` / `bestiary` 仍由原有 manager 负责。
- 通用 profile exporter：`src/exporters/genericProfileExporter.ts`
  - 负责 `race`、`background`、`trap`、`hazard` 等文件型输出。
  - 负责 `deity`、`vehicleUpgrade`、`condition`、`disease`、`language` 等 collection 型输出。
- `class/subclass` 特例 exporter：`src/exporters/classProfileExporter.ts`
  - 单独处理职业索引文件、子职业去重、`superiorfork` 关系和子职业列表回填。
- 共享 helper：`src/exporters/shared.ts` / `src/exporters/fluff.ts`
  - 负责 ID、重印版本聚合、fluff `_copy/_mod` 继承、双语拆分与文件名去重。

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
- `output/item/*.json`（基础物品与物品）
- `output/spell/*.json`
- `output/bestiary/*.json`
- `output/race/*.json`
- `output/background/*.json`
- `output/trap/*.json`
- `output/hazard/*.json`
- `output/class/*.json`
- `output/subclass/*.json`
- `output/namelist/*.json`（名字列表）
- `output/contents/book/*.json` / `output/contents/adventure/*.json`（目录）
- `output/logs.json`（缺失或异常记录）
- `output/idMgr.json` / `output/idMgr.xlsx`（中英 ID 对照）
- `output/tags.json`（解析到的 @tag 列表）

大多数json结构：**类别_1_来源id_1_英文名（章节文件为章节id）.json**

使用说明
1. 准备 Node.js 与 git；按需执行 `npm install`（请手动执行）。
2. 获取数据（二选一）：
   - 准备本地 data 目录并配置路径。
   - 或运行 `npm run getCnRepo` 拉取仓库数据。
3. 修改 `src/config.ts` 的 `DATA_EN_DIR` / `DATA_ZH_DIR`。
4. 运行 `npm run start` 生成 `./output`。
5. 查看 `output/logs.json` 与 `output/idMgr.xlsx` 定位缺失翻译或 ID 不匹配。
6. 确认没有错误后，运行 `npm run page` 生成 `./output_page`。

备注
- `src/getGitRepo.ts` 通过 `git clone` + `sparse-checkout` 仅下载 `data/` 与 `data-bak` 目录。
- `src/contentGen.ts` 会把表格/列表等结构转为 HTML，并统一收集 `{@tag}` 参数。
- `src/preprocess.ts` 未接入脚本流程，如需使用需自行调用。
- 默认配置是相对路径，跨平台可用；如数据位置不同请改 `src/config.ts`。
