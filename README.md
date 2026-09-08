# wiki-dnd-parser

项目简介

- 用途：把 5etools 的中英文数据整理为适合 MediaWiki/灰机Wiki 导入的结构化 JSON 与 HTML 片段。
- 入口脚本：`src/prepareData.ts`（`npm run start`）。
- 辅助脚本：`src/getGitRepo.ts`（`npm run getCnRepo`，按需拉取源数据）。\
  `src/wikiPageGenerator.ts`（`npm run page`，根据 `./output` 目录下输出的 JSON 文件，生成对应的 wiki 内容页面）
  `src/list-files.ts`（`npm run listFiles`，输出output跟page文件对应页面名的收集表格）
  `src/generateRaceTable.ts`（`npm run racetable`，补全`子种族名字替换词典.xlsx`缺失数据）
- 所有脚本均提供 `:homebrew` 后缀版本（如 `npm run start:homebrew`），用于处理第三方自制（homebrew）数据。

运行逻辑概览

1. `createOutputFolders` 清空并重建 `./output` 目录结构。
2. 从 `src/config.ts` 的 `DATA_EN_DIR` / `DATA_ZH_DIR` 读取 JSON。
3. 依次处理：书籍、专长、物品基础数据、物品、法术、怪物。
4. 各 \*Mgr / exporter 做中英合并、ID 对齐、缺失记录。
5. `parseContent` 将 entries 解析为 HTML，并把 `{@tag ...}` 转成 `{{@tag|...}}`。
6. 输出产物到 `./output`，最后生成日志、ID 对照与标签统计。

导出架构
所有类型使用独立导出器（`src/exporters/*`），通过 `Promise.all` 并行处理提升性能：

| 导出器文件                        | 负责类型                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `spellExporter.ts`           | spell                                                                                          |
| `bestiaryExporter.ts`        | bestiary                                                                                       |
| `itemExporter.ts`            | item（baseItem + item + magicVariant）                                                           |
| `raceExporter.ts`            | race                                                                                           |
| `backgroundExporter.ts`      | background                                                                                     |
| `hazardExporter.ts`          | hazard                                                                                         |
| `trapExporter.ts`            | trap                                                                                           |
| `classExporter.ts`           | class / subclass                                                                               |
| `adventureExporter.ts`       | adventure（生成 namelist）                                                                         |
| `deityExporter.ts`           | deity                                                                                          |
| `languageExporter.ts`        | language                                                                                       |
| `rewardExporter.ts`          | reward                                                                                         |
| `psionicExporter.ts`         | psionic                                                                                        |
| `recipeExporter.ts`          | recipe                                                                                         |
| `homecraftExporter.ts`       | homecraft                                                                                      |
| `deckExporter.ts`            | deck                                                                                           |
| `bastionExporter.ts`         | bastion                                                                                        |
| `cultExporter.ts`            | cult                                                                                           |
| `boonExporter.ts`            | boon                                                                                           |
| `charOptionExporter.ts`      | charoption                                                                                     |
| `optionalFeatureExporter.ts` | optionalfeature                                                                                |
| `genericFileExporter.ts`     | 通用 file 模式核心逻辑（供上述独立导出器调用）                                                                     |
| `genericProfileExporter.ts`  | 其他通用类型（vehicle、vehicleUpgrade、variantrule、monsterfeature、condition、disease、skill、sense、object） |

- 共享 helper：`src/exporters/shared.ts` / `src/exporters/fluff.ts`
  - 负责 ID、重印版本聚合、fluff `_copy/_mod` 继承、双语拆分与文件名去重。

文件名非法字符转义表
文件名中的非法字符会被转义为安全的字符序列（Windows 和 Linux 通用）：

| 符号 | \\    | /(页面分隔符) | :     | \*    | "     | <     | >     | \|    | ?     | /(文本) |
| -- | ----- | -------- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| 转义 | \_0\_ | \_1\_    | \_2\_ | \_3\_ | \_4\_ | \_5\_ | \_6\_ | \_7\_ | \_8\_ | \_9\_ |

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

json 输出产物（`npm run start`）：

- `output/collection/bookCollection.json`
- `output/collection/featCollection.json`
- `output/collection/itemPropertyCollection.json`
- `output/collection/itemTypeCollection.json`
- `output/collection/itemMasteryCollection.json`
- `output/item/{来源}/*.json`（基础物品与物品，按来源分文件夹）
- `output/spell/{来源}/*.json`
- `output/bestiary/{来源}/*.json`
- `output/race/{母种族}/{来源}/*.json`
- `output/background/{来源}/*.json`
- `output/trap/{来源}/*.json`
- `output/hazard/{来源}/*.json`
- `output/class/{母职业}/{来源}/*.json`
- `output/subclass/{来源}/*.json`
- `output/adventure/{来源}/*.json`
- `output/feat/{来源}/*.json`
- `output/deity/{来源}/*.json`
- `output/language/{来源}/*.json`
- `output/reward/{来源}/*.json`
- `output/psionic/{来源}/*.json`
- `output/recipe/{来源}/*.json`
- `output/homecraft/{来源}/*.json`
- `output/deck/{来源}/*.json`
- `output/bastion/{来源}/*.json`
- `output/cult/{来源}/*.json`
- `output/boon/{来源}/*.json`
- `output/charoption/{来源}/*.json`
- `output/optionalfeature/{来源}/*.json`
- `output/vehicle/{来源}/*.json`
- `output/vehicleUpgrade/{来源}/*.json`
- `output/variantrule/{来源}/*.json`
- `output/monsterfeature/{来源}/*.json`
- `output/condition/{来源}/*.json`
- `output/disease/{来源}/*.json`
- `output/skill/{来源}/*.json`
- `output/sense/{来源}/*.json`
- `output/object/{来源}/*.json`
- `output/tables/{来源}/*.json`（表格数据，特殊处理）
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
- `output_page/扩展/{来源}/*.wiki`
- `output_page/模组/{来源}/*.wiki`
- `output_page/职业/`
  - `output_page/职业/{来源}/*.wiki`
  - `output_page/职业/2014（或2024）/*.wiki`

Wiki 文件名格式：**中文名.wiki**（按来源分文件夹存放）

使用说明

1. 准备 Node.js 与 git；按需执行 `npm install`（请手动执行）。
2. 获取数据（二选一，也可同时执行）：
   - **官方数据**：运行 `npm run getCnRepo` 拉取官方仓库数据（中英文）。
   - **第三方合作（homebrew）数据（可选）**：运行 `npm run getCnRepo:homebrew` 拉取 homebrew 仓库数据（见下方 Homebrew 模式说明）。
   - 如果不通过脚本拉取文件，而选择手动放数据，可在`src\config.ts`中修改文件路径。
   - 运行 `npm run racetable` 补全`子种族名字替换词典.xlsx`缺失数据，然后手动补充替换项。
```bash
# 拉取官方数据
npm run getCnRepo

# 拉取第三方合作数据
npm run getCnRepo:homebrew

# 补全子种族名字替换词典
npm run racetable
```
3. 修改 `src/config.ts` 的 `DATA_EN_DIR` / `DATA_ZH_DIR`。
4. 运行 `npm run start` 生成 `./output`（如需合并 homebrew 数据，使用 `npm run start:homebrew`）。
```bash
# JSON 输出（./output）
npm run start

# JSON 输出（./output，包括homebrew）
npm run start:homebrew
```
5. 查看 `output/logs.json` 与 `output/idMgr.xlsx` 定位缺失翻译或 ID 不匹配。
6. 确认没有错误后，运行 `npm run page` 生成 `./output_page`（homebrew 模式：`npm run page:homebrew`）。
```bash
# Wiki 页面输出（./output_page）
npm run page

# homebrew Wiki 页面输出（./output_page，包括homebrew）
npm run page:homebrew
```
7. 运行 `npm run listFiles` 可查看`./output`与`./output_page`输出文件列表。
```bash
# 查看输出文件列表
npm run listFiles
```
---
### Homebrew 模式（`*:homebrew` 指令）

项目支持处理 5etools 生态的第三方自制（homebrew）数据，所有核心指令均提供 `:homebrew` 后缀版本。homebrew 数据仓库来自 [TheGiddyLimit/homebrew](https://github.com/TheGiddyLimit/homebrew)（英文）和 [tjliqy/homebrew](https://github.com/tjliqy/homebrew)（中文翻译），数据存放于 `./input/5e-en/homebrew` 和 `./input/5e-cn/homebrew`。

#### 指令对照表

| 指令 | 对应脚本 | 作用（相对基础版本的差异） |
| --- | ------- | ------------------------ |
| `npm run getCnRepo:homebrew` | `getGitRepo.ts --homebrew` | 拉取包括 homebrew 仓库数据（blobless clone + sparse-checkout 仅下载 JSON）；生成 `replace-logs-homebrew.json` 跟踪变更；**全类别数据重组**（遍历所有类别目录的 JSON 文件，将参杂到错误目录的数据剪切到正确的类别目录，如 `spell/`、`item/`、`creature/`、`race/`、`class/`、`subrace/`、`table/`、`trap/`、`variantrule/`、`vehicle/`、`encounter/` 等 30+ 种类型）；**最后解析 `_copy` 引用**（在重组后的干净数据上解析 homebrew 引用的官方数据） |
| `npm run start:homebrew` | `prepareData.ts --homebrew` | 在加载官方数据时，自动从 `HOMEBREW_EN_DIR`/`HOMEBREW_ZH_DIR` 加载对应的 homebrew 分类数据并合并到各导出器处理 |
| `npm run page:homebrew` | `prepareData.ts --page --homebrew` + `generateBookPages.ts` | 先生成含 homebrew 数据的 JSON 输出，再生成对应的 Wiki 页面（包含 homebrew 内容） |
| `npm run generateContents:homebrew` | `generate-contents.ts --homebrew` | 合并 homebrew 的 book/adventure 元数据到出版物目录 `output/contents/` |
| `npm run splitBooks:homebrew` | `split-books.ts --homebrew` | 加载 homebrew 的 book/adventure 数据（含 book data 内容）到分割处理中 |
| `npm run racetable:homebrew` | `generateRaceTable.ts --homebrew` | 合并 homebrew 的 subrace/race 数据到`子种族名字替换词典.xlsx` |

#### `npm run getCnRepo:homebrew` 详细流程

1. **克隆仓库**：使用 `git clone --depth 2 --filter=blob:none --no-checkout` 进行 blobless 克隆，仅下载 tree 元数据
2. **稀疏签出**：通过 `sparse-checkout --no-cone` 仅签出 `*.json` 文件，跳过非 JSON 资源
3. **生成变更日志**：对比最近两次 commit，生成 `replace-logs-homebrew.json`（记录增删改的文件与数组）
4. **全类别数据重组**（第1步）：遍历所有类别目录下的 JSON 文件，检查每个键是否映射到 `KEY_TO_DIR` 中的其他目录。若发现数据参杂到错误目录（如 `spell/` 目录下出现 `monster` 数据、`item/` 目录下出现 `spell` 数据等），则将其剪切到正确的类别目录并合并到已有文件。覆盖所有 30+ 种类型目录，不仅限于 collection。**这是解决 homebrew 数据混乱的关键步骤。**
5. **解析 `_copy` 引用**（第2步）：在重组后的干净数据上解析 `_copy` 引用，确保引用指向正确的目录路径，避免因数据移动导致的引用断裂

#### Homebrew 数据合并机制

- `src/homebrewLoader.ts` 是 homebrew 模式的核心加载模块
- 通过 `loadHomebrewByKeys(locale, keys)` 按需加载指定类型（如 `['spell']`、`['monster']`）的数据
- 支持目录名异常映射（如 `monster` 键对应 `creature/` 目录，`boon` 对应 `boon/` 和 `cultboon/` 目录）
- 数据缓存机制：同一键的多次调用直接从内存缓存返回
- 通过 `mergeHomebrewBilingual()` 自动合并中英文 homebrew 数据到官方数据中

#### 配置项（`src/config.ts`）

```
HOMEBREW_EN_DIR: './input/5e-en/homebrew'   // 英文 homebrew 数据目录
HOMEBREW_ZH_DIR: './input/5e-cn/homebrew'   // 中文 homebrew 数据目录
```

运行日志格式
各类型完成时输出统一格式日志：`[prepareData] {类型} 完成 ({数量})`

- book、feat、itemProperty、itemMastery、itemType、spell、bestiary、item、adventure、race、background、hazard、trap、class、subclass
- deity、vehicle、vehicleUpgrade、variantrule、monsterfeature、optionalfeature、condition、disease、language、skill、sense、charoption、bastion、deck、cult、boon、recipe、reward、object、psionic、homecraft

备注

- `src/getGitRepo.ts` 通过 `git clone` + `sparse-checkout` 仅下载 `data/` 与 `data-bak` 目录。
- `src/contentGen.ts` 会把表格/列表等结构转为 HTML，并统一收集 `{@tag}` 参数。
- `src/preprocess.ts` 未接入脚本流程，如需使用需自行调用。
- 默认配置是相对路径，跨平台可用；如数据位置不同请改 `src/config.ts`。