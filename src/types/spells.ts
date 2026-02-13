import { ParagraphGroup } from './typography';
import { WikiData } from './wiki';

export type SpellFileEntry = {
    name: string;
    ENG_name?: string;
    translator?: string;
    alias?: string[];
    source: string;
    page: number;
    srd?: boolean | string;
    otherSources?: { source: string; page: number }[];
    basicRules?: boolean;
    reprintedAs?: string[];
    level: number;
    school: string;

    // 施法时间。
    // 立即施法表现为number:1,unit:action.
    // 长时间施法则是number:1,unit:minute等。
    // 施法条件在condition里。
    time: { number: number; unit: string; condition?: string }[];
    range: {
        type: string;
        distance?: {
            type: string;
            amount?: number;
        };
    };
    components: {
        v?: boolean;
        s?: boolean;
        m?:
            | string
            | {
                  text: string;
                  cost?: number;
                  consume?: boolean | string;
              };
    };
    duration: {
        type: string;
        duration?: {
            type: string;
            amount: number;
            upTo?: boolean;
        };
        concentration?: boolean;
        ends?: string[];
    }[];
    entries: ParagraphGroup;
    entriesHigherLevel?: ParagraphGroup;
    scalingLevelDice?: {
        label: string;
        scaling: Record<string, string>;
    };
    spellAttack?: string[];
    abilityCheck?: string[];
    damageInflict?: string[];
    damageVulnerable?: string[];
    conditionInflict?: string[];
    damageResist?: string[];
    damageImmune?: string[];
    conditionImmune?: string[];
    savingThrow?: string[];
    affectsCreatureType?: string[];
    miscTags?: string[];
    areaTags?: string[];
    meta?: any;
    hasFluffImages?: boolean;
};

export type SpellFile = {
    spell: SpellFileEntry[];
};

export type SpellFluffImage = {
    type: string;
    href: {
        type: string;
        path: string;
    };
    credit?: string;
    title?: string;
    caption?: string;
};

export type SpellFluffEntry = {
    ENG_name?: string;
    name: string;
    source: string;
    entries?: ParagraphGroup;
    images?: SpellFluffImage[];
};

export type SpellFluffContent = {
    entries?: ParagraphGroup;
    images?: SpellFluffImage[];
};

export type SpellFluffFile = {
    spellFluff: SpellFluffEntry[];
};

export type WikiSpellEntry = Partial<SpellFileEntry> & {
    html?: string;
};

export type SpellClassEntry = {
    name: string;
    source: string;
};

export type WikiSpellData = WikiData<WikiSpellEntry, 'spell'> & {
    level: number;
    school: string;
    abilityCheck?: string[];
    spellAttack?: string[];
    damageInflict?: string[];
    damageVulnerable?: string[];
    conditionInflict?: string[];
    damageResist?: string[];
    damageImmune?: string[];
    conditionImmune?: string[];
    savingThrow?: string[];
    affectsCreatureType?: string[];
    ritual?: boolean;
    classes?: SpellClassEntry[];
    full?: {
        en?: SpellFluffContent;
        zh?: SpellFluffContent;
    };
};
