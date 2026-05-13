import fs from 'fs/promises';
import path from 'path';

type CopyMeta = {
    name: string;
    source: string;
    _preserve?: Record<string, boolean>;
    _mod?: Record<string, any>;
    _templates?: Array<{ name: string; source: string }>;
};

type ModEntry = {
    mode: string;
    [key: string]: any;
};

class CopyApplier {
    private dataMap: Map<string, any>;
    private templateMap: Map<string, any>;
    private idToSource: Map<string, { name: string; source: string }>;
    private fileMap: Map<string, any>;
    private visited: Set<string>;

    constructor() {
        this.dataMap = new Map();
        this.templateMap = new Map();
        this.idToSource = new Map();
        this.fileMap = new Map();
        this.visited = new Set();
    }

    getId(name: string, source: string): string {
        return `${name.trim()}|${source}`;
    }

    loadFromDirectory(dirPath: string, baseDir?: string) {
        this.dataMap.clear();
        this.idToSource.clear();
        this.fileMap.clear();
        return this.loadDirectoryRecursive(dirPath, baseDir || dirPath);
    }

    private async loadDirectoryRecursive(dirPath: string, baseDir: string): Promise<void> {
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);

                if (entry.isDirectory()) {
                    await this.loadDirectoryRecursive(fullPath, baseDir);
                } else if (entry.isFile() && entry.name.endsWith('.json')) {
                    if (entry.name === 'template.json') {
                        await this.loadTemplateFile(fullPath);
                    } else if (entry.name.startsWith('bestiary-')) {
                        await this.loadJsonFile(fullPath, baseDir);
                    }
                }
            }
        } catch (error) {
            console.error(`Error loading directory ${dirPath}:`, error);
        }
    }

    private async loadTemplateFile(filePath: string): Promise<void> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(content);

            if (data.monsterTemplate && Array.isArray(data.monsterTemplate)) {
                for (const template of data.monsterTemplate) {
                    if (template.name && template.source) {
                        const id = this.getId(template.name, template.source);
                        this.templateMap.set(id, template);
                    }
                    if (template.ENG_name && template.source) {
                        const id = this.getId(template.ENG_name, template.source);
                        this.templateMap.set(id, template);
                    }
                }
            }
        } catch (error) {
            console.error(`Error loading template file ${filePath}:`, error);
        }
    }

    private async loadJsonFile(filePath: string, baseDir: string): Promise<void> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(content);
            
            const relativePath = path.relative(baseDir, filePath);
            this.fileMap.set(relativePath, data);

            const dataKeys = Object.keys(data);
            const primaryKey = this.findPrimaryDataKey(dataKeys);

            if (primaryKey && Array.isArray(data[primaryKey])) {
                for (const item of data[primaryKey]) {
                    if (item.name && item.source) {
                        const id = this.getId(item.name, item.source);
                        this.dataMap.set(id, item);
                        this.idToSource.set(id, { name: item.name, source: item.source });
                    }
                    if (item.ENG_name && item.source) {
                        const id = this.getId(item.ENG_name, item.source);
                        this.dataMap.set(id, item);
                        this.idToSource.set(id, { name: item.ENG_name, source: item.source });
                    }
                }
            }
        } catch (error) {
            console.error(`Error loading file ${filePath}:`, error);
        }
    }

    private findPrimaryDataKey(keys: string[]): string | undefined {
        const priorityKeys = [
            'monster', 'spell', 'item', 'background', 'class', 'feat',
            'race', 'subclass', 'subrace', 'condition', 'disease',
            'psionic', 'reward', 'table', 'trait', 'variantrule'
        ];

        for (const key of priorityKeys) {
            if (keys.includes(key)) {
                return key;
            }
        }

        for (const key of keys) {
            if (!key.startsWith('_')) {
                return key;
            }
        }

        return undefined;
    }

    resolveAllCopies(): void {
        for (const [id, item] of this.dataMap) {
            this.visited.clear();
            this.resolveCopy(item);
        }
    }

    private resolveCopy(item: any): void {
        const copy = item._copy;
        if (!copy) return;

        // 尝试查找源数据 - 先尝试 ENG_name，再尝试 name
        let copyItem: any = undefined;
        if (copy.ENG_name && copy.source) {
            const copyId = this.getId(copy.ENG_name, copy.source);
            copyItem = this.dataMap.get(copyId);
        }
        if (!copyItem && copy.name && copy.source) {
            const copyId = this.getId(copy.name, copy.source);
            copyItem = this.dataMap.get(copyId);
        }

        if (!copyItem) {
            // console.warn(`Could not find copy source: ${copy.ENG_name || copy.name}|${copy.source}`);
            return;
        }

        const copyId = this.getId(copy.ENG_name || copy.name, copy.source);
        
        if (this.visited.has(copyId)) {
            console.warn(`Circular copy reference detected: ${copyId}`);
            return;
        }

        this.visited.add(copyId);
        this.resolveCopy(copyItem);

        const preserve = copy._preserve || {};
        const mod = copy._mod;
        const templates = copy._templates;

        const mergeRequiresPreserve = new Set([
            'legendaryGroup', 'environment', 'soundClip', 'altArt',
            'variant', 'dragonAge', 'familiar'
        ]);

        // 先复制源数据属性
        for (const key of Object.keys(copyItem)) {
            if (key === '_copy' || key === '_isCopy') continue;
            
            // 不复制 reprintedAs 和 _versions
            if (key === 'reprintedAs' || key === '_versions' || key === 'referenceSources') continue;
            
            if (item[key] !== undefined) continue;

            if (mergeRequiresPreserve.has(key) && !preserve['*'] && !preserve[key]) {
                continue;
            }

            item[key] = JSON.parse(JSON.stringify(copyItem[key]));
        }

        // 再处理模板 - 与普通 copyItem 复制逻辑不同，需要使用模板文件的 apply 属性
        if (templates) {
            for (const template of templates) {
                let templateData: any = undefined;
                if (template.ENG_name && template.source) {
                    const templateId = this.getId(template.ENG_name, template.source);
                    templateData = this.templateMap.get(templateId);
                }
                if (!templateData && template.name && template.source) {
                    const templateId = this.getId(template.name, template.source);
                    templateData = this.templateMap.get(templateId);
                }
                
                if (templateData && templateData.apply) {
                    // 首先应用 _root 属性，这些会覆盖已有属性
                    if (templateData.apply._root) {
                        for (const key of Object.keys(templateData.apply._root)) {
                            item[key] = JSON.parse(JSON.stringify(templateData.apply._root[key]));
                        }
                    }
                    // 然后应用 _mod 部分
                    if (templateData.apply._mod) {
                        this.applyMods(item, templateData.apply._mod);
                    }
                } else {
                    // console.warn(`Could not find template data: ${template.ENG_name || template.name}|${template.source}`);
                }
            }
        }

        if (mod) {
            this.applyMods(item, mod);
        }

        delete item._copy;
        item._isCopy = true;
    }

    private applyMods(item: any, mods: Record<string, any>): void {
        const modEntries = Object.entries(mods);

        modEntries.sort(([a], [b]) => {
            const aUnderscore = a.startsWith('_');
            const bUnderscore = b.startsWith('_');
            if (aUnderscore !== bUnderscore) return aUnderscore ? -1 : 1;
            const aStar = a === '*';
            const bStar = b === '*';
            if (aStar !== bStar) return aStar ? -1 : 1;
            return a.localeCompare(b);
        });

        for (const [prop, modInfo] of modEntries) {
            // 处理 modInfo 可能是单个对象或数组的情况
            let modArray: any[];
            if (Array.isArray(modInfo)) {
                modArray = modInfo;
            } else if (modInfo && typeof modInfo === 'object') {
                // 如果是对象，检查是否有 mode 属性
                if (modInfo.mode) {
                    modArray = [modInfo];
                } else {
                    // 也可能是键值对的对象，需要逐个处理
                    modArray = Object.entries(modInfo).map(([key, val]) => ({
                        ...(val as any),
                        _propKey: key // 保存原始键名
                    }));
                }
            } else {
                modArray = [modInfo];
            }

            for (const mod of modArray) {
                if (prop === '*') {
                    this.applyStarMod(item, mod);
                } else {
                    this.applyPropMod(item, prop, mod);
                }
            }
        }
    }

    private applyStarMod(item: any, mod: ModEntry): void {
        switch (mod.mode) {
            case 'setProp':
                item[mod.prop] = mod.value;
                break;
            case 'scalarAddProp':
                this.applyScalarAddProp(item, mod);
                break;
            case 'scalarMultProp':
                this.applyScalarMultProp(item, mod);
                break;
            case 'calculateProp':
                this.applyCalculateProp(item, mod);
                break;
            case 'replaceName':
                if (typeof item.name === 'string') {
                    item.name = item.name.replace(new RegExp(mod.replace, 'g'), mod.with);
                }
                break;
            case 'replaceTxt':
                this.applyReplaceTxt(item, mod);
                break;
            case 'addSenses':
                this.applyAddSenses(item, mod);
                break;
            case 'addSaves':
                this.applyAddSaves(item, mod);
                break;
            case 'addSkills':
                this.applyAddSkills(item, mod);
                break;
            case 'addAllSaves':
                this.applyAddAllSaves(item, mod);
                break;
            case 'addAllSkills':
                this.applyAddAllSkills(item, mod);
                break;
            case 'addSpells':
                this.applyAddSpells(item, mod);
                break;
            case 'replaceSpells':
                this.applyReplaceSpells(item, mod);
                break;
            case 'removeSpells':
                this.applyRemoveSpells(item, mod);
                break;
            case 'maxSize':
                this.applyMaxSize(item, mod);
                break;
            case 'scalarMultXp':
                this.applyScalarMultXp(item, mod);
                break;
            case 'scalarAddHit':
                this.applyScalarAddHit(item, mod);
                break;
            case 'scalarAddDc':
                this.applyScalarAddDc(item, mod);
                break;
        }
    }

    private applyPropMod(item: any, prop: string, mod: ModEntry): void {
        switch (mod.mode) {
            case 'prependArr':
                this.applyPrependArr(item, prop, mod);
                break;
            case 'appendArr':
                this.applyAppendArr(item, prop, mod);
                break;
            case 'appendIfNotExistsArr':
                this.applyAppendIfNotExistsArr(item, prop, mod);
                break;
            case 'replaceArr':
                this.applyReplaceArr(item, prop, mod);
                break;
            case 'replaceOrAppendArr':
                this.applyReplaceOrAppendArr(item, prop, mod);
                break;
            case 'insertArr':
                this.applyInsertArr(item, prop, mod);
                break;
            case 'removeArr':
                this.applyRemoveArr(item, prop, mod);
                break;
            case 'renameArr':
                this.applyRenameArr(item, prop, mod);
                break;
            case 'setProp':
                item[prop] = mod.value;
                break;
            case 'scalarAddProp':
                this.applyScalarAddProp(item, { ...mod, prop });
                break;
            case 'scalarMultProp':
                this.applyScalarMultProp(item, { ...mod, prop });
                break;
            case 'calculateProp':
                this.applyCalculateProp(item, { ...mod, prop });
                break;
            case 'appendStr':
                this.applyAppendStr(item, prop, mod);
                break;
            case 'prefixSuffixStringProp':
                this.applyPrefixSuffixStringProp(item, prop, mod);
                break;
        }
    }

    private applyPrependArr(item: any, prop: string, mod: ModEntry): void {
        const items = Array.isArray(mod.items) ? mod.items : [mod.items];
        const current = item[prop];
        if (Array.isArray(current)) {
            item[prop] = [...items, ...current];
        } else {
            item[prop] = items;
        }
    }

    private applyAppendArr(item: any, prop: string, mod: ModEntry): void {
        const items = Array.isArray(mod.items) ? mod.items : [mod.items];
        const current = item[prop];
        if (Array.isArray(current)) {
            item[prop] = [...current, ...items];
        } else {
            item[prop] = items;
        }
    }

    private applyAppendIfNotExistsArr(item: any, prop: string, mod: ModEntry): void {
        const items = Array.isArray(mod.items) ? mod.items : [mod.items];
        const current = item[prop];
        const currentArray = Array.isArray(current) ? current : [];

        for (const newItem of items) {
            const exists = currentArray.some((existing) => {
                if (typeof existing === 'string' && typeof newItem === 'string') {
                    return existing === newItem;
                }
                if (existing && newItem && existing.name && newItem.name) {
                    return existing.name === newItem.name;
                }
                return false;
            });

            if (!exists) {
                currentArray.push(newItem);
            }
        }

        item[prop] = currentArray;
    }

    private applyReplaceArr(item: any, prop: string, mod: ModEntry): void {
        const items = Array.isArray(mod.items) ? mod.items : [mod.items];
        const current = item[prop];
        const replace = mod.replace;

        if (Array.isArray(current)) {
            const index = current.findIndex((item) => {
                if (typeof item === 'string' && typeof replace === 'string') {
                    return item === replace;
                }
                if (item && item.name && replace) {
                    return item.name === replace;
                }
                return false;
            });

            if (index !== -1) {
                current.splice(index, 1, ...items);
            }
        }
    }

    private applyReplaceOrAppendArr(item: any, prop: string, mod: ModEntry): void {
        const items = Array.isArray(mod.items) ? mod.items : [mod.items];
        const current = item[prop];
        const replace = mod.replace;
        let found = false;

        if (Array.isArray(current)) {
            const index = current.findIndex((item) => {
                if (typeof item === 'string' && typeof replace === 'string') {
                    return item === replace;
                }
                if (item && item.name && replace) {
                    return item.name === replace;
                }
                return false;
            });

            if (index !== -1) {
                current.splice(index, 1, ...items);
                found = true;
            }
        }

        if (!found) {
            if (Array.isArray(current)) {
                item[prop] = [...current, ...items];
            } else {
                item[prop] = items;
            }
        }
    }

    private applyInsertArr(item: any, prop: string, mod: ModEntry): void {
        const items = Array.isArray(mod.items) ? mod.items : [mod.items];
        const current = item[prop];
        const index = mod.index || 0;

        if (Array.isArray(current)) {
            const newArray = [...current];
            newArray.splice(index, 0, ...items);
            item[prop] = newArray;
        } else {
            item[prop] = items;
        }
    }

    private applyRemoveArr(item: any, prop: string, mod: ModEntry): void {
        const names = Array.isArray(mod.names) ? mod.names : [mod.names];
        const current = item[prop];

        if (Array.isArray(current)) {
            item[prop] = current.filter((item) => {
                for (const name of names) {
                    if (typeof item === 'string' && item === name) {
                        return false;
                    }
                    if (item && item.name && item.name === name) {
                        return false;
                    }
                }
                return true;
            });
        }
    }

    private applyRenameArr(item: any, prop: string, mod: ModEntry): void {
        const renames = Array.isArray(mod.renames) ? mod.renames : [mod];
        const current = item[prop];

        if (Array.isArray(current)) {
            for (const rename of renames) {
                const target = current.find((item) => {
                    if (typeof item === 'string' && item === rename.rename) {
                        return true;
                    }
                    if (item && item.name && item.name === rename.rename) {
                        return true;
                    }
                    return false;
                });

                if (target) {
                    if (typeof target === 'string') {
                        const index = current.indexOf(target);
                        current[index] = rename.with;
                    } else {
                        target.name = rename.with;
                    }
                }
            }
        }
    }

    private applyAppendStr(item: any, prop: string, mod: ModEntry): void {
        if (typeof item[prop] === 'string') {
            const joiner = mod.joiner || ' ';
            item[prop] = item[prop] + joiner + mod.str;
        }
    }

    private applyPrefixSuffixStringProp(item: any, prop: string, mod: ModEntry): void {
        if (typeof item[prop] === 'string') {
            if (mod.prefix) {
                item[prop] = mod.prefix + item[prop];
            }
            if (mod.suffix) {
                item[prop] = item[prop] + mod.suffix;
            }
        }
    }

    private applyScalarAddProp(item: any, mod: ModEntry): void {
        const prop = mod.prop;
        const scalar = mod.scalar || 0;

        if (prop === '*') {
            for (const key of Object.keys(item)) {
                if (typeof item[key] === 'number') {
                    item[key] += scalar;
                }
            }
        } else if (typeof item[prop] === 'number') {
            item[prop] += scalar;
        }
    }

    private applyScalarMultProp(item: any, mod: ModEntry): void {
        const prop = mod.prop;
        const scalar = mod.scalar || 1;
        const floor = mod.floor || false;

        if (prop === '*') {
            for (const key of Object.keys(item)) {
                if (typeof item[key] === 'number') {
                    item[key] *= scalar;
                    if (floor) item[key] = Math.floor(item[key]);
                }
            }
        } else if (typeof item[prop] === 'number') {
            item[prop] *= scalar;
            if (floor) item[prop] = Math.floor(item[prop]);
        }
    }

    private applyCalculateProp(item: any, mod: ModEntry): void {
        const prop = mod.prop;
        const formula = mod.formula;

        if (prop && formula) {
            try {
                const evaluated = this.evaluateFormula(formula, item);
                item[prop] = evaluated;
            } catch (error) {
                console.warn(`Failed to calculate formula: ${formula}`, error);
            }
        }
    }

    private evaluateFormula(formula: string, item: any): number {
        let result = formula;
        const matches = result.match(/\{\$(\w+)\}/g);
        if (matches) {
            for (const match of matches) {
                const varName = match.slice(2, -1);
                const value = this.getVariableValue(varName, item);
                if (value !== undefined) {
                    result = result.replace(match, String(value));
                }
            }
        }

        result = result.replace(/\{@[a-zA-Z0-9_]+\s*([^}]+)\}/g, '$1');
        result = result.replace(/\{@[a-zA-Z0-9_]+\}/g, '');

        try {
            return Function('"use strict"; return (' + result + ')')();
        } catch {
            return 0;
        }
    }

    private getVariableValue(varName: string, item: any): any {
        switch (varName) {
            case 'name':
                return item.name;
            case 'short_name':
                return item.name?.split(' ').shift() || item.name;
            default:
                const dcMatch = varName.match(/^dc_(\w+)$/);
                if (dcMatch) {
                    return this.getDcByAbility(dcMatch[1], item);
                }
                const spellDcMatch = varName.match(/^spell_dc_(\w+)$/);
                if (spellDcMatch) {
                    return this.getSpellDcByAbility(spellDcMatch[1], item);
                }
                const toHitMatch = varName.match(/^to_hit_(\w+)$/);
                if (toHitMatch) {
                    return this.getToHitByAbility(toHitMatch[1], item);
                }
                const damageModMatch = varName.match(/^damage_mod_(\w+)$/);
                if (damageModMatch) {
                    return this.getDamageModByAbility(damageModMatch[1], item);
                }
                const damageAvgMatch = varName.match(/^damage_avg_([^}]+)$/);
                if (damageAvgMatch) {
                    return this.getDamageAvg(damageAvgMatch[1], item);
                }
                return item[varName];
        }
    }

    private getDcByAbility(ability: string, item: any): number {
        return 8 + (this.getProficiencyBonus(item) || 0) + (this.getAbilityMod(ability, item) || 0);
    }

    private getSpellDcByAbility(ability: string, item: any): number {
        return this.getDcByAbility(ability, item);
    }

    private getToHitByAbility(ability: string, item: any): number {
        return (this.getProficiencyBonus(item) || 0) + (this.getAbilityMod(ability, item) || 0);
    }

    private getDamageModByAbility(ability: string, item: any): number {
        return this.getAbilityMod(ability, item) || 0;
    }

    private getAbilityMod(ability: string, item: any): number | undefined {
        const abilityLower = ability.toLowerCase();
        const abilityMap: Record<string, string> = {
            'str': 'str', 'strength': 'str',
            'dex': 'dex', 'dexterity': 'dex',
            'con': 'con', 'constitution': 'con',
            'int': 'int', 'intelligence': 'int',
            'wis': 'wis', 'wisdom': 'wis',
            'cha': 'cha', 'charisma': 'cha'
        };

        const key = abilityMap[abilityLower];
        if (key && item[key]) {
            return Math.floor((item[key] - 10) / 2);
        }
        return undefined;
    }

    private getProficiencyBonus(item: any): number {
        if (item.cr !== undefined) {
            const cr = typeof item.cr === 'string' ? parseFloat(item.cr) : item.cr;
            if (cr <= 4) return 2;
            if (cr <= 8) return 3;
            if (cr <= 12) return 4;
            if (cr <= 16) return 5;
            if (cr <= 20) return 6;
            if (cr <= 24) return 7;
            if (cr <= 28) return 8;
            if (cr <= 30) return 9;
        }
        return 2;
    }

    private getDamageAvg(damage: string, _item: any): number {
        const match = damage.match(/(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?/);
        if (match) {
            const numDice = parseInt(match[1]);
            const dieSize = parseInt(match[2]);
            const avg = numDice * (dieSize + 1) / 2;
            const modifier = match[3] && match[4] ? parseInt(match[3] + match[4]) : 0;
            return Math.floor(avg + modifier);
        }
        return 0;
    }

    private applyReplaceTxt(item: any, mod: ModEntry): void {
        const props = mod.props ? (Array.isArray(mod.props) ? mod.props : [mod.props]) : ['entries'];
        const replace = mod.replace;
        const with_ = mod.with;
        const flags = mod.flags || 'g';

        // 如果没有指定 prop，就在所有字符串属性中替换
        if (!mod.props) {
            this.replaceInAllStrings(item, replace, with_, flags);
        } else {
            for (const prop of props) {
                this.replaceInProp(item, prop, replace, with_, flags);
            }
        }
    }

    private replaceInAllStrings(obj: any, replace: string, with_: string, flags: string): any {
        if (!obj) return obj;

        if (typeof obj === 'string') {
            try {
                return obj.replace(new RegExp(replace, flags), with_);
            } catch (e) {
                return obj.replace(replace, with_);
            }
        }

        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                obj[i] = this.replaceInAllStrings(obj[i], replace, with_, flags);
            }
            return obj;
        }

        if (typeof obj === 'object') {
            for (const key of Object.keys(obj)) {
                obj[key] = this.replaceInAllStrings(obj[key], replace, with_, flags);
            }
            return obj;
        }

        return obj;
    }

    private replaceInProp(item: any, prop: string, replace: string, with_: string, flags: string): void {
        const value = item[prop];

        if (typeof value === 'string') {
            try {
                item[prop] = value.replace(new RegExp(replace, flags), with_);
            } catch (e) {
                item[prop] = value.replace(replace, with_);
            }
        } else if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) {
                const itemValue = value[i];
                if (typeof itemValue === 'string') {
                    try {
                        value[i] = itemValue.replace(new RegExp(replace, flags), with_);
                    } catch (e) {
                        value[i] = itemValue.replace(replace, with_);
                    }
                } else if (itemValue && typeof itemValue === 'object') {
                    for (const key of Object.keys(itemValue)) {
                        this.replaceInProp(itemValue, key, replace, with_, flags);
                    }
                }
            }
        } else if (value && typeof value === 'object') {
            for (const key of Object.keys(value)) {
                this.replaceInProp(value, key, replace, with_, flags);
            }
        }
    }

    private applyAddSenses(item: any, mod: ModEntry): void {
        if (!Array.isArray(item.senses)) {
            item.senses = [];
        }

        const senses = Array.isArray(mod.senses) ? mod.senses : [mod.senses];
        item.senses = [...item.senses, ...senses];
    }

    private applyAddSaves(item: any, mod: ModEntry): void {
        if (!item.save) {
            item.save = {};
        }

        if (mod.saves && typeof mod.saves === 'object') {
            for (const [ability, bonus] of Object.entries(mod.saves)) {
                if (item.save[ability] === undefined) {
                    item.save[ability] = bonus;
                } else if (typeof item.save[ability] === 'number' && typeof bonus === 'number') {
                    item.save[ability] += bonus;
                }
            }
        }
    }

    private applyAddSkills(item: any, mod: ModEntry): void {
        if (!item.skill) {
            item.skill = {};
        }

        if (mod.skills && typeof mod.skills === 'object') {
            for (const [skill, bonus] of Object.entries(mod.skills)) {
                if (item.skill[skill] === undefined) {
                    item.skill[skill] = bonus;
                } else if (typeof item.skill[skill] === 'number' && typeof bonus === 'number') {
                    item.skill[skill] += bonus;
                }
            }
        }
    }

    private applyAddAllSaves(item: any, mod: ModEntry): void {
        const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        const bonus = mod.saves || 0;

        if (!item.save) {
            item.save = {};
        }

        for (const ability of abilities) {
            if (item.save[ability] !== undefined && typeof item.save[ability] === 'number') {
                item.save[ability] += bonus;
            }
        }
    }

    private applyAddAllSkills(item: any, mod: ModEntry): void {
        const bonus = mod.skills || 0;

        if (item.skill && typeof item.skill === 'object') {
            for (const skill of Object.keys(item.skill)) {
                if (typeof item.skill[skill] === 'number') {
                    item.skill[skill] += bonus;
                }
            }
        }
    }

    private applyAddSpells(item: any, mod: ModEntry): void {
        if (!item.spellcasting) {
            item.spellcasting = [];
        }

        if (!Array.isArray(item.spellcasting)) {
            item.spellcasting = [item.spellcasting];
        }

        for (const casting of item.spellcasting) {
            if (mod.spells) {
                if (!casting.spells) casting.spells = {};
                for (const [level, spells] of Object.entries(mod.spells)) {
                    if (!casting.spells[level]) {
                        casting.spells[level] = [];
                    }
                    const spellsArray = Array.isArray(spells) ? spells : [spells];
                    casting.spells[level] = [...casting.spells[level], ...spellsArray];
                }
            }
            if (mod.daily) {
                if (!casting.daily) casting.daily = {};
                for (const [level, spells] of Object.entries(mod.daily)) {
                    if (!casting.daily[level]) {
                        casting.daily[level] = [];
                    }
                    const spellsArray = Array.isArray(spells) ? spells : [spells];
                    casting.daily[level] = [...casting.daily[level], ...spellsArray];
                }
            }
            if (mod.will) {
                if (!casting.will) casting.will = [];
                const willArray = Array.isArray(mod.will) ? mod.will : [mod.will];
                casting.will = [...casting.will, ...willArray];
            }
        }
    }

    private applyReplaceSpells(item: any, mod: ModEntry): void {
        if (!item.spellcasting) return;

        if (!Array.isArray(item.spellcasting)) {
            item.spellcasting = [item.spellcasting];
        }

        for (const casting of item.spellcasting) {
            if (mod.spells && casting.spells) {
                for (const [level, replacements] of Object.entries(mod.spells)) {
                    const replacementsArray = Array.isArray(replacements) ? replacements : [replacements];
                    if (casting.spells[level]) {
                        for (const replacement of replacementsArray) {
                            const index = casting.spells[level].indexOf(replacement.replace);
                            if (index !== -1) {
                                const withSpells = Array.isArray(replacement.with) ? replacement.with : [replacement.with];
                                casting.spells[level].splice(index, 1, ...withSpells);
                            }
                        }
                    }
                }
            }
        }
    }

    private applyRemoveSpells(item: any, mod: ModEntry): void {
        if (!item.spellcasting) return;

        if (!Array.isArray(item.spellcasting)) {
            item.spellcasting = [item.spellcasting];
        }

        for (const casting of item.spellcasting) {
            if (mod.spells && casting.spells) {
                for (const [level, spells] of Object.entries(mod.spells)) {
                    const spellsArray = Array.isArray(spells) ? spells : [spells];
                    if (casting.spells[level]) {
                        casting.spells[level] = casting.spells[level].filter(
                            (spell: string) => !spellsArray.includes(spell)
                        );
                    }
                }
            }
        }
    }

    private applyMaxSize(item: any, mod: ModEntry): void {
        const max = mod.max;
        const sizeOrder = ['T', 'S', 'M', 'L', 'H', 'G'];
        const currentIndex = sizeOrder.indexOf(item.size);
        const maxIndex = sizeOrder.indexOf(max);

        if (currentIndex !== -1 && maxIndex !== -1 && currentIndex > maxIndex) {
            item.size = max;
        }
    }

    private applyScalarMultXp(item: any, mod: ModEntry): void {
        const scalar = mod.scalar || 1;
        const floor = mod.floor || false;

        if (typeof item.xp === 'number') {
            item.xp *= scalar;
            if (floor) item.xp = Math.floor(item.xp);
        }
    }

    private applyScalarAddHit(item: any, mod: ModEntry): void {
        const scalar = mod.scalar || 0;

        const updateHit = (obj: any): void => {
            if (obj && typeof obj === 'object') {
                if (typeof obj.attackBonus === 'number') {
                    obj.attackBonus += scalar;
                }
                for (const key of Object.keys(obj)) {
                    if (Array.isArray(obj[key])) {
                        obj[key].forEach(updateHit);
                    } else if (obj[key] && typeof obj[key] === 'object') {
                        updateHit(obj[key]);
                    }
                }
            }
        };

        updateHit(item);
    }

    private applyScalarAddDc(item: any, mod: ModEntry): void {
        const scalar = mod.scalar || 0;

        const updateDc = (obj: any): void => {
            if (obj && typeof obj === 'object') {
                if (typeof obj.dc === 'object' && typeof obj.dc.dc === 'number') {
                    obj.dc.dc += scalar;
                }
                for (const key of Object.keys(obj)) {
                    if (Array.isArray(obj[key])) {
                        obj[key].forEach(updateDc);
                    } else if (obj[key] && typeof obj[key] === 'object') {
                        updateDc(obj[key]);
                    }
                }
            }
        };

        updateDc(item);
    }

    async saveResolvedData(outputDir: string): Promise<void> {
        // 不再删除整个目录，这样可以保留其他文件
        // 只保存修改过的文件
        for (const [relativePath, data] of this.fileMap) {
            const outputPath = path.join(outputDir, relativePath);
            const dirPath = path.dirname(outputPath);
            
            await fs.mkdir(dirPath, { recursive: true });
            await fs.writeFile(outputPath, JSON.stringify(data, null, 2), 'utf-8');
        }
    }

    async resolveAndSave(inputDir: string, outputDir: string): Promise<void> {
        // console.log(`Loading data from ${inputDir}...`);
        await this.loadFromDirectory(inputDir, inputDir);

        // console.log(`Resolving _copy references for ${inputDir}...`);
        this.resolveAllCopies();

        // console.log(`Saving resolved data to ${outputDir}...`);
        await this.saveResolvedData(outputDir);

        // console.log(`Successfully processed ${inputDir}`);
    }
}

export async function resolveCopiesInDirectory(inputDir: string, outputDir: string): Promise<void> {
    const applier = new CopyApplier();
    await applier.resolveAndSave(inputDir, outputDir);
}

export async function resolveCopiesInBothDirectories(
    enInputDir: string,
    zhInputDir: string,
    enOutputDir: string,
    zhOutputDir: string
): Promise<void> {
    // console.log('Processing English data...');
    await resolveCopiesInDirectory(enInputDir, enOutputDir);

    // console.log('\nProcessing Chinese data...');
    await resolveCopiesInDirectory(zhInputDir, zhOutputDir);
}

export default CopyApplier;
