import { ParagraphGroup } from './typography';
import { WikiData } from './wiki';

export type ItemListEntry = string | { item: string; quantity: number } | { special: string };

export type ItemFileType = {
    _meta: any;
    item: ItemFileEntry[];
    itemGroup: (ItemFileEntry & { items: string[] })[];
};

export type ItemRarity =
    | 'uncommon'
    | 'rare'
    | 'very rare'
    | 'none'
    | 'unknown'
    | 'unknown (magic)'
    | 'legendary'
    | 'artifact';

export type ItemFileEntry = ItemSharedProps;

type ItemSharedProps = {
    name: string; // 名称（会被翻译）
    ENG_name?: string; // 英文名称（如果有）
    source: string; // 信息来源，这里是一本书的ID
    page?: number; // 页码
    baseItem?: string; // 基础物品，例如“急速弯刀(Scimitar of Speed)”的基础物品是弯刀(scimitar)。基础物品位于data/items-base.json，数据需要合并
    weight?: number;
    weightNote?: string; // 唯一一个值是水袋（Waterskin）的“(full)”

    value?: number | null; // 价值（铜币）
    valueRarity?: string;
    // 描述性标记（目前几乎都是颜色）
    detail1?: string;
    detail2?: string;
    otherSources?: { source: string; page?: number }[]; // 额外信息来源
    additionalSources?: { source: string; page: number }[]; // 还是额外信息来源
    reprintedAs?: (string | { uid: string; tag?: string })[];
    edition?: string;
    type?: string; // 取值包括M,INS,RD,WD,G,TG,OTH,AIR等，代表物品的类型，定义位于data/item-base.json
    property?: (string | { uid: string; note?: string })[]; // 取值包括L,V,T,H,2H,F,A等，定义需要明确
    tier?: string; // 取值为major或minor，需要明确
    //Attune（是什么）
    reqAttune?: string | boolean; // 如果是string则是“由什么角色进行Attue”
    reqAttuneAlt?: string; // 唯一一个值是'optional'（数据Hazirawn）
    reqAttuneTags?: {
        class?: string;
        spellcasting?: boolean;
        alignment?: string[];
        creatureType?: string;
    }[];
    basicRules?: boolean;
    freeRules2024?: boolean;
    rarity?: string; // 稀有度
    entries?: ParagraphGroup; // 描述
    additionalEntries?: ParagraphGroup; // 额外描述
    hasFluffImages?: boolean;
    hasFluff?: boolean;
    hasRefs?: boolean;
    wondrous?: boolean;
    tattoo?: boolean;
    curse?: boolean;
    sentient?: boolean;
    itemsHidden?: boolean;
    srd?: boolean | string;
    miscTags?: string[];

    // 武器相关
    weapon?: boolean;
    weaponCategory?: string;
    // 伤害投。目前最多有dmg1和dmg2两个字段
    dmg1?: string;
    dmg2?: string;
    dmgType?: string; // 伤害类型，S,B,O,P
    range?: string; // 格式为最小射程/最大射程，单位似乎是十分之一码
    reload?: number; // 虽然叫reload但似乎是弹仓大小。仅出现于现代和未来物品。
    ammoType?: string; // 远程武器使用的弹药类型

    scfType?: string; // 取值有holy,arcane,druid，需明确
    focus?: string[] | boolean; // 可能是需要专注。如果是数组则是职业列表
    // 护甲和豁免
    ac?: number;
    bonusAc?: string; // 参考resist
    bonusSavingThrow?: string;
    immune?: string[]; // 对特定效果免疫
    conditionImmune?: string[]; // 在一定条件下对特定效果免疫
    resist?: string[]; // 对特定效果获得豁免(bonusSavingThrow)
    vulnerable?: string[]; // 对特定效果易伤

    dexterityMax?: null; // 可能是穿上此护甲后限制敏捷
    strength?: string | null;
    stealth?: boolean;
    lootTables?: string[]; // 可能是从属哪个掉落表

    // 充能
    charges?: number; // 物品使用的充能数量
    recharge?: string; // 在什么时间点充能（dawn/midnight/dusk/special）
    rechargeAmount?: string; // 通常是dice
    // 法术
    attachedSpells?: string[]; // 该物品附带的法术

    // proficiency
    grantsProficiency?: boolean; // 是否提提供熟练

    // 装备对ATTR造成的影响
    ability?: {
        from?: string[];
        count?: number;
        amount?: number;
        // static中的属性表示装备后角色的属性将固定为该值
        static?: Record<string, number>;
        // 如果出现以下若干值，则表示这些值是加到角色身上的
        str?: number;
        dex?: number;
        con?: number;
        wis?: number;
        int?: number;
        cha?: number;
        // 如果出现choose，表示玩家需要在下列效果中选一个。from是玩家的六围
        choose?: { from: string[]; count: number; amount?: number }[];
    };
    bonusWeapon?: string; // 武器加值
    bonusWeaponAttack?: string; // 攻击骰加值
    bonusWeaponDamage?: string; // 伤害骰加值
    // 加值
    bonusSpellAttack?: string;
    bonusSpellSaveDc?: string;

    bonusAbilityCheck?: string;
    bonusProficiencyBonus?: string;

    // 容器
    containerCapacity?: {
        weight?: number[]; // 目前有1、3、6三种数组长度，意义未知
        item?: Record<string, number>[]; // 可存放的内容物/数量
        weightless?: boolean;
    };
    packContents?: ItemListEntry[]; // 预先存放的内容及数量
    atomicPackContents?: boolean; // 仅出现于铁蒺藜（Caltrops）和滚珠（Ball Bearings）

    // 为毛要用这种吊格式啊！
    sword?: boolean;
    crossbow?: boolean;
    staff?: boolean;
    axe?: boolean;
    club?: boolean;
    spear?: boolean;
    dagger?: boolean;
    hammer?: boolean;
    bow?: boolean;
    mace?: boolean;
    armor?: boolean;
    net?: boolean;
    firearm?: boolean;
    poison?: boolean;
    poisonTypes?: string[]; // 毒药类物品的毒性类型
    bolt?: boolean;
    arrow?: boolean;
    cellEnergy?: boolean;
    bulletFirearm?: boolean;
    polearm?: boolean;
    lance?: boolean;
    rapier?: boolean;
    bulletSling?: boolean;

    mastery?: string[];

    optionalfeatures?: string[];

    age?: string;

    needleBlowgun?: boolean; // 某种吹箭箭矢使用

    light?: { bright: number; dim: number }[];

    // 载具
    crew?: number;
    crewMin?: number;
    crewMax?: number;
    vehAc?: number;
    vehHp?: number;
    vehSpeed?: number;
    vehDmgThresh?: number;
    capPassenger?: number;
    capCargo?: number;
    carryingCapacity?: number;
    speed?: number;
    travelCost?: number;
    shippingCost?: number;
    modifySpeed?: {
        equal: {
            climb: string;
        };
    };

    _copy?: {
        name: string;
        source: string;
        _mod?: any;
        _preserve?: any;
    };
};

export type ItemGroup = ItemSharedProps & {
    items: string[];
};

export type ItemProperty = {
    abbreviation: string;
    name?: string;
    source: string;
    page: number;
    reprintedAs?: string[];
    template: string;
    freeRules2024?: boolean;
    entries?: ParagraphGroup;
    entriesTemplate?: ParagraphGroup;
};

export type ItemType = {
    name: string;
    abbreviation: string;
    source: string;
    page: number;
    reprintedAs?: string[];
    entries?: ParagraphGroup;
    entriesTemplate?: ParagraphGroup;
    freeRules2024?: boolean;
    _copy?: {
        abbreviation: string;
        source: string;
    };
};

export type ItemTypedAdditionalEntry = {
    name: string;
    source: string;
    appliesTo: string;
    entries: ParagraphGroup;
};

export type ItemBaseEntires = {
    name: string;
    source: string;
    entriesTemplate: ParagraphGroup;
};
export type ItemMastery = {
    name: string;
    source: string;
    page: number;
    freeRules2024: boolean;
    entries: ParagraphGroup;
};

export type ItemBaseFile = {
    _meta: any;
    baseitem: ItemFileEntry[];
    itemProperty: ItemProperty[];
    itemType: ItemType[];
    itemTypeAdditionalEntries: ItemTypedAdditionalEntry[];
    itemEntry: ItemBaseEntires[];
    itemMastery: ItemMastery[];
};

export type ItemFile = {
    _meta: any;
    item: ItemFileEntry[];
    baseitem: ItemFileEntry[];
    itemGroup: ItemGroup[];
};

export type MagicVariantInherits = {
    source?: string;
    page?: number;
    entries?: ParagraphGroup;
    reprintedAs?: (string | { uid: string; tag?: string })[];
    [key: string]: any;
};

export type MagicVariantEntry = {
    name: string;
    ENG_name?: string;
    type?: string;
    source?: string;
    page?: number;
    entries?: ParagraphGroup;
    reprintedAs?: (string | { uid: string; tag?: string })[];
    inherits?: MagicVariantInherits;
    [key: string]: any;
};

export type MagicVariantFile = {
    magicvariant: MagicVariantEntry[];
};

export type ItemFluffImage = {
    type: string;
    href: {
        type: string;
        path: string;
    };
    credit?: string;
    title?: string;
    caption?: string;
};

export type ItemFluffCopy = {
    ENG_name?: string;
    name: string;
    source?: string;
};

export type ItemFluffEntry = {
    ENG_name?: string;
    name: string;
    source: string;
    entries?: ParagraphGroup;
    images?: ItemFluffImage[];
    _copy?: ItemFluffCopy;
};

export type ItemFluffContent = {
    entries?: ParagraphGroup;
    images?: ItemFluffImage[];
};

export type ItemFluffFile = {
    itemFluff: ItemFluffEntry[];
};

// 维基用数据
export type WikiItemEntry = (ItemFileEntry | ItemGroup | MagicVariantEntry) & {
    html?: string;
};

export type WikiItemData = WikiData<WikiItemEntry, 'item'> & {
    weight?: number;
    value?: number;
    rarity?: string;
    baseItem?: string;
    items?: string[];
    type?: string;
    subTypes?: string[];
    // 武器类：sword,crossbow,axe,staff,club,spear,dagger,hammer,bow,mace,firearm,polearm,lance,rapier,tattoo
    // 弹药类：arrow,bolt,cellEnergy,bulletFirearm,bulletSling
    // 护甲类：armor
    // 其他： poison,net
    isBaseItem: boolean;
    full?: {
        en?: ItemFluffContent;
        zh?: ItemFluffContent;
    };
    weapon?: {
        category?: string; // 简易武器（simple）和军用武器（martial）
        weaponCategory?: string;
        dmgs?: string[]; // 由原始数据中的dmg1,dmg2等生成。掷骰公式。
        dmg1?: string;
        dmg2?: string;
        dmgType?: string; // 伤害类型，S,B,O,P
        range?: { min: number; max: number }; // 最小射程和最大射程。由原始数据的字符串拆分而来。
        reload?: number; // 弹仓大小。出现于枪械武器。
        ammoType?: string; // 使用的弹药类型
        property?: (string | { uid: string; note?: string })[];
        mastery?: string[];
        packContents?: ItemListEntry[];
        firearm?: boolean;
        sword?: boolean;
        rapier?: boolean;
        crossbow?: boolean;
        axe?: boolean;
        staff?: boolean;
        club?: boolean;
        spear?: boolean;
        dagger?: boolean;
        hammer?: boolean;
        bow?: boolean;
        mace?: boolean;
        polearm?: boolean;
        lance?: boolean;
    };
    armor?: {
        ac?: number; // 护甲等级。如原始无数据则为0。
        maxDexterty?: boolean; // 穿戴此护甲时，从敏捷获得的AC不受+2的限制。唯一一个原始数据是null，判断时务必注意“为null时输出true”
    };
    charge?: {
        max?: number; // 最大充能数
        rechargeAt?: string; // 充能的时间点（dawn/midnight/dusk/special）
        rechargeAmount?: string; // 充能数量（骰子）
    };
    bonus?: {
        // 该部分原始数据均为字符串（带加号减号那种），处理成int
        weapon?: number; // 额外的攻击骰和伤害骰
        weaponAttack?: number; // 额外的攻击骰
        weaponDamage?: number; // 额外的伤害骰
        spellAttack?: number; // 法术攻击加值
        spellSaveDc?: number; // 法术豁免DC
        ac?: number; // 护甲等级价值（用于非护甲类物品）
        savingThrow?: number; // 豁免加值。具体是哪种豁免，在数据中无体现。
        abilityCheck?: number; // 属性检定加值
        proficiencyBonus?: number; // 熟练加值
    };
};

// export type ItemProperty = {
//     abbreviation: string;
//     name?: string;
//     source: string;
//     page: number;
//     reprintedAs?: string[];
//     template: string;
//     freeRules2024?: boolean;
//     entries?: ParagraphGroup;
//     entriesTemplate?: ParagraphGroup;
// };

export type WikiItemPropertyEntry = {
    name: string;
    entries: ParagraphGroup;
    html: string;   
};

export type WikiItemPropertyData = WikiData<WikiItemPropertyEntry, 'itemProperty'> & {
    abbreviation: string;
};

export type WikiItemTypeEntry = {
    name: string;
    entries: ParagraphGroup;
    html: string;
};

export type WikiItemTypeData = WikiData<WikiItemTypeEntry, 'itemType'> & {
    abbreviation: string;
};
